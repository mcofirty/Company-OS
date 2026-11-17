import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const opsDir = await mkdtemp(path.join(os.tmpdir(), 'ops-'));
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
  opsDir,
});
beforeAll(async () => {
  await resetAndSeed(db);
  await mkdir(path.join(opsDir, 'status'), { recursive: true });
  await writeFile(
    path.join(opsDir, 'status', 'agent.json'),
    JSON.stringify({ seenAt: new Date().toISOString(), autoUpdate: true }),
  );
  await writeFile(
    path.join(opsDir, 'status', 'backups.json'),
    JSON.stringify([
      { file: 'companyos-20261122T033000Z.dump', size: 1024, createdAt: '2026-11-22T03:30:00Z' },
    ]),
  );
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
const call = (method: 'GET' | 'POST', url: string, payload?: object, role?: string) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: { ...(role ? { 'x-dev-role': role } : {}), 'idempotency-key': `k-${randomUUID()}` },
    ...(payload ? { payload } : {}),
  });

describe('Sauvegardes et mises à jour depuis le cockpit', () => {
  it('administrateur seulement ; état de l’agent hôte et liste des sauvegardes', async () => {
    expect((await call('GET', '/v1/ops', undefined, 'operator')).statusCode).toBe(403);
    const r = await call('GET', '/v1/ops');
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ available: true, online: true, autoUpdate: true });
    expect(r.json().data.backups).toHaveLength(1);
  });
  it('dépose des demandes validées (sauvegarde, restauration avec confirmation explicite)', async () => {
    expect((await call('POST', '/v1/ops/backup', {})).statusCode).toBe(202);
    expect(
      (await call('POST', '/v1/ops/restore', { file: 'companyos-20261122T033000Z.dump' }))
        .statusCode,
    ).toBe(400); // confirmation manquante
    expect(
      (await call('POST', '/v1/ops/restore', { file: '../../etc/passwd', confirm: 'RESTAURER' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/ops/restore', {
          file: 'companyos-20200101T000000Z.dump',
          confirm: 'RESTAURER',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', '/v1/ops/restore', {
          file: 'companyos-20261122T033000Z.dump',
          confirm: 'RESTAURER',
        })
      ).statusCode,
    ).toBe(202);
    const files = await readdir(path.join(opsDir, 'requests'));
    const bodies = await Promise.all(
      files.map((f) => readFile(path.join(opsDir, 'requests', f), 'utf8')),
    );
    expect(bodies.map((b) => JSON.parse(b).action).sort()).toEqual(['backup', 'restore']);
  });
});
