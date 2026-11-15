import path from 'node:path';
import { config } from 'dotenv';
import { appendEvents, createDb, DEMO_COMPANY, loadWorldSnapshot } from '@company-os/db';
import { nextDemoStep } from './sim';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL manquant');
const intervalMs = Number(process.env.DEMO_TICK_MS ?? 2500);
const db = createDb(databaseUrl);

let stopped = false;
process.on('SIGINT', () => (stopped = true));
process.on('SIGTERM', () => (stopped = true));

console.log(`[worker] simulateur demo démarré (tick ${intervalMs} ms) pour ${DEMO_COMPANY.id}`);
while (!stopped) {
  try {
    const world = await loadWorldSnapshot(db, DEMO_COMPANY.id);
    if (world) {
      const events = nextDemoStep(world);
      // Clé d'idempotence liée à l'état : deux workers ne peuvent pas jouer le même pas.
      if (events.length) {
        await appendEvents(db, events, { idempotencyKey: `demo:step:${world.lastSeq}` });
      }
    }
  } catch (err) {
    console.error('[worker] erreur de tick', err);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
await db.$disconnect();
