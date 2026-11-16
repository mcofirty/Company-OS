import path from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';
import { createDb } from '@company-os/db';
import { loadPricing, parseSecretKey } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { createActivities, liveProviderFromEnv } from './activities';
import { createTemporalWorker, temporalLauncher } from './temporal';
import { initTelemetry } from './telemetry';
import { inlineLauncher, startOrgDispatchers, type RunLauncher } from './worker';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  ORCHESTRATOR: z.enum(['temporal', 'inline']).default('temporal'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  DEMO_AUTOPILOT: z.enum(['true', 'false']).default('true'),
  DEMO_AUTOPILOT_INTERVAL_MS: z.coerce.number().int().min(1000).default(7000),
  /** Clé AES-256 (base64, 32 octets) des jetons de connecteurs MCP. */
  CONNECTOR_SECRET_KEY: z.string().optional(),
  /** Serveurs MCP en http:// ou sur réseau privé (développement uniquement). */
  CONNECTOR_ALLOW_PRIVATE_NETWORK: z.enum(['true', 'false']).default('false'),
});
const env = Env.parse(process.env);
if (env.APP_MODE !== 'demo') {
  // APP_MODE=live = connecteurs RÉELS (effets externes) : pas encore livrés, refus explicite.
  // Les organisations live (pnpm live:init) fonctionnent déjà avec APP_MODE=demo : vrai modèle
  // Claude, outils démo sans effet externe (mode « hybride », signalé dans le cockpit).
  throw new Error('APP_MODE=live (connecteurs réels) non disponible : garder APP_MODE=demo.');
}

const log = (msg: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'worker', msg, ...extra }));

initTelemetry(process.env);
const db = createDb(env.DATABASE_URL);
const liveProvider = liveProviderFromEnv(process.env);
const activities = createActivities({
  db,
  gateway: new ToolGateway(db, {
    connectorKey: parseSecretKey(env.CONNECTOR_SECRET_KEY || undefined),
    allowPrivateNetwork: env.CONNECTOR_ALLOW_PRIVATE_NETWORK === 'true',
  }),
  pricing: loadPricing(),
  liveProvider,
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

const dispatcher = startOrgDispatchers(db, launcher, {
  autopilot: {
    enabled: env.DEMO_AUTOPILOT === 'true',
    intervalMs: env.DEMO_AUTOPILOT_INTERVAL_MS,
    maxOpenTasks: 4,
  },
  log,
});
if (!liveProvider) {
  log('live provider missing', {
    effect: 'missions des organisations live refusées (PROVIDER_UNAVAILABLE) ; démo inchangée',
  });
}
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
