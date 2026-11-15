import { execSync } from 'node:child_process';
import path from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

/**
 * Vide la base de TEST (et uniquement elle : le nom doit finir par `_test`)
 * puis applique les migrations versionnées.
 */
export default async function setup(): Promise<void> {
  config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquant (voir .env.example)');
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`Refus : DATABASE_URL_TEST doit viser une base *_test (reçu ${url})`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../../packages/db'),
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
