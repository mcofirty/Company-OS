import path from 'node:path';
import { config } from 'dotenv';
import { createDb } from './client';
import { seedDemo } from './seed';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
if (process.env.APP_MODE && process.env.APP_MODE !== 'demo') {
  throw new Error('Le seed démo est refusé hors APP_MODE=demo');
}
const db = createDb(url);
const r = await seedDemo(db);
console.log(`Seed démo OK : ${r.agentsCreated} agent(s) créé(s) (relançable sans doublon).`);
await db.$disconnect();
