import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ADMIN, initLiveOrg, loadSnapshot, rollBudgetPeriods } from '@company-os/db';
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
const call = (method: 'GET' | 'POST', url: string, payload?: object, role?: string) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      'x-org-id': orgId,
      ...(role ? { 'x-dev-role': role } : {}),
      ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const newAgent = async (modelTier?: string) =>
  (
    await call('POST', '/v1/agents', {
      name: 'Iris',
      title: 'Directrice générale',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      grants: { company: ['status'] },
      goal: 'Piloter l’entreprise',
      instructions: 'Rapport hebdomadaire clair, chiffres sourcés.',
      ...(modelTier ? { modelTier } : {}),
    })
  ).json().data.agentId as string;

describe('Administration des agents', () => {
  it('niveau de modèle à la création, puis nouvelle version (objectif, consignes, modèle)', async () => {
    const id = await newAgent('economy');
    let v = await db.agentVersion.findFirstOrThrow({ where: { agentId: id } });
    expect((v.modelPolicy as { model: string }).model).toBe('claude-haiku-5-5');
    const body = {
      goal: 'Piloter et rendre compte chaque semaine',
      instructions: 'Rapport le lundi, trois priorités, risques en tête.',
      modelTier: 'balanced',
      note: 'Rapport hebdo',
    };
    expect((await call('POST', `/v1/agents/${id}/version`, body, 'operator')).statusCode).toBe(403);
    const r = await call('POST', `/v1/agents/${id}/version`, body);
    expect(r.json().data.version).toBe(2);
    const agent = await db.agent.findUniqueOrThrow({ where: { id } });
    expect(agent.activeVersion).toBe(2);
    v = await db.agentVersion.findFirstOrThrow({ where: { agentId: id, version: 2 } });
    expect(v.goal).toBe(body.goal);
    expect(v.instructions).toContain('Rapport le lundi'); // consignes admin
    expect(v.instructions.indexOf('Rapport le lundi')).toBeGreaterThan(0); // règles plateforme d'abord
    expect((v.modelPolicy as { model: string }).model).toBe('claude-sonnet-5-5');
    const card = (await call('GET', `/v1/agents/${id}`)).json().data;
    expect(card.versions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(card.versions[0]).toMatchObject({
      modelTier: 'balanced',
      instructions: body.instructions,
    });
    const models = (await call('GET', '/v1/models')).json().data;
    expect(models.map((m: { tier: string }) => m.tier)).toEqual(['quality', 'balanced', 'economy']);
    expect(models[2].estimatedMissionUsd).toBeLessThan(models[0].estimatedMissionUsd);
  });

  it('budgets : plafond modifiable par un admin (tracé), remise à zéro mensuelle', async () => {
    const id = await newAgent();
    const b = await db.budget.findFirstOrThrow({
      where: { orgId, scopeType: 'agent', scopeId: id },
    });
    await db.budget.update({ where: { id: b.id }, data: { usedMicros: 4_900_000 } });
    expect(
      (
        await call(
          'POST',
          '/v1/budgets',
          { scopeType: 'agent', scopeId: id, monthlyLimitUsd: 20 },
          'operator',
        )
      ).statusCode,
    ).toBe(403);
    const r = await call('POST', '/v1/budgets', {
      scopeType: 'agent',
      scopeId: id,
      monthlyLimitUsd: 20,
    });
    expect(r.statusCode).toBe(200);
    expect((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).limitMicros).toBe(
      20_000_000,
    );
    await call('POST', '/v1/budgets', { scopeType: 'org', scopeId: 'x', monthlyLimitUsd: 50 });
    const org = await db.budget.findFirstOrThrow({ where: { orgId, scopeType: 'org' } });
    expect(org.limitMicros).toBe(50_000_000);
    // Nouveau mois : consommation remise à zéro, événement émis (projection cohérente).
    const next = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1, 0, 5),
    );
    expect(await rollBudgetPeriods(db, next)).toBeGreaterThan(0);
    expect((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).usedMicros).toBe(0);
    expect(await rollBudgetPeriods(db, next)).toBe(0); // idempotent
    const snap = (await loadSnapshot(db, orgId))!;
    expect(snap.budgets.find((x) => x.id === b.id)).toMatchObject({ limitMicros: 20_000_000 });
    expect(comparable(await foldAll(db, snap)).budgets).toEqual(comparable(snap).budgets);
  });
});
