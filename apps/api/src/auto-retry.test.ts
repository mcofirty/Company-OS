import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ADMIN, finishTask, initLiveOrg, loadSnapshot, startNextTask } from '@company-os/db';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
let orgId = '';
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
const post = (url: string, payload: object) =>
  app.inject({
    method: 'POST',
    url,
    remoteAddress: '127.0.0.1',
    headers: { 'x-org-id': orgId, 'idempotency-key': `k-${randomUUID()}` },
    payload,
  });

describe('Reprise automatique des erreurs techniques', () => {
  it('2 nouveaux essais (1 min puis 5 min) sans déranger, puis blocage définitif', async () => {
    const a = await post('/v1/agents', {
      name: 'Léa',
      title: 'Assistante',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      grants: { company: ['status'] },
      goal: 'Aider l’équipe',
      instructions: 'Réponses courtes et claires.',
    });
    const agentId = a.json().data.agentId as string;
    const t = await post('/v1/tasks', {
      kind: 'custom',
      agentId,
      mission: { title: 'Point du jour', instructions: 'Fais le point sur la journée.' },
    });
    const taskId = t.json().data.id as string;
    let now = new Date();
    const fail = async (code: string) => {
      const s = await startNextTask(db, orgId, now);
      expect(s?.task.id).toBe(taskId);
      return finishTask(db, {
        orgId,
        taskId,
        runId: s!.runId,
        causationId: s!.runEventId,
        outcome: { status: 'blocked', reasonCode: code, safeSummary: 'Service indisponible' },
        now,
      });
    };
    // Essai 1 en échec technique : remis en file, pas avant 1 min, aucun « task.blocked ».
    const r1 = await fail('PROVIDER_ERROR');
    expect(r1.status).toBe('queued');
    const row1 = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row1.autoRetries).toBe(1);
    expect(await startNextTask(db, orgId, new Date(now.getTime() + 30_000))).toBeNull();
    now = new Date(now.getTime() + 61_000);
    expect((await fail('TECHNICAL_ERROR')).status).toBe('queued');
    now = new Date(now.getTime() + 5 * 60_000 + 1000);
    // 3e échec : plus d'essai automatique, l'humain est prévenu (task.blocked).
    expect((await fail('PROVIDER_ERROR')).status).toBe('blocked');
    const types = (
      await db.eventLog.findMany({ where: { orgId, aggregateId: taskId }, orderBy: { seq: 'asc' } })
    ).map((e) => e.type);
    expect(types.filter((x) => x === 'task.retry_scheduled')).toHaveLength(2);
    expect(types.filter((x) => x === 'task.blocked')).toHaveLength(1);
    // La projection côté client reste identique à l'état serveur.
    const snap = (await loadSnapshot(db, orgId))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });

  it('erreur non technique (refus, budget) : bloquée tout de suite', async () => {
    const a = await post('/v1/agents', {
      name: 'Max',
      title: 'Assistant',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      grants: { company: ['status'] },
      goal: 'Aider l’équipe',
      instructions: 'Réponses courtes et claires.',
    });
    await post('/v1/tasks', {
      kind: 'custom',
      agentId: a.json().data.agentId,
      mission: { title: 'Point', instructions: 'Fais le point sur la journée.' },
    });
    const s = await startNextTask(db, orgId);
    const r = await finishTask(db, {
      orgId,
      taskId: s!.task.id,
      runId: s!.runId,
      causationId: s!.runEventId,
      outcome: { status: 'blocked', reasonCode: 'BUDGET_EXCEEDED', safeSummary: 'Budget' },
    });
    expect(r.status).toBe('blocked');
  });
});
