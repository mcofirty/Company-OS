import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvents,
  createDb,
  DEMO_COMPANY,
  demoSpawnEvents,
  DomainError,
  ensureCompany,
  listEventsAfter,
  loadWorldSnapshot,
  relayOutbox,
} from './index';

const url = process.env.DATABASE_URL_TEST;
if (!url) throw new Error('DATABASE_URL_TEST manquant');
const db = createDb(url);

beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "OutboxMessage", "Event", "Agent", "Company" CASCADE');
  await ensureCompany(db, DEMO_COMPANY);
});
afterAll(() => db.$disconnect());

describe('appendEvents', () => {
  it('écrit état + journal + outbox dans la même transaction', async () => {
    const events = await appendEvents(db, demoSpawnEvents());
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(await db.agent.count()).toBe(5);
    expect(await db.outboxMessage.count({ where: { publishedAt: null } })).toBe(5);
    const snap = await loadWorldSnapshot(db, DEMO_COMPANY.id);
    expect(snap?.lastSeq).toBe(events.at(-1)?.seq);
    expect(snap?.agents.every((a) => a.mode === 'demo' && a.status === 'idle')).toBe(true);
  });

  it('annule tout le lot si un événement est invalide (aucun effet partiel)', async () => {
    const [first] = demoSpawnEvents();
    await expect(
      appendEvents(db, [
        first!,
        {
          type: 'agent.moved',
          companyId: DEMO_COMPANY.id,
          mode: 'demo',
          actor: { kind: 'system', id: null },
          payload: { agentId: 'ag_inconnu', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        },
      ]),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await db.agent.count()).toBe(0);
    expect(await db.event.count()).toBe(0);
    expect(await db.outboxMessage.count()).toBe(0);
  });

  it('refuse un événement live dans une entreprise demo', async () => {
    const [first] = demoSpawnEvents();
    await expect(appendEvents(db, [{ ...first!, mode: 'live' }])).rejects.toMatchObject({
      code: 'mode_mismatch',
    });
  });

  it('est idempotent avec une idempotencyKey', async () => {
    const a = await appendEvents(db, demoSpawnEvents(), { idempotencyKey: 'k1' });
    const b = await appendEvents(db, demoSpawnEvents(), { idempotencyKey: 'k1' });
    expect(b.map((e) => e.id)).toEqual(a.map((e) => e.id));
    expect(await db.event.count()).toBe(5);
  });

  it('garde des seq ordonnés sous écritures concurrentes', async () => {
    await appendEvents(db, demoSpawnEvents());
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        appendEvents(db, [
          {
            type: 'agent.status_changed',
            companyId: DEMO_COMPANY.id,
            mode: 'demo',
            actor: { kind: 'system', id: null },
            payload: { agentId: 'ag_demo_eng', status: 'working', activity: `tâche ${i}` },
          },
        ]),
      ),
    );
    const all = await listEventsAfter(db, DEMO_COMPANY.id, 0);
    expect(all).toHaveLength(25);
  });
});

describe('relayOutbox', () => {
  it('publie une fois puis marque comme publié ; retente après échec', async () => {
    await appendEvents(db, demoSpawnEvents());
    await expect(
      relayOutbox(db, () => {
        throw new Error('socket down');
      }),
    ).rejects.toThrow('socket down');
    expect(await db.outboxMessage.count({ where: { publishedAt: null } })).toBe(5);

    const published: number[] = [];
    expect(await relayOutbox(db, (evts) => void published.push(...evts.map((e) => e.seq)))).toBe(5);
    expect(await relayOutbox(db, () => undefined)).toBe(0);
    expect(published).toHaveLength(5);
  });
});
