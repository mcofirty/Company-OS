import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  WorldSnapshotSchema,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
} from '@company-os/contracts';
import { createTask, DEMO_ORG } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app, relayOnce } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
const locked = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: false },
});
let baseUrl = '';
let lockedUrl = '';

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  await locked.app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  lockedUrl = `http://127.0.0.1:${(locked.app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetAndSeed(db);
  while ((await relayOnce()) > 0);
});
afterAll(async () => {
  await app.close();
  await locked.app.close();
  await db.$disconnect();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/v1/tasks', payload: body as object, headers });

describe('santé', () => {
  it('live et ready', async () => {
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', checks: { database: 'ok' } });
  });
});

describe('auth', () => {
  it('401 sans principal de développement autorisé, avec enveloppe d’erreur', async () => {
    const res = await locked.app.inject('/v1/bootstrap');
    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: { code: string; requestId: string } }>();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('/v1/bootstrap', () => {
  it('snapshot conforme au contrat, mode démo, 12 agents', async () => {
    const res = await app.inject('/v1/bootstrap');
    expect(res.statusCode).toBe(200);
    const { data, meta } = res.json<{ data: unknown; meta: { schemaVersion: number } }>();
    const snap = WorldSnapshotSchema.parse(data);
    expect(meta.schemaVersion).toBe(1);
    expect(snap.org.mode).toBe('demo');
    expect(snap.agents).toHaveLength(12);
    expect(snap.tools).toHaveLength(9); // 8 outils métier + plateforme
    expect(snap.lastSeq).toBe(24);
  });
});

describe('POST /v1/tasks', () => {
  it('exige Idempotency-Key', async () => {
    const res = await post({ kind: 'qualify_lead' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
  it('S07 : un viewer reçoit 403 et aucune tâche n’est créée', async () => {
    const res = await post(
      { kind: 'qualify_lead' },
      { 'idempotency-key': 'viewer-attempt-1', 'x-dev-role': 'viewer' },
    );
    expect(res.statusCode).toBe(403);
    expect(await db.task.count()).toBe(0);
  });
  it('S09 : deux POST identiques -> une seule tâche', async () => {
    const h = { 'idempotency-key': 'same-key-123' };
    const a = await post({ kind: 'qualify_lead', agentId: 'sdr-01' }, h);
    const b = await post({ kind: 'qualify_lead', agentId: 'sdr-01' }, h);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json<{ data: { id: string } }>().data.id).toBe(
      a.json<{ data: { id: string } }>().data.id,
    );
    expect(await db.task.count()).toBe(1);
  });
  it('rejette un corps invalide et un champ inconnu', async () => {
    expect((await post({ kind: 'nope' }, { 'idempotency-key': 'k-invalid-1' })).statusCode).toBe(
      400,
    );
    expect(
      (await post({ kind: 'qualify_lead', extra: 1 }, { 'idempotency-key': 'k-invalid-2' }))
        .statusCode,
    ).toBe(400);
  });
  it('GET /v1/tasks/:id renvoie la tâche et ses événements corrélés ; 404 / 400', async () => {
    const created = await post({ kind: 'qualify_lead' }, { 'idempotency-key': 'detail-key-1' });
    const id = created.json<{ data: { id: string } }>().data.id;
    const res = await app.inject(`/v1/tasks/${id}`);
    expect(res.json<{ data: { events: DomainEvent[] } }>().data.events.map((e) => e.type)).toEqual([
      'task.created',
    ]);
    expect((await app.inject('/v1/tasks/00000000-0000-4000-8000-000000000000')).statusCode).toBe(
      404,
    );
    expect((await app.inject('/v1/tasks/pas-un-uuid')).statusCode).toBe(400);
  });
});

describe('lectures', () => {
  it('/v1/events?afterSeq, /v1/agents, /v1/tools, /v1/departments', async () => {
    const ev = (await app.inject('/v1/events?afterSeq=20')).json<{
      data: DomainEvent[];
      meta: { lastSeq: number };
    }>();
    expect(ev.data.map((e) => e.seq)).toEqual([21, 22, 23, 24]);
    expect(ev.meta.lastSeq).toBe(24);
    expect(
      (await app.inject('/v1/agents?departmentId=sales')).json<{ data: unknown[] }>().data,
    ).toHaveLength(3);
    const agent = (await app.inject('/v1/agents/sdr-01')).json<{
      data: { grants: { toolId: string }[] };
    }>();
    expect(agent.data.grants.map((g) => g.toolId).sort()).toEqual(['crm', 'docs', 'email']);
    expect((await app.inject('/v1/tools')).json<{ data: unknown[] }>().data).toHaveLength(9);
    expect((await app.inject('/v1/departments')).json<{ data: unknown[] }>().data).toHaveLength(6);
  });
});

describe('Socket.IO', () => {
  type S = Socket<ServerToClientEvents, ClientToServerEvents>;
  const open = (url = baseUrl): S =>
    connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });

  it('events:resume rejoue après afterSeq puis pousse le live depuis l’outbox', async () => {
    const s = open();
    const got: DomainEvent[] = [];
    s.on('domain:event', (e) => got.push(e));
    const ack = await s.emitWithAck('events:resume', { afterSeq: 20 });
    expect(ack).toEqual({ accepted: true, lastSeq: 24, replayed: 4 });
    await createTask(db, {
      orgId: DEMO_ORG.id,
      kind: 'qualify_lead',
      requester: { kind: 'user', id: 'x' },
    });
    await relayOnce();
    await expect.poll(() => got.length).toBe(5);
    expect(got.map((e) => e.seq)).toEqual([21, 22, 23, 24, 25]);
    s.close();
  });
  it('refuse une reprise invalide', async () => {
    const s = open();
    expect(await s.emitWithAck('events:resume', { afterSeq: -1 })).toEqual({
      accepted: false,
      error: 'VALIDATION_ERROR',
    });
    s.close();
  });
  it('refuse la connexion sans principal', async () => {
    const s = open(lockedUrl);
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
    s.close();
  });
});

describe('kill switch et budgets', () => {
  const pause = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/v1/system/pause',
      payload: { reason: 'Incident test' },
      headers,
    });
  it('operator -> 403 ; admin -> pause effective, événement system.paused, idempotent', async () => {
    expect(
      (await pause({ 'idempotency-key': 'pause-op-1', 'x-dev-role': 'operator' })).statusCode,
    ).toBe(403);
    const ok = await pause({ 'idempotency-key': 'pause-admin-1' });
    expect(ok.json()).toMatchObject({ data: { paused: true, changed: true } });
    expect((await pause({ 'idempotency-key': 'pause-admin-2' })).json()).toMatchObject({
      data: { changed: false },
    });
    const boot = (await app.inject('/v1/bootstrap')).json<{
      data: { system: { paused: boolean }; timeline: { type: string }[] };
    }>();
    expect(boot.data.system.paused).toBe(true);
    expect(boot.data.timeline[0]?.type).toBe('system.paused');
    const resume = await app.inject({
      method: 'POST',
      url: '/v1/system/resume',
      payload: { reason: 'Fin incident' },
      headers: { 'idempotency-key': 'resume-1' },
    });
    expect(resume.json()).toMatchObject({ data: { paused: false, changed: true } });
  });
  it('GET /v1/budgets : org + 12 agents, en micro-dollars', async () => {
    const res = (await app.inject('/v1/budgets')).json<{
      data: { scopeType: string }[];
      meta: { unit: string };
    }>();
    expect(res.data).toHaveLength(13);
    expect(res.meta.unit).toBe('micro-USD');
  });
});

describe('validations (API)', () => {
  it('liste, décide (admin uniquement), double décision idempotente', async () => {
    const { proposeAgentHire } = await import('@company-os/db');
    const { approval } = await proposeAgentHire(db, {
      orgId: DEMO_ORG.id,
      requesterAgentId: 'hr-manager',
      taskId: null,
      proposal: { departmentId: 'operations', title: 'Support', justification: 'Charge en hausse' },
      idempotencyKey: 'api-test-hire',
      correlationId: '00000000-0000-4000-8000-0000000000ff',
      causationId: null,
    });
    const list = (await app.inject('/v1/approvals?status=pending')).json<{
      data: { id: string }[];
    }>();
    expect(list.data.map((a) => a.id)).toEqual([approval.id]);
    expect(
      (await app.inject({ url: '/v1/approvals', headers: { 'x-dev-role': 'viewer' } })).statusCode,
    ).toBe(403);
    const decide = (role: string, key: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/approvals/${approval.id}/decide`,
        payload: { decision: 'approve', reason: 'Validé en test' },
        headers: { 'idempotency-key': key, 'x-dev-role': role },
      });
    expect((await decide('operator', 'decide-op-1')).statusCode).toBe(403);
    const ok = await decide('admin', 'decide-admin-1');
    expect(ok.json()).toMatchObject({ data: { changed: true, approval: { status: 'approved' } } });
    expect((await decide('admin', 'decide-admin-2')).json()).toMatchObject({
      data: { changed: false },
    });
    const boot = (await app.inject('/v1/bootstrap')).json<{ data: { agents: unknown[] } }>();
    expect(boot.data.agents).toHaveLength(13);
  });
});
