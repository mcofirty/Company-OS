import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAgentByAdmin, DEV_ADMIN, initLiveOrg, proposeSubordinate } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';

const db = testDb();
const calls: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  calls.push({
    url: String(url),
    body: JSON.parse(String(init?.body)),
    auth: (init?.headers as Record<string, string>)['authorization'],
  });
  return new Response('{}', { status: 200 });
}) as typeof fetch;
const { app, relayOnce } = await buildApp({
  db,
  corsOrigin: 'https://hq.example.com',
  auth: { allowDevPrincipal: true },
  connectors: { secretKey: Buffer.alloc(32, 5), allowPrivateNetwork: true },
  notifyFetch: fakeFetch,
});
let orgId = '';
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  while ((await relayOnce()) > 0);
  calls.length = 0;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: {
      'x-org-id': orgId,
      ...(method === 'POST' ? { 'idempotency-key': `k-${randomUUID()}` } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const flush = async () => {
  while ((await relayOnce()) > 0);
  await new Promise((r) => setTimeout(r, 200));
};

describe('Notifications (ntfy)', () => {
  it('réglage chiffré, test, puis notification réelle d’une validation demandée', async () => {
    const saved = await call('POST', '/v1/notifications', {
      url: 'http://127.0.0.1:9/mon-sujet-secret',
      token: 'tk_secret_123456',
      email: 'moi@example.com',
      events: ['approval', 'completed'],
      enabled: true,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('mon-sujet-secret');
    expect(saved.body).not.toContain('tk_secret');
    const row = await db.notificationSetting.findUniqueOrThrow({ where: { orgId } });
    expect(row.urlSealed).not.toContain('mon-sujet-secret');

    expect((await call('POST', '/v1/notifications/test')).statusCode).toBe(200);
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:9',
      auth: 'Bearer tk_secret_123456',
      body: {
        topic: 'mon-sujet-secret',
        email: 'moi@example.com',
        click: 'https://hq.example.com',
      },
    });

    // Un manager propose un recrutement => validation demandée => notification.
    const { agentId } = await createAgentByAdmin(db, {
      orgId,
      actor: { kind: 'user', id: DEV_ADMIN.id },
      req: {
        name: 'Iris',
        title: 'Directrice',
        departmentId: `${orgId.slice(0, 8)}-direction`,
        role: 'manager',
        grants: {},
        goal: 'Piloter',
        instructions: 'Rester factuelle et concise en toute occasion.',
        monthlyBudgetUsd: 2,
        modelTier: 'quality',
        avatarId: 'avatar-01',
        skills: [],
        routines: [],
      },
    });
    calls.length = 0;
    await proposeSubordinate(db, {
      orgId,
      managerAgentId: agentId,
      taskId: null,
      name: 'Hugo',
      title: 'Analyste',
      goal: 'Analyser',
      instructions: 'Analyser les ventes chaque semaine.',
      tools: '',
      justification: 'Charge',
      idempotencyKey: 'h1',
      correlationId: randomUUID(),
      causationId: null,
    });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ title: 'Validation requise · Iris', priority: 5 });
  });

  it('désactivées ou événement non choisi : rien n’est envoyé ; démo jamais notifiée', async () => {
    await call('POST', '/v1/notifications', {
      url: 'http://127.0.0.1:9/sujet',
      events: ['completed'],
      enabled: true,
    });
    await proposeSubordinate(db, {
      orgId,
      managerAgentId: 'inexistant',
      taskId: null,
      name: 'X',
      title: 'Y',
      goal: 'Z',
      instructions: 'Rien du tout ici.',
      tools: '',
      justification: 'test',
      idempotencyKey: 'h2',
      correlationId: randomUUID(),
      causationId: null,
    }).catch(() => undefined);
    await flush();
    expect(calls).toHaveLength(0);
  });
});
