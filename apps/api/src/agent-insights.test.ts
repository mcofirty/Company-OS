import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_ADMIN, initLiveOrg } from '@company-os/db';
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
const newAgent = async (name: string, budget = 5) => {
  const r = await call('POST', '/v1/agents', {
    name,
    title: 'Chargé de mission',
    departmentId: `${orgId.slice(0, 8)}-direction`,
    grants: { company: ['status'] },
    goal: 'Aider l’équipe',
    instructions: 'Réponses courtes, claires et sourcées.',
    monthlyBudgetUsd: budget,
    modelTier: 'balanced',
    skills: ['Synthèse'],
  });
  if (r.statusCode !== 201) throw new Error(r.body);
  return r.json().data.agentId as string;
};
const task = (
  agentId: string,
  status: string,
  startMin: number,
  endMin: number,
  parent?: string,
) => {
  const now = Date.now();
  return db.task.create({
    data: {
      id: randomUUID(),
      orgId,
      kind: 'custom',
      title: `Mission ${status}`,
      description: '',
      status,
      agentId,
      requesterType: 'user',
      requesterId: DEV_ADMIN.id,
      correlationId: randomUUID(),
      provenance: 'live',
      createdAt: new Date(now - startMin * 60_000),
      startedAt: new Date(now - startMin * 60_000),
      endedAt: new Date(now - endMin * 60_000),
      parentTaskId: parent ?? null,
    },
  });
};

describe('Fiche agent : indicateurs réels et duplication', () => {
  it('compte les missions sur 7 jours, la durée moyenne et les collègues (délégation)', async () => {
    const lea = await newAgent('Léa');
    const max = await newAgent('Max');
    const parent = await task(lea, 'succeeded', 60, 50); // 10 min
    await task(lea, 'succeeded', 40, 20); // 20 min
    await task(lea, 'blocked', 10, 5);
    await task(lea, 'succeeded', 60 * 24 * 9, 60 * 24 * 9 - 5); // hors fenêtre de 7 jours
    await task(max, 'succeeded', 45, 44, parent.id); // Max a travaillé pour Léa
    const r = await call('GET', `/v1/agents/${lea}`);
    expect(r.statusCode).toBe(200);
    const ins = r.json().data.insights;
    expect(ins.last7d).toEqual({ succeeded: 2, blocked: 1 });
    expect(ins.avgDurationMs).toBe(Math.round(((10 + 20 + 5) * 60_000) / 3));
    expect(ins.collaborators).toEqual([{ agentId: max, count: 1 }]);
    expect(ins.run).toBeNull();
    expect(r.json().data.budget.limitMicros).toBe(5_000_000);
  });

  it('duplique un agent (admin) : mêmes droits, modèle, budget et fiche ; refusé à un opérateur', async () => {
    const lea = await newAgent('Léa', 7);
    expect((await call('POST', `/v1/agents/${lea}/duplicate`, {}, 'operator')).statusCode).toBe(
      403,
    );
    const r = await call('POST', `/v1/agents/${lea}/duplicate`, {});
    expect(r.statusCode).toBe(201);
    const copy = await call('GET', `/v1/agents/${r.json().data.agentId}`);
    const d = copy.json().data;
    expect(d.agent.name).toBe('Léa 2');
    expect(d.grants).toEqual([{ toolId: 'company', actions: ['status'] }]);
    expect(d.budget.limitMicros).toBe(7_000_000);
    expect(d.profile.skills).toEqual(['Synthèse']);
    expect(d.versions[0].modelTier).toBe('balanced');
    expect(d.versions[0].instructions).toContain('Réponses courtes, claires et sourcées.');
  });
});
