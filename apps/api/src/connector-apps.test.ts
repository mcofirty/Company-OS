import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appOfToolName, APP_CATALOG } from '@company-os/contracts';
import { DEV_ADMIN, initLiveOrg } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { startTestMcpServer, type TestMcpServer } from '../../../tests/setup/mcp-server';
import { buildApp } from './app';

const db = testDb();
const KEY = Buffer.alloc(32, 4);
const { app } = await buildApp({
  db,
  corsOrigin: 'https://hq.example.com',
  auth: { allowDevPrincipal: true },
  connectors: {
    secretKey: KEY,
    allowPrivateNetwork: true,
    publicApiUrl: 'https://api.example.com',
    webOrigin: 'https://hq.example.com',
  },
});
let oauthMcp: TestMcpServer;
let plainMcp: TestMcpServer;
let orgId = '';
beforeAll(async () => {
  oauthMcp = await startTestMcpServer({ oauth: true });
  plainMcp = await startTestMcpServer();
});
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
});
afterAll(async () => {
  await oauthMcp.close();
  await plainMcp.close();
  await app.close();
  await db.$disconnect();
});
const post = (url: string, payload: object) =>
  app.inject({
    method: 'POST',
    url,
    remoteAddress: '127.0.0.1',
    headers: { 'x-org-id': orgId, 'idempotency-key': `k-${randomUUID()}` },
    payload,
  });

describe('Catalogue d’applications et connexions', () => {
  it('catalogue : identifiants uniques ; outils de passerelle reconnus (gmail_send_email → Gmail)', () => {
    expect(new Set(APP_CATALOG.map((a) => a.id)).size).toBe(APP_CATALOG.length);
    expect(appOfToolName('gmail_send_email')?.id).toBe('gmail');
    expect(appOfToolName('whatsapp_send_message')?.id).toBe('whatsapp');
    expect(appOfToolName('google_sheets_create_spreadsheet_row')?.id).toBe('gsheets');
    expect(appOfToolName('search_notes')).toBeUndefined();
  });

  it('« Se connecter avec … » (OAuth MCP + PKCE) : jetons chiffrés, connecteur créé, retour cockpit', async () => {
    const start = await post('/v1/connectors/oauth/start', {
      name: 'Notion',
      url: oauthMcp.url,
      app: 'notion',
    });
    expect(start.statusCode).toBe(200);
    const authUrl = new URL(start.json().data.authorizationUrl);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/v1/connectors/oauth/callback',
    );
    // Consentement de l'humain (simulé par le serveur de test) : redirection avec le code.
    const consent = await fetch(authUrl, { redirect: 'manual' });
    const back = new URL(consent.headers.get('location')!);
    const cb = await app.inject({
      method: 'GET',
      url: `/v1/connectors/oauth/callback${back.search}`,
      remoteAddress: '203.0.113.9', // navigateur, sans jeton du cockpit
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toMatch(/^https:\/\/hq\.example\.com\/\?connector=ok/);
    const c = await db.connector.findFirstOrThrow({ where: { orgId } });
    expect(c).toMatchObject({ app: 'notion', authKind: 'oauth' });
    expect(c.oauthSealed).toMatch(/^v1:/);
    expect(c.oauthSealed).not.toContain('at-');
    expect(await db.connectorTool.count({ where: { connectorId: c.id } })).toBe(2);
    // Usage unique : rejouer le retour échoue proprement.
    const replay = await app.inject({
      method: 'GET',
      url: `/v1/connectors/oauth/callback${back.search}`,
      remoteAddress: '203.0.113.9',
    });
    expect(replay.headers.location).toContain('connector=error');
    // Synchronisation avec les jetons enregistrés.
    expect((await post(`/v1/connectors/${c.id}/sync`, {})).statusCode).toBe(200);
    // La machine-outil porte l'app (logo dans la barre d'applications).
    const boot = (
      await app.inject({
        method: 'GET',
        url: '/v1/bootstrap',
        remoteAddress: '127.0.0.1',
        headers: { 'x-org-id': orgId },
      })
    ).json().data;
    expect(boot.tools.find((t: { id: string }) => t.id === c.toolId)).toMatchObject({
      app: 'notion',
    });
  });

  it('passerelle (Zapier…) : adresse secrète chiffrée, jamais réaffichée', async () => {
    const secretUrl = `${plainMcp.url}?secret=zap-s3cr3t`;
    const r = await post('/v1/connectors', { name: 'Zapier', url: secretUrl, app: 'zapier' });
    expect(r.statusCode).toBe(201);
    const c = await db.connector.findFirstOrThrow({ where: { orgId } });
    expect(c.url).not.toContain('zap-s3cr3t');
    expect(c.urlSealed).toMatch(/^v1:/);
    expect(c.authKind).toBe('url');
    const list = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      remoteAddress: '127.0.0.1',
      headers: { 'x-org-id': orgId },
    });
    expect(list.body).not.toContain('zap-s3cr3t');
    expect((await post(`/v1/connectors/${c.id}/sync`, {})).statusCode).toBe(200);
  });
});
