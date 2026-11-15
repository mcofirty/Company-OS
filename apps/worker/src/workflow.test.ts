import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import {
  createTask,
  DEMO_ORG,
  listEventsByCorrelation,
  loadSnapshot,
  requestInvocation,
  startInvocation,
  startNextTask,
} from '@company-os/db';
import { ToolGateway } from '@company-os/tools';
import { runDemoTask } from './workflows/demoTask';
import { pickAutopilotKind, startWorker } from './worker';

const db = testDb();
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;
const gateway = new ToolGateway(db, { latencyScale: 0 });

beforeEach(() => resetAndSeed(db));
afterAll(() => db.$disconnect());

async function runOne(kind: Parameters<typeof createTask>[1]['kind'], agentId?: string) {
  const { task } = await createTask(db, { orgId: org, kind, agentId, requester: admin });
  const started = (await startNextTask(db, org))!;
  expect(started.task.id).toBe(task.id);
  const outcome = await runDemoTask(db, gateway, org, started);
  return { task, started, outcome };
}

describe('S02 — cycle complet qualify_lead (DEMO)', () => {
  it('tâche -> run -> CRM requested/started/succeeded -> tâche succeeded, même correlationId', async () => {
    const { task, outcome } = await runOne('qualify_lead', 'sdr-01');
    expect(outcome.status).toBe('succeeded');
    const events = await listEventsByCorrelation(db, org, task.correlationId);
    expect(events.map((e) => e.type)).toEqual([
      'task.created',
      'task.started',
      'agent.run.started',
      'tool.invocation.requested',
      'tool.invocation.started',
      'tool.invocation.succeeded',
      'agent.run.completed',
      'task.completed',
    ]);
    // Causalité chaînée après la création.
    for (let i = 2; i < events.length; i++)
      expect(events[i]!.causationId).toBe(events[i - 1]!.eventId);
    expect(events.every((e) => e.provenance === 'demo')).toBe(true);

    const snap = (await loadSnapshot(db, org))!;
    expect(snap.tasks.find((t) => t.id === task.id)?.status).toBe('succeeded');
    expect(snap.invocations[0]).toMatchObject({
      toolId: 'crm',
      status: 'succeeded',
      agentId: 'sdr-01',
    });
    expect(snap.agents.find((a) => a.id === 'sdr-01')).toMatchObject({
      activity: 'idle',
      currentTaskId: null,
    });
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
});

describe('S04 — erreur outil', () => {
  it('ERP 503 : nouvelle tentative, invocation failed, tâche blocked, aucun faux succès', async () => {
    const { task, outcome } = await runOne('check_invoice');
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'UPSTREAM_503' });
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.invocations[0]).toMatchObject({
      toolId: 'erp',
      status: 'failed',
      attempt: 2,
      errorCode: 'UPSTREAM_503',
    });
    const t = snap.tasks.find((x) => x.id === task.id)!;
    expect(t.status).toBe('blocked');
    expect(snap.agents.find((a) => a.id === t.agentId)?.activity).toBe('blocked');
    const types = (await listEventsByCorrelation(db, org, task.correlationId)).map((e) => e.type);
    expect(types).toContain('tool.invocation.failed');
    expect(types).not.toContain('task.completed');
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
});

describe('S07 — politique', () => {
  it('sans autorisation explicite : invocation rejected POLICY_DENIED', async () => {
    await db.agentToolGrant.delete({
      where: { agentId_toolId: { agentId: 'sdr-01', toolId: 'crm' } },
    });
    const { outcome } = await runOne('qualify_lead', 'sdr-01');
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'POLICY_DENIED' });
    expect((await db.toolInvocation.findFirstOrThrow()).status).toBe('rejected');
  });
  it("écriture externe (send_email) : refusée tant qu'il n'y a pas d'approbation", async () => {
    await db.agentToolGrant.update({
      where: { agentId_toolId: { agentId: 'support-01', toolId: 'email' } },
      data: { actions: ['draft_email', 'send_email'] },
    });
    await createTask(db, {
      orgId: org,
      kind: 'answer_ticket',
      agentId: 'support-01',
      requester: admin,
    });
    const started = (await startNextTask(db, org))!;
    const r = await gateway.invoke({
      orgId: org,
      runId: started.runId,
      agentId: 'support-01',
      toolId: 'email',
      action: 'send_email',
      input: { ticketRef: 'demo-ticket-311' },
      idempotencyKey: 'send-1',
      causationId: started.runEventId,
    });
    expect(r).toMatchObject({ status: 'rejected', reasonCode: 'APPROVAL_REQUIRED' });
  });
  it('kill switch : invocation rejetée', async () => {
    await createTask(db, { orgId: org, kind: 'qualify_lead', requester: admin });
    const started = (await startNextTask(db, org))!;
    await db.organization.update({ where: { id: org }, data: { killSwitch: true } });
    const outcome = await runDemoTask(db, gateway, org, started);
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'KILL_SWITCH' });
  });
});

describe('reprise après crash', () => {
  it('reprend une invocation en cours sans en créer une seconde', async () => {
    await createTask(db, { orgId: org, kind: 'qualify_lead', agentId: 'sdr-02', requester: admin });
    const started = (await startNextTask(db, org))!;
    // Simule un crash après le démarrage de l'outil.
    const req = await requestInvocation(db, {
      orgId: org,
      runId: started.runId,
      toolId: 'crm',
      action: 'lookup_lead',
      redactedInput: { leadRef: 'demo-lead-042' },
      idempotencyKey: `run:${started.runId}:step:1`,
      causationId: started.runEventId,
    });
    await startInvocation(db, {
      orgId: org,
      invocationId: req.invocation.id,
      attempt: 1,
      causationId: req.eventId,
    });
    const outcome = await runDemoTask(db, gateway, org, started);
    expect(outcome.status).toBe('succeeded');
    expect(await db.toolInvocation.count()).toBe(1);
    const snap = (await loadSnapshot(db, org))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
});

describe('worker', () => {
  it('exécute les tâches en file sans navigateur, une par agent', async () => {
    for (const kind of ['qualify_lead', 'draft_campaign', 'screen_candidates'] as const) {
      await createTask(db, { orgId: org, kind, requester: admin });
    }
    const w = startWorker(db, { orgId: org, pollMs: 20, gateway: { latencyScale: 0 } });
    await expect
      .poll(() => db.task.count({ where: { status: 'succeeded' } }), { timeout: 10_000 })
      .toBe(3);
    await w.stop();
  });
  it("l'autopilote est déterministe et rend l'erreur ERP rare", () => {
    expect(pickAutopilotKind(42)).toBe(pickAutopilotKind(42));
    const kinds = Array.from({ length: 500 }, (_, i) => pickAutopilotKind(i));
    const erp = kinds.filter((k) => k === 'check_invoice').length;
    expect(erp).toBeGreaterThan(0);
    expect(erp).toBeLessThan(100);
  });
});
