import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_ADMIN,
  feedbackMemory,
  finishTask,
  initLiveOrg,
  loadSnapshot,
  startNextTask,
} from '@company-os/db';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
});
let orgId = '';
let dept = '';
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  dept = `${orgId.slice(0, 8)}-direction`;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      'x-org-id': orgId,
      ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const agent = async (name: string, role: 'manager' | 'specialist' = 'specialist') => {
  const r = await call('POST', '/v1/agents', {
    name,
    title: role === 'manager' ? 'Responsable' : 'Chargé de mission',
    departmentId: dept,
    role,
    grants: { company: ['status'] },
    goal: 'Aider l’équipe',
    instructions: 'Réponses courtes, claires et sourcées.',
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().data.agentId as string;
};
const mission = async (agentId: string, title: string, extra: object = {}) => {
  const r = await call('POST', '/v1/tasks', {
    kind: 'custom',
    agentId,
    mission: { title, instructions: 'Instructions de test suffisamment longues.', ...extra },
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().data.id as string;
};
/** Exécute les tâches en file jusqu'à celle visée (les autres réussissent simplement). */
const finish = async (
  taskId: string,
  summary = 'Fait.',
  status: 'succeeded' | 'blocked' = 'succeeded',
) => {
  for (let i = 0; i < 20; i++) {
    const s = await startNextTask(db, orgId);
    if (!s) throw new Error('aucune tâche démarrable');
    const target = s.task.id === taskId;
    await finishTask(db, {
      orgId,
      taskId: s.task.id,
      runId: s.runId,
      causationId: s.runEventId,
      outcome:
        target && status === 'blocked'
          ? { status: 'blocked', reasonCode: 'MODEL_REFUSAL', safeSummary: summary }
          : {
              status: 'succeeded',
              resultRef: `artifact://run/${s.runId}`,
              safeSummary: target ? summary : 'Fait.',
            },
    });
    if (target) return;
  }
  throw new Error('tâche jamais démarrée');
};

describe('Fonctionnement des agents', () => {
  it('objectif de pôle : plan confié au responsable, progression par missions réussies', async () => {
    const chief = await agent('Iris', 'manager');
    await db.department.update({ where: { id: dept }, data: { managerAgentId: chief } });
    const r = await call('POST', '/v1/objectives', {
      departmentId: dept,
      title: '10 posts LinkedIn',
      target: 10,
    });
    expect(r.statusCode).toBe(201);
    const { objectiveId, planningTaskId } = r.json().data;
    expect(planningTaskId).toBeTruthy();
    const plan = await db.task.findUniqueOrThrow({ where: { id: planningTaskId } });
    expect(plan.agentId).toBe(chief);
    expect(plan.objectiveCounts).toBe(false);
    await finish(planningTaskId);
    const m = await mission(chief, 'Post LinkedIn #1', { objectiveId });
    await finish(m);
    const list = (await call('GET', '/v1/objectives')).json().data;
    expect(list[0]).toMatchObject({ title: '10 posts LinkedIn', target: 10, done: 1 });
  });

  it('contrôle qualité : un second agent relit avant restitution', async () => {
    const chief = await agent('Iris', 'manager');
    const writer = await agent('Léo');
    expect(
      (
        await call('POST', `/v1/agents/${writer}/reporting`, {
          managerId: chief,
          role: 'specialist',
        })
      ).statusCode,
    ).toBe(200);
    const t = await mission(writer, 'Article de blog', { qualityCheck: true });
    await finish(t, 'Article rédigé.');
    const review = await db.task.findFirstOrThrow({ where: { reviewOf: t } });
    expect(review.agentId).toBe(chief);
    expect((await db.task.findUniqueOrThrow({ where: { id: t } })).reviewStatus).toBe('pending');
    await finish(review.id, 'À REVOIR : le chiffre du 2e paragraphe n’est pas sourcé.');
    const done = await call('GET', `/v1/tasks/${t}`);
    expect(done.json().data.quality).toMatchObject({ reviewStatus: 'issues' });
    expect(done.json().data.quality.reviewNotes).toContain('pas sourcé');
    const snap = (await loadSnapshot(db, orgId))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });

  it('retour de l’humain : retenu pour la suite et relance de la mission', async () => {
    const a = await agent('Léo');
    const t = await mission(a, 'Newsletter');
    await finish(t);
    const r = await call('POST', `/v1/tasks/${t}/feedback`, {
      kind: 'correction',
      note: 'Toujours tutoyer nos lecteurs.',
      relaunch: true,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.followUpTaskId).toBeTruthy();
    expect(await feedbackMemory(db, orgId, a)).toContain('Toujours tutoyer nos lecteurs.');
  });

  it('mission en chaîne : étapes enchaînées, résultat transmis, validation humaine finale', async () => {
    const a = await agent('Léo');
    const b = await agent('Jade');
    const c = await agent('Tom');
    const r = await call('POST', '/v1/chains', {
      templateId: 'content-linkedin',
      topic: 'IA dans les PME',
      agentIds: [a, b, c],
    });
    expect(r.statusCode).toBe(201);
    const chainId = r.json().data.chainId as string;
    const step = async (i: number) =>
      (await call('GET', '/v1/chains')).json().data.find((x: { id: string }) => x.id === chainId)
        .steps[i];
    await finish((await step(0)).taskId, 'Veille : 6 tendances.');
    const s1 = await db.task.findUniqueOrThrow({ where: { id: (await step(1)).taskId } });
    expect(s1.agentId).toBe(b);
    expect(s1.description).toContain('Veille : 6 tendances.');
    await finish(s1.id, 'Article prêt.');
    await finish((await step(2)).taskId, 'Post prêt.');
    const chain = (await call('GET', '/v1/chains')).json().data[0];
    expect(chain.status).toBe('awaiting_validation');
    expect(
      (await call('POST', `/v1/chains/${chainId}/decide`, { decision: 'validate' })).statusCode,
    ).toBe(200);
    expect((await call('GET', '/v1/chains')).json().data[0].status).toBe('done');
  });

  it('tableau des coûts : par agent, pôle, niveau, et économie du mode Auto', async () => {
    const a = await agent('Léo');
    const t = await mission(a, 'Reformule ce message court');
    await finish(t);
    const run = await db.agentRun.findFirstOrThrow({ where: { taskId: t } });
    await db.agentRun.update({
      where: { id: run.id },
      data: { inputTokens: 20_000, outputTokens: 2_000, costMicros: 30_000 },
    });
    const r = await call('GET', '/v1/costs');
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.totalMicros).toBe(30_000);
    expect(d.byAgent[0]).toMatchObject({ name: 'Léo', micros: 30_000, runs: 1 });
    expect(d.byTier.find((x: { tier: string }) => x.tier === 'economy').runs).toBe(1);
    expect(d.autoRuns).toBe(1);
    expect(d.autoSavingsMicros).toBeGreaterThan(0);
  });
});

describe('Personnalisation du plateau', () => {
  it('échange deux pôles de zone : postes réattribués, projection identique', async () => {
    const a = await agent('Léo');
    const before = await db.agent.findUniqueOrThrow({ where: { id: a } });
    const fin = `${orgId.slice(0, 8)}-finance`;
    const finDept = await db.department.findUniqueOrThrow({ where: { id: fin } });
    const r = await call('POST', `/v1/departments/${dept}/move`, { roomId: finDept.roomId });
    expect(r.statusCode).toBe(200);
    const d1 = await db.department.findUniqueOrThrow({ where: { id: dept } });
    const d2 = await db.department.findUniqueOrThrow({ where: { id: fin } });
    expect(d1.roomId).toBe(finDept.roomId);
    expect(d2.roomId).toBe('direction');
    const after = await db.agent.findUniqueOrThrow({ where: { id: a } });
    expect(after.deskAnchor).toBe(before.deskAnchor.replace('direction', finDept.roomId));
    const snap = (await loadSnapshot(db, orgId))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
  it('identité visuelle : enregistrée, SVG refusé', async () => {
    const ok = await call('POST', '/v1/branding', {
      neonText: 'ACME',
      neonColor: '#22c55e',
      logo: 'data:image/png;base64,iVBORw0KGgo=',
      zoneStyles: { direction: 'tech' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', '/v1/branding')).json().data).toMatchObject({ neonText: 'ACME' });
    const svg = await call('POST', '/v1/branding', {
      neonText: 'ACME',
      neonColor: '#22c55e',
      logo: 'data:image/svg+xml;base64,PHN2Zz4=',
      zoneStyles: {},
    });
    expect(svg.statusCode).toBe(400);
  });
});
