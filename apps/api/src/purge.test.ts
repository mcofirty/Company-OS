import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_ORG, DEV_ADMIN, initLiveOrg, purgeDemoData } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
afterAll(() => db.$disconnect());

describe('Serveur « réel uniquement »', () => {
  it('retire la démonstration et ses données, sans toucher l’organisation live', async () => {
    await resetAndSeed(db);
    const { orgId } = await initLiveOrg(db, {
      name: 'Ma Société',
      adminUserIds: [DEV_ADMIN.id],
      monthlyBudgetUsd: 5,
    });
    const liveEvents = await db.eventLog.count({ where: { orgId } });
    const r = await purgeDemoData(db);
    expect(r.organizations).toBe(1);
    expect(r.agents).toBe(12);
    expect(await db.organization.findUnique({ where: { id: DEMO_ORG.id } })).toBeNull();
    expect(await db.agent.count({ where: { orgId: DEMO_ORG.id } })).toBe(0);
    expect(await db.eventLog.count({ where: { orgId: DEMO_ORG.id } })).toBe(0);
    // Plus aucun outil fictif ; les outils réels et l'organisation live restent intacts.
    const tools = (await db.tool.findMany({ where: { orgId: null } })).map((t) => t.id).sort();
    expect(tools).toEqual(['company', 'library', 'team', 'web']);
    expect(await db.eventLog.count({ where: { orgId } })).toBe(liveEvents);
    // Idempotent.
    expect(await purgeDemoData(db)).toMatchObject({ organizations: 0, agents: 0 });

    // L'administrateur arrive directement sur son organisation live, sans démo proposée.
    const { app } = await buildApp({
      db,
      corsOrigin: 'http://localhost:3000',
      auth: { allowDevPrincipal: true, hideDemoOrg: true },
    });
    const me = (
      await app.inject({ method: 'GET', url: '/v1/me', remoteAddress: '127.0.0.1' })
    ).json().data;
    expect(me.orgId).toBe(orgId);
    expect(me.orgs).toHaveLength(1);
    const boot = (
      await app.inject({ method: 'GET', url: '/v1/bootstrap', remoteAddress: '127.0.0.1' })
    ).json().data;
    expect(boot.org.mode).toBe('live');
    await app.close();
    await resetAndSeed(db); // les autres suites repartent de l'état de test habituel
  });
});
