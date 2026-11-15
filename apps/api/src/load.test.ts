import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTask, DEMO_ORG } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

/**
 * Charge (docs/08 §3) : `GET /v1/bootstrap` p95 < 500 ms sur base locale, en HTTP réel, avec un
 * journal chargé (200 tâches) et 10 clients concurrents.
 */
const db = testDb();
const { app } = await buildApp({
  db,
  corsOrigin: 'http://localhost:3000',
  auth: { allowDevPrincipal: true },
  rateLimitPerMinute: 100_000,
});
let base = '';

beforeAll(async () => {
  await resetAndSeed(db);
  const kinds = ['qualify_lead', 'check_invoice', 'draft_campaign', 'answer_ticket'] as const;
  for (let i = 0; i < 200; i++) {
    await createTask(db, {
      orgId: DEMO_ORG.id,
      kind: kinds[i % kinds.length]!,
      requester: { kind: 'user', id: 'load' },
    });
  }
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
}, 120_000);
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

describe('M5 — charge API', () => {
  it('bootstrap : p95 < 500 ms (200 requêtes, 10 concurrentes)', async () => {
    const timings: number[] = [];
    const one = async (): Promise<void> => {
      const t0 = performance.now();
      const r = await fetch(`${base}/v1/bootstrap`);
      await r.arrayBuffer();
      expect(r.status).toBe(200);
      timings.push(performance.now() - t0);
    };
    await one(); // préchauffage (connexions, plans de requête)
    timings.length = 0;
    for (let batch = 0; batch < 20; batch++) await Promise.all(Array.from({ length: 10 }, one));
    const p50 = percentile(timings, 50);
    const p95 = percentile(timings, 95);
    console.log(`bootstrap n=${timings.length} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms`);
    expect(p95).toBeLessThan(500);
  }, 120_000);
});
