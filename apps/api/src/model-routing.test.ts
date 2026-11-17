import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MODEL_TIERS } from '@company-os/contracts';
import { DEV_ADMIN, initLiveOrg, startNextTask } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
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
const agent = async (modelTier?: string) => {
  const r = await post('/v1/agents', {
    name: `Agent ${randomUUID().slice(0, 4)}`,
    title: 'Assistant',
    departmentId: `${orgId.slice(0, 8)}-direction`,
    grants: { company: ['status'] },
    goal: 'Aider l’équipe',
    instructions: 'Réponses courtes et claires.',
    ...(modelTier ? { modelTier } : {}),
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().data.agentId as string;
};
const runModel = async (
  agentId: string,
  title: string,
  instructions: string,
  modelTier?: string,
) => {
  const r = await post('/v1/tasks', {
    kind: 'custom',
    agentId,
    mission: { title, instructions, ...(modelTier ? { modelTier } : {}) },
  });
  expect(r.statusCode).toBe(201);
  const started = await startNextTask(db, orgId);
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: started!.runId } });
  const ev = await db.eventLog.findFirstOrThrow({
    where: { type: 'agent.run.started', aggregateId: run.id },
  });
  return {
    model: run.model,
    reason: run.modelReason,
    routing: (ev.payload as { routing: unknown }).routing,
  };
};

describe('Optimisation automatique du modèle selon la mission', () => {
  it('agent en « auto » (défaut) : Haiku pour une tâche simple, Opus pour une stratégie', async () => {
    const a = await agent();
    const light = await runModel(a, 'Reformule ce message', 'Reformule poliment en 2 lignes.');
    expect(light.model).toBe(MODEL_TIERS.economy.model);
    expect(light.reason).toMatch(/^Tier 1/);
    expect(light.routing).toMatchObject({ tier: 'economy', auto: true });
    // L'agent est maintenant occupé : une autre recrue reçoit la mission lourde.
    const b = await agent();
    const heavy = await runModel(
      b,
      'Stratégie 2027',
      'Analyse approfondie du marché, benchmark des concurrents, plan d’action chiffré et roadmap.',
    );
    expect(heavy.model).toBe(MODEL_TIERS.quality.model);
    expect(heavy.routing).toMatchObject({ tier: 'quality', auto: true });
  });

  it('niveau fixé sur l’agent ou imposé pour une mission', async () => {
    const fixed = await agent('balanced');
    const r1 = await runModel(
      fixed,
      'Stratégie 2027',
      'Analyse approfondie et plan d’action complet.',
    );
    expect(r1.model).toBe(MODEL_TIERS.balanced.model);
    expect(r1.routing).toMatchObject({ tier: 'balanced', auto: false });
    const other = await agent();
    const r2 = await runModel(other, 'Reformule', 'Reformule en deux lignes.', 'quality');
    expect(r2.model).toBe(MODEL_TIERS.quality.model);
    expect(r2.reason).toContain('niveau choisi pour cette mission');
  });
});
