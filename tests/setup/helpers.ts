import type { WorldSnapshot } from '@company-os/contracts';
import { createDb, DEMO_ORG, listEventsAfter, seedDemo, type Db } from '@company-os/db';
import { applyEvents } from '@company-os/world';

export function testDb(): Db {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquant');
  return createDb(url);
}

export async function resetAndSeed(
  db: Db,
  now = new Date('2026-01-01T09:00:00.000Z'),
): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE outbox, event_log, tool_invocations, agent_runs, tasks, agent_tool_grants, agents,
     departments, tools, memberships, users, idempotency_keys, organizations CASCADE`,
  );
  await seedDemo(db, now);
}

/** Snapshot vide de l'org démo (point de départ pour rejouer tout le journal). */
export function emptySnapshot(base: WorldSnapshot): WorldSnapshot {
  return { ...base, lastSeq: 0, agents: [], tasks: [], invocations: [], timeline: [] };
}

/** Projection client (fold du journal) à comparer au snapshot serveur. */
export async function foldAll(db: Db, base: WorldSnapshot): Promise<WorldSnapshot> {
  const events = await listEventsAfter(db, DEMO_ORG.id, 0, 10_000);
  return applyEvents(emptySnapshot(base), events);
}

export function comparable(w: WorldSnapshot) {
  return {
    lastSeq: w.lastSeq,
    agents: w.agents,
    tasks: [...w.tasks].sort((a, b) => a.id.localeCompare(b.id)),
    invocations: [...w.invocations].sort((a, b) => a.id.localeCompare(b.id)),
    timeline: w.timeline.map((e) => e.seq),
  };
}
