import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import {
  completeInvocation,
  createTask,
  DEMO_ORG,
  finishTask,
  loadSnapshot,
  requestInvocation,
  startInvocation,
  startNextTask,
} from '@company-os/db';
import type { DomainEvent } from '@company-os/contracts';
import {
  comparable,
  foldAll,
  LIVE_ORG,
  resetAndSeed,
  seedLiveOrg,
  testDb,
} from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app, relayOnce } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;
let baseUrl = '';

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetAndSeed(db);
  while ((await relayOnce()) > 0);
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    headers: { 'idempotency-key': `k-${Math.random()}`, ...headers },
  });

async function blockedTask() {
  const { task } = await createTask(db, {
    orgId: org,
    kind: 'check_invoice',
    agentId: 'billing-01',
    requester: admin,
  });
  const s = (await startNextTask(db, org))!;
  for (let i = 0; i < 2; i++) {
    const r = await requestInvocation(db, {
      orgId: org,
      runId: s.runId,
      toolId: 'erp',
      action: 'fetch_invoice',
      redactedInput: { invoiceRef: 'x' },
      idempotencyKey: `inv-${i}`,
      causationId: s.runEventId,
    });
    const st = await startInvocation(db, {
      orgId: org,
      invocationId: r.invocation.id,
      attempt: 1,
      causationId: r.eventId,
    });
    await completeInvocation(db, {
      orgId: org,
      invocationId: r.invocation.id,
      causationId: st.eventId,
      ok: false,
      errorCode: 'UPSTREAM_503',
      attempt: 1,
    });
  }
  await finishTask(db, {
    orgId: org,
    taskId: task.id,
    runId: s.runId,
    causationId: null,
    outcome: { status: 'blocked', reasonCode: 'UPSTREAM_503', safeSummary: 'ERP indisponible' },
  });
  return task;
}

describe('cycle de vie des agents', () => {
  it('pause -> aucune nouvelle tâche ; reprise ; désactivation refusée avec tâches ouvertes', async () => {
    expect(
      (await post('/v1/agents/sdr-01/pause', { reason: 'Maintenance' }, { 'x-dev-role': 'viewer' }))
        .statusCode,
    ).toBe(403);
    const paused = await post(
      '/v1/agents/sdr-01/pause',
      { reason: 'Maintenance' },
      { 'x-dev-role': 'operator' },
    );
    expect(paused.json()).toMatchObject({ data: { status: 'paused', changed: true } });
    await expect(
      createTask(db, { orgId: org, kind: 'qualify_lead', agentId: 'sdr-01', requester: admin }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      (await post('/v1/agents/sdr-01/resume', { reason: 'Maintenance terminée' })).json(),
    ).toMatchObject({ data: { status: 'active' } });

    await createTask(db, { orgId: org, kind: 'qualify_lead', agentId: 'sdr-01', requester: admin });
    expect(
      (await post('/v1/agents/sdr-01/deactivate', { reason: 'Fin' }, { 'x-dev-role': 'operator' }))
        .statusCode,
    ).toBe(403);
    expect((await post('/v1/agents/sdr-01/deactivate', { reason: 'Fin' })).statusCode).toBe(409);
    const ok = await post('/v1/agents/content-01/deactivate', { reason: 'Poste supprimé' });
    expect(ok.json()).toMatchObject({ data: { status: 'deactivated' } });
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.agents.find((a) => a.id === 'content-01')).toMatchObject({
      status: 'deactivated',
      activity: 'offline',
      // Le poste est libéré : il redevient attribuable à un futur recrutement.
      deskAnchor: 'retired:content-01',
    });
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
});

describe('alertes persistées', () => {
  it('dérivées des événements dans la même transaction, acquittables, cohérentes avec le client', async () => {
    const task = await blockedTask();
    const list = (await app.inject('/v1/alerts?unacked=true')).json<{
      data: { id: string; level: string; resourceId: string }[];
    }>();
    expect(list.data.filter((a) => a.level === 'error').length).toBe(3); // 2 échecs outil + tâche bloquée
    const taskAlert = list.data.find((a) => a.resourceId === task.id)!;
    const snap = (await loadSnapshot(db, org))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/alerts/${taskAlert.id}/ack`,
          headers: { 'x-dev-role': 'viewer' },
        })
      ).statusCode,
    ).toBe(403);
    const acked = await app.inject({ method: 'POST', url: `/v1/alerts/${taskAlert.id}/ack` });
    expect(acked.json()).toMatchObject({ data: { ackedBy: expect.any(String) } });
    const again = await app.inject({ method: 'POST', url: `/v1/alerts/${taskAlert.id}/ack` });
    expect(again.json<{ data: { ackedAt: string } }>().data.ackedAt).toBe(
      acked.json<{ data: { ackedAt: string } }>().data.ackedAt,
    );
    const unacked = (await app.inject('/v1/alerts?unacked=true')).json<{ data: unknown[] }>();
    expect(unacked.data).toHaveLength(2);
  });
  it('le seed ne génère aucune alerte (pas de bruit)', async () => {
    expect(await db.alert.count()).toBe(0);
  });
});

describe('KPI par fenêtre et santé des outils', () => {
  it('taux de succès sur échantillon réel, outil dégradé, null sans échantillon', async () => {
    const empty = (await app.inject('/v1/metrics/summary?window=1h')).json<{
      data: { tasks: { successRate: number | null } };
    }>();
    expect(empty.data.tasks.successRate).toBeNull();
    await blockedTask();
    const m = (await app.inject('/v1/metrics/summary?window=24h')).json<{
      data: {
        tasks: { blocked: number };
        tools: { toolId: string; calls: number; errorRate: number; health: string }[];
      };
    }>();
    expect(m.data.tasks.blocked).toBe(1);
    expect(m.data.tools.find((t) => t.toolId === 'erp')).toMatchObject({
      calls: 2,
      errorRate: 1,
      health: 'degraded',
    });
    expect((await app.inject('/v1/metrics/summary?window=2d')).statusCode).toBe(400);
  });
});

describe('S10 — isolation entre organisations', () => {
  it('ni l’API ni le temps réel ne montrent les objets d’une autre organisation', async () => {
    await seedLiveOrg(db);
    const liveEvents = await db.eventLog.count({ where: { orgId: LIVE_ORG.id } });
    expect(liveEvents).toBeGreaterThan(0);
    const ev = (await app.inject('/v1/events?afterSeq=0&limit=500')).json<{
      data: DomainEvent[];
    }>();
    expect(ev.data.every((e) => e.orgId === org)).toBe(true);
    const agents = (await app.inject('/v1/agents')).json<{ data: { id: string }[] }>();
    expect(agents.data.map((a) => a.id)).not.toContain('live-sdr');
    expect((await app.inject('/v1/agents/live-sdr')).statusCode).toBe(404);

    const s = connect(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
    const got: DomainEvent[] = [];
    s.on('domain:event', (e) => got.push(e));
    await s.emitWithAck('events:resume', { afterSeq: 1_000_000 });
    await createTask(db, { orgId: LIVE_ORG.id, kind: 'qualify_lead', requester: admin });
    await createTask(db, { orgId: org, kind: 'qualify_lead', requester: admin });
    while ((await relayOnce()) > 0);
    await expect.poll(() => got.length).toBeGreaterThan(0);
    expect(got.every((e) => e.orgId === org)).toBe(true);
    s.close();
  });
});
