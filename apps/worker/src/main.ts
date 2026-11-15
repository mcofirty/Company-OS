import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { createDb, DEMO_ORG } from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { createActivities, liveProviderFromEnv } from './activities';
import { createTemporalWorker, temporalLauncher } from './temporal';
import { initTelemetry } from './telemetry';
import { inlineLauncher, startDispatcher, type RunLauncher } from './worker';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  ORCHESTRATOR: z.enum(['temporal', 'inline']).default('temporal'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  DEMO_AUTOPILOT: z.enum(['true', 'false']).default('true'),
  DEMO_AUTOPILOT_INTERVAL_MS: z.coerce.number().int().min(1000).default(7000),
});
const env = Env.parse(process.env);
if (env.APP_MODE !== 'demo') {
  // Le runtime live existe (AnthropicProvider) mais l'organisation live et son authentification
  // ne sont pas encore livrées : refus explicite plutôt qu'un démarrage ambigu.
  throw new Error(
    'Mode live : utiliser `pnpm agent:live-smoke` (M2). Le worker continu live arrive avec l’auth (M5).',
  );
}

const log = (msg: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'worker', msg, ...extra }));

initTelemetry(process.env);
const db = createDb(env.DATABASE_URL);
const activities = createActivities({
  db,
  gateway: new ToolGateway(db),
  pricing: loadPricing(),
  liveProvider: liveProviderFromEnv(process.env),
});

let launcher: RunLauncher;
let stopWorker: () => Promise<void> = async () => undefined;
if (env.ORCHESTRATOR === 'temporal') {
  const worker = await createTemporalWorker(env.TEMPORAL_ADDRESS, activities);
  const running = worker.run();
  stopWorker = async () => {
    worker.shutdown();
    await running;
  };
  launcher = await temporalLauncher(env.TEMPORAL_ADDRESS, log);
} else {
  launcher = inlineLauncher(activities, log);
}

const dispatcher = startDispatcher(db, launcher, {
  orgId: DEMO_ORG.id,
  autopilot: {
    enabled: env.DEMO_AUTOPILOT === 'true',
    intervalMs: env.DEMO_AUTOPILOT_INTERVAL_MS,
    maxOpenTasks: 4,
  },
  log,
});
log('worker started', {
  mode: env.APP_MODE,
  orchestrator: env.ORCHESTRATOR,
  autopilot: env.DEMO_AUTOPILOT,
});

const shutdown = async (): Promise<void> => {
  log('worker stopping');
  await dispatcher.stop();
  await stopWorker();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
