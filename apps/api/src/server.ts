import path from 'node:path';
import { config } from 'dotenv';
import { createDb } from '@company-os/db';
import { buildApp } from './app';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL manquant');
const port = Number(process.env.API_PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

const db = createDb(databaseUrl);
const { app, relayOnce } = await buildApp({ db, webOrigin, logger: true });

// Relais outbox -> Socket.IO. Polling court (M0) ; LISTEN/NOTIFY envisageable plus tard.
let stopped = false;
const loop = async (): Promise<void> => {
  while (!stopped) {
    try {
      const n = await relayOnce();
      if (n === 0) await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      app.log.error({ err }, 'outbox relay failed, retrying');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

await app.listen({ port, host: '0.0.0.0' });
void loop();

const shutdown = async (): Promise<void> => {
  stopped = true;
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
