import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { createDb, DEMO_ORG } from '@company-os/db';
import { startWorker } from './worker';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  DEMO_AUTOPILOT: z.enum(['true', 'false']).default('true'),
  DEMO_AUTOPILOT_INTERVAL_MS: z.coerce.number().int().min(1000).default(7000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});
const env = Env.parse(process.env);
if (env.APP_MODE !== 'demo') {
  throw new Error('Le mode live n’est pas encore implémenté (M2) : refus de démarrer.');
}

const db = createDb(env.DATABASE_URL);
const log = (msg: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'worker', msg, ...extra }));

const worker = startWorker(db, {
  orgId: DEMO_ORG.id,
  concurrency: env.WORKER_CONCURRENCY,
  autopilot: {
    enabled: env.DEMO_AUTOPILOT === 'true',
    intervalMs: env.DEMO_AUTOPILOT_INTERVAL_MS,
    maxOpenTasks: 4,
  },
  log,
});
log('worker started', { mode: env.APP_MODE, autopilot: env.DEMO_AUTOPILOT });

const shutdown = async (): Promise<void> => {
  log('worker stopping');
  await worker.stop();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
