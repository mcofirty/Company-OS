import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import {
  createTask,
  DEMO_ORG,
  DomainError,
  finishTask,
  listEventsAfter,
  loadSnapshot,
  relayOutbox,
  seedDemo,
  startNextTask,
} from './index';

const db = testDb();
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;

beforeEach(() => resetAndSeed(db));
afterAll(() => db.$disconnect());

describe('seed démo', () => {
  it('12 agents, 6 départements, 8 outils, provenance demo, seq contigus', async () => {
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.agents).toHaveLength(12);
    expect(snap.departments).toHaveLength(6);
    expect(snap.tools).toHaveLength(8);
    expect(snap.agents.every((a) => a.provenance === 'demo' && a.status === 'active')).toBe(true);
    const events = await listEventsAfter(db, org, 0, 1000);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.every((e) => e.provenance === 'demo')).toBe(true);
    expect(await db.outbox.count()).toBe(events.length);
  });
  it('est relançable sans doublon', async () => {
    const before = await db.eventLog.count();
    expect((await seedDemo(db)).agentsCreated).toBe(0);
    expect(await db.eventLog.count()).toBe(before);
  });
  it('projection serveur = rejeu du journal par le réducteur client', async () => {
    const snap = (await loadSnapshot(db, org))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });
});

describe('tâches', () => {
  it('création idempotente par clé', async () => {
    const a = await createTask(db, {
      orgId: org,
      kind: 'qualify_lead',
      requester: admin,
      idempotencyKey: 'idem-key-001',
    });
    const b = await createTask(db, {
      orgId: org,
      kind: 'qualify_lead',
      requester: admin,
      idempotencyKey: 'idem-key-001',
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task.id).toBe(a.task.id);
    expect(await db.task.count()).toBe(1);
  });
  it('refuse un agent hors du département de la tâche, sans effet partiel', async () => {
    const before = await db.eventLog.count();
    await expect(
      createTask(db, { orgId: org, kind: 'qualify_lead', agentId: 'billing-01', requester: admin }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(await db.eventLog.count()).toBe(before);
    expect(await db.task.count()).toBe(0);
  });
  it('rejette une transition invalide (queued -> succeeded) sans écrire', async () => {
    const { task } = await createTask(db, { orgId: org, kind: 'qualify_lead', requester: admin });
    const before = await db.eventLog.count();
    await expect(
      finishTask(db, {
        orgId: org,
        taskId: task.id,
        runId: '00000000-0000-4000-8000-000000000000',
        causationId: null,
        outcome: { status: 'succeeded', resultRef: 'x', safeSummary: 'x' },
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await db.eventLog.count()).toBe(before);
  });
  it('seq reste contigu sous écritures concurrentes', async () => {
    await Promise.all(
      Array.from({ length: 15 }, () =>
        createTask(db, { orgId: org, kind: 'draft_campaign', requester: admin }),
      ),
    );
    const events = await listEventsAfter(db, org, 0, 1000);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });
  it('une seule tâche à la fois par agent', async () => {
    await createTask(db, { orgId: org, kind: 'weekly_review', requester: admin });
    await createTask(db, { orgId: org, kind: 'weekly_review', requester: admin });
    expect(await startNextTask(db, org)).not.toBeNull();
    expect(await startNextTask(db, org)).toBeNull(); // coo-01 est occupé
  });
  it('kill switch : aucune tâche ne démarre', async () => {
    await createTask(db, { orgId: org, kind: 'qualify_lead', requester: admin });
    await db.organization.update({ where: { id: org }, data: { killSwitch: true } });
    expect(await startNextTask(db, org)).toBeNull();
  });
});

describe('outbox', () => {
  it('au moins une fois : un échec de publication ne marque rien', async () => {
    await expect(
      relayOutbox(db, () => {
        throw new Error('down');
      }),
    ).rejects.toThrow('down');
    expect(await db.outbox.count({ where: { status: 'pending' } })).toBe(await db.eventLog.count());
    let seen = 0;
    while ((await relayOutbox(db, (e) => void (seen += e.length))) > 0);
    expect(seen).toBe(await db.eventLog.count());
    expect(await db.outbox.count({ where: { status: 'pending' } })).toBe(0);
  });
});
