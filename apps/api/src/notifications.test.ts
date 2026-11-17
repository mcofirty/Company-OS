import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentByAdmin,
  DEV_ADMIN,
  dueDailyReports,
  initLiveOrg,
  markDailySent,
  proposeSubordinate,
} from '@company-os/db';
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
  connectors: {
    secretKey: Buffer.alloc(32, 5),
    allowPrivateNetwork: true,
    publicApiUrl: 'https://api.example.com',
  },
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

    // Boutons « Valider / Refuser » : liens signés vers l'API publique.
    const actions = calls[0]!.body['actions'] as { label: string; url: string; method: string }[];
    expect(actions.map((a) => a.label)).toEqual(['✅ Valider', '✖ Refuser']);
    const approve = new URL(actions[0]!.url);
    expect(approve.origin).toBe('https://api.example.com');
    // Lien falsifié : refusé, rien ne change.
    const forged = await app.inject({
      method: 'POST',
      url: `${approve.pathname}?t=${approve.searchParams.get('t')!.slice(0, -3)}AAA`,
      remoteAddress: '203.0.113.9',
    });
    expect(forged.statusCode).toBe(401);
    // Vrai lien, sans session : la demande est validée (et un second clic n'a pas d'effet).
    const ok = await app.inject({
      method: 'POST',
      url: `${approve.pathname}${approve.search}`,
      remoteAddress: '203.0.113.9',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ status: 'approved', changed: true });
    const again = await app.inject({
      method: 'POST',
      url: `${approve.pathname}${approve.search}`,
      remoteAddress: '203.0.113.9',
    });
    expect(again.json().data.changed).toBe(false);
    const appr = await db.approvalRequest.findFirstOrThrow({ where: { orgId } });
    expect(appr.reviewedBy).toContain(DEV_ADMIN.id);
    expect(appr.decisionReason).toBe('Validé depuis la notification');
  });

  it('rapport du matin : contenu réel, dû une seule fois par jour à l’heure choisie', async () => {
    await call('POST', '/v1/notifications', {
      url: 'http://127.0.0.1:9/sujet',
      events: ['daily'],
      enabled: true,
      dailyHour: 8,
      timezone: 'Europe/Paris',
    });
    const at = (iso: string) => new Date(iso);
    // 6 h UTC = 7 h à Paris (hiver) : pas encore ; 8 h UTC = 9 h : dû.
    expect(await dueDailyReports(db, at('2026-11-23T06:00:00Z'))).not.toContain(orgId);
    expect(await dueDailyReports(db, at('2026-11-23T08:00:00Z'))).toContain(orgId);
    await markDailySent(db, orgId, at('2026-11-23T08:00:00Z'));
    expect(await dueDailyReports(db, at('2026-11-23T15:00:00Z'))).not.toContain(orgId);
    expect(await dueDailyReports(db, at('2026-11-24T08:00:00Z'))).toContain(orgId);
    expect((await call('POST', '/v1/notifications/daily')).statusCode).toBe(200);
    const body = calls.at(-1)!.body;
    expect(body['title']).toBe('Ton QG ce matin (dernières 24 h)');
    expect(String(body['message'])).toContain('mission(s) terminée(s)');
    expect(String(body['message'])).toContain('Coût IA');
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
