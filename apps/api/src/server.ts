import path from 'node:path';
import { config } from 'dotenv';
import { createDb, ensureCatalogTools } from '@company-os/db';
import { Client, Connection } from '@temporalio/client';
import { buildApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { initTelemetry } from './telemetry';
import type { ApprovalSignaler } from './routes/v1';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

let cfg: ApiConfig;
try {
  cfg = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
const { env } = cfg;
const stopTelemetry = initTelemetry(process.env);

const db = createDb(env.DATABASE_URL);
// Nouveaux outils du catalogue disponibles après une mise à jour, sans relancer de seed.
await ensureCatalogTools(db, { liveOnly: cfg.auth.hideDemoOrg ?? false });

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
  corsOrigin: cfg.corsOrigin,
  auth: cfg.auth,
  connectors: cfg.connectors,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MIN,
  opsDir: env.OPS_DIR ?? null,
  dailyReports: true,
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
  await stopTelemetry?.();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
