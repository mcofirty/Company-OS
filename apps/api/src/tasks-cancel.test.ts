import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTask, DEMO_ORG, finishTask, loadSnapshot, startNextTask } from '@company-os/db';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;

beforeEach(() => resetAndSeed(db));
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const post = (url: string, payload: object, role?: string) =>
  app.inject({
    method: 'POST',
    url,
    remoteAddress: '127.0.0.1',
    payload,
    headers: { 'idempotency-key': `k-${Math.random()}`, ...(role ? { 'x-dev-role': role } : {}) },
  });

/** Tâche bloquée réelle : démarrée puis terminée en `blocked` par le service. */
async function blockedTask() {
  const { task } = await createTask(db, {
    orgId: org,
    kind: 'check_invoice',
    agentId: 'billing-01',
    requester: admin,
  });
  const started = (await startNextTask(db, org))!;
  await finishTask(db, {
    orgId: org,
    taskId: task.id,
    runId: started.runId,
    causationId: null,
    outcome: { status: 'blocked', reasonCode: 'UPSTREAM_503', safeSummary: 'ERP indisponible' },
  });
  return task;
}

describe('Annulation et relance de tâches', () => {
  it('annuler une tâche en file : statut, événement, agent au repos, projection = rejeu', async () => {
    const { task } = await createTask(db, {
      orgId: org,
      kind: 'qualify_lead',
      agentId: 'sdr-01',
      requester: admin,
    });
    const r = await post(`/v1/tasks/${task.id}/cancel`, { reason: 'Plus nécessaire' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      status: 'cancelled',
      resultSummary: 'Annulée : Plus nécessaire',
    });
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.agents.find((a) => a.id === 'sdr-01')?.activity).toBe('idle');
    const ev = snap.timeline.find((e) => e.type === 'task.cancelled')!;
    expect(ev).toMatchObject({
      actor: { kind: 'user' },
      payload: { reason: 'Plus nécessaire', retriedAs: null },
    });
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });

  it('annuler une tâche bloquée libère l’agent ; double annulation refusée ; motif obligatoire', async () => {
    const task = await blockedTask();
    expect((await loadSnapshot(db, org))!.agents.find((a) => a.id === 'billing-01')?.activity).toBe(
      'blocked',
    );
    expect((await post(`/v1/tasks/${task.id}/cancel`, { reason: 'x' })).statusCode).toBe(400);
    expect(
      (await post(`/v1/tasks/${task.id}/cancel`, { reason: 'ERP abandonné' })).statusCode,
    ).toBe(200);
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.agents.find((a) => a.id === 'billing-01')?.activity).toBe('idle');
    expect(
      (await post(`/v1/tasks/${task.id}/cancel`, { reason: 'encore' })).json().error.code,
    ).toBe('CONFLICT');
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });

  it('une tâche en cours peut être ARRÊTÉE : agent libéré, terminée = non annulable', async () => {
    const { task } = await createTask(db, {
      orgId: org,
      kind: 'qualify_lead',
      agentId: 'sdr-01',
      requester: admin,
    });
    await startNextTask(db, org);
    const r = await post(`/v1/tasks/${task.id}/cancel`, { reason: 'Mission bloquée' });
    expect(r.statusCode).toBe(200);
    expect(await db.agentRun.findFirstOrThrow({ where: { taskId: task.id } })).toMatchObject({
      status: 'cancelled',
    });
    const agent = await db.agent.findUniqueOrThrow({ where: { id: 'sdr-01' } });
    expect(agent.currentTaskId).toBeNull();
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.agents.find((a) => a.id === 'sdr-01')).toMatchObject({ currentTaskId: null });
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
    // Déjà terminée : refus.
    expect(
      (await post(`/v1/tasks/${task.id}/cancel`, { reason: 'Encore' })).json().error.code,
    ).toBe('CONFLICT');
  });

  it('relancer une tâche bloquée : nouvelle tâche identique, ancienne annulée et reliée', async () => {
    const task = await blockedTask();
    const r = await post(`/v1/tasks/${task.id}/retry`, {});
    expect(r.statusCode).toBe(201);
    const { task: fresh, replaced } = r.json().data;
    expect(fresh).toMatchObject({ kind: 'check_invoice', agentId: 'billing-01', status: 'queued' });
    expect(replaced).toMatchObject({ id: task.id, status: 'cancelled' });
    const snap = (await loadSnapshot(db, org))!;
    const ev = snap.timeline.find((e) => e.type === 'task.cancelled')!;
    expect(ev.payload).toMatchObject({ retriedAs: fresh.id, reason: 'Relancée' });
    expect(snap.agents.find((a) => a.id === 'billing-01')?.activity).toBe('queued');
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
    // Relancer à nouveau l'ancienne (désormais annulée) : refusé.
    expect((await post(`/v1/tasks/${task.id}/retry`, {})).json().error.code).toBe('CONFLICT');
  });

  it('viewer : annulation et relance refusées (403)', async () => {
    const task = await blockedTask();
    expect(
      (await post(`/v1/tasks/${task.id}/cancel`, { reason: 'Non' }, 'viewer')).statusCode,
    ).toBe(403);
    expect((await post(`/v1/tasks/${task.id}/retry`, {}, 'viewer')).statusCode).toBe(403);
  });
});
