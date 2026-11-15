import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { DomainEvent } from '@company-os/contracts';
import { DEMO_ORG, DEV_ADMIN, initLiveOrg } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app, relayOnce } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
let orgId = '';
let baseUrl = '';

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  while ((await relayOnce()) > 0);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const req = (
  method: 'GET' | 'POST',
  url: string,
  opts: { org?: string; role?: string; payload?: object; key?: string } = {},
) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      ...(opts.org ? { 'x-org-id': opts.org } : {}),
      ...(opts.role ? { 'x-dev-role': opts.role } : {}),
      ...(method === 'POST' ? { 'idempotency-key': opts.key ?? `k-${randomUUID()}` } : {}),
    },
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
const agentBody = () => ({
  name: 'Léa Martin',
  title: 'Commerciale',
  departmentId: `${orgId.slice(0, 8)}-sales`,
  grants: { crm: ['lookup_lead'] },
  goal: 'Préparer les relances',
  instructions: 'Ton chaleureux, proposer un rendez-vous de 20 minutes.',
  monthlyBudgetUsd: 2,
});

describe('Live encadré — API', () => {
  it('/v1/me liste les organisations ; X-Org-Id bascule vers une org dont on est membre', async () => {
    const me = (await req('GET', '/v1/me')).json().data;
    expect(me.orgId).toBe(DEMO_ORG.id);
    expect(me.orgs.map((o: { mode: string }) => o.mode).sort()).toEqual(['demo', 'live']);
    expect(me.capabilities).toMatchObject({ createAgent: false, createMission: false });

    const live = (await req('GET', '/v1/me', { org: orgId })).json().data;
    expect(live).toMatchObject({ orgId, role: 'admin' });
    expect(live.capabilities).toMatchObject({ createAgent: true, createMission: true });
    const boot = (await req('GET', '/v1/bootstrap', { org: orgId })).json().data;
    expect(boot.org).toMatchObject({ id: orgId, mode: 'live' });
    expect(boot.agents).toHaveLength(0);
  });

  it('org dont on n’est pas membre => 403 (aucune fuite)', async () => {
    const other = randomUUID();
    await db.organization.create({ data: { id: other, name: 'Autre', mode: 'live' } });
    expect((await req('GET', '/v1/bootstrap', { org: other })).statusCode).toBe(403);
  });

  it('POST /v1/agents : admin seulement, live seulement, idempotent', async () => {
    expect(
      (await req('POST', '/v1/agents', { org: orgId, role: 'operator', payload: agentBody() }))
        .statusCode,
    ).toBe(403);
    expect((await req('POST', '/v1/agents', { payload: agentBody() })).statusCode).toBe(403);
    const r1 = await req('POST', '/v1/agents', {
      org: orgId,
      payload: agentBody(),
      key: 'agent-k-1',
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await req('POST', '/v1/agents', {
      org: orgId,
      payload: agentBody(),
      key: 'agent-k-1',
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().data.agentId).toBe(r1.json().data.agentId);
    expect(await db.agent.count({ where: { orgId } })).toBe(1);
    const bad = await req('POST', '/v1/agents', {
      org: orgId,
      payload: { ...agentBody(), grants: { erp: ['issue_invoice'] } },
    });
    expect(bad.json().error.code).toBe('POLICY_DENIED');
  });

  it('mission libre via l’API : validation, puis création dans l’org live', async () => {
    const { agentId } = (
      await req('POST', '/v1/agents', { org: orgId, payload: agentBody() })
    ).json().data;
    const noMission = await req('POST', '/v1/tasks', {
      org: orgId,
      payload: { kind: 'custom', agentId },
    });
    expect(noMission.statusCode).toBe(400);
    const ok = await req('POST', '/v1/tasks', {
      org: orgId,
      payload: {
        kind: 'custom',
        agentId,
        mission: { title: 'Relance', instructions: 'Préparer une relance pour demo-lead-042.' },
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data).toMatchObject({ kind: 'custom', title: 'Relance', agentId });
  });

  it('isolation temps réel : un client de l’org démo ne reçoit rien de l’org live', async () => {
    const received: DomainEvent[] = [];
    const s = connect(baseUrl, { transports: ['websocket'], reconnection: false });
    await new Promise<void>((resolve) => s.on('connect', () => resolve()));
    await s.emitWithAck('events:resume', { afterSeq: 1_000_000 }).catch(() => undefined);
    s.on('domain:event', (e: DomainEvent) => received.push(e));
    await req('POST', '/v1/agents', { org: orgId, payload: agentBody() });
    while ((await relayOnce()) > 0);
    await new Promise((r) => setTimeout(r, 300));
    s.close();
    expect(received.filter((e) => e.orgId === orgId)).toEqual([]);
  });
});
