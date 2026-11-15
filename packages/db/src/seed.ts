import path from 'node:path';
import { config } from 'dotenv';
import { appendEvents, createDb, ensureCompany } from './index';
import { DEMO_COMPANY, demoSpawnEvents } from './demo';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
const db = createDb(url);
await ensureCompany(db, DEMO_COMPANY);
const events = await appendEvents(db, demoSpawnEvents(), { idempotencyKey: 'seed:demo:v1' });
console.log(`Seed demo OK : ${events.length} événements (idempotent).`);
await db.$disconnect();
