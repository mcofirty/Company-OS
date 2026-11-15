import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { createDb } from '@company-os/db';
import { Client, Connection } from '@temporalio/client';
import { buildApp } from './app';
import type { ApprovalSignaler } from './routes/v1';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
});
const env = Env.parse(process.env);
if (env.APP_MODE === 'live') throw new Error('Mode live non implémenté (M2) : refus de démarrer.');

const db = createDb(env.DATABASE_URL);

// Client Temporal paresseux : l'API démarre même si Temporal est indisponible
// (le workflow revérifie alors la décision en base toutes les 20 s).
let temporal: Client | null = null;
const signalApproval: ApprovalSignaler = async (workflowId, approvalId, decision) => {
  temporal ??= new Client({
    connection: await Connection.connect({ address: env.TEMPORAL_ADDRESS, connectTimeout: '3s' }),
  });
  await temporal.workflow.getHandle(workflowId).signal('approvalDecided', { approvalId, decision });
};

const { app, relayOnce } = await buildApp({
  db,
  signalApproval,
  corsOrigin: env.WEB_ORIGIN,
  auth: { allowDevPrincipal: env.NODE_ENV !== 'production' && env.APP_MODE === 'demo' },
  logger: true,
});

// Relais outbox -> Socket.IO (polling court ; LISTEN/NOTIFY possible plus tard).
let stopped = false;
const relayLoop = async (): Promise<void> => {
  while (!stopped) {
    try {
      if ((await relayOnce()) === 0) await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      app.log.error({ err }, 'outbox relay failed, retrying');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

await app.listen({ port: env.API_PORT, host: env.API_HOST });
void relayLoop();

const shutdown = async (): Promise<void> => {
  stopped = true;
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
