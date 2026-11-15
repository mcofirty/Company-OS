import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { DEMO_ORG, grantAccess } from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { startMockIdp, type MockIdp } from '../../../tests/setup/mock-idp';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createOidcVerifier, oidcSubject } from './oidc';

const db = testDb();
let idp: MockIdp;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let baseUrl = '';

beforeAll(async () => {
  idp = await startMockIdp();
  ({ app } = await buildApp({
    db,
    corsOrigin: 'https://hq.example.com',
    rateLimitPerMinute: 1000,
    auth: {
      allowDevPrincipal: false,
      oidc: createOidcVerifier({
        issuer: idp.issuer,
        audience: idp.audience,
        clientId: idp.clientId,
        scope: 'openid',
      }),
    },
  }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await resetAndSeed(db);
  await grantAccess(db, {
    orgId: DEMO_ORG.id,
    subject: oidcSubject(idp.issuer, 'alice'),
    displayName: 'Alice Admin',
    role: 'admin',
  });
  await grantAccess(db, {
    orgId: DEMO_ORG.id,
    subject: oidcSubject(idp.issuer, 'victor'),
    displayName: 'Victor Lecteur',
    role: 'viewer',
  });
});
afterAll(async () => {
  await app.close();
  await idp.close();
  await db.$disconnect();
});

const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('M5 — authentification OIDC (resource server)', () => {
  it('jeton valide d’un utilisateur accordé => principal et rôle issus de la base', async () => {
    const r = await get('/v1/me', await idp.mint({ sub: 'alice' }));
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({
      displayName: 'Alice Admin',
      role: 'admin',
      orgId: DEMO_ORG.id,
      via: 'oidc',
    });
  });

  it('401 sans jeton, jeton expiré, mauvaise audience, mauvais émetteur ou signature', async () => {
    expect((await get('/v1/bootstrap')).statusCode).toBe(401);
    expect((await get('/v1/me', await idp.mint({ expiresInSec: -120 }))).json().error.message).toBe(
      'Jeton expiré',
    );
    expect((await get('/v1/me', await idp.mint({ aud: 'autre-api' }))).statusCode).toBe(401);
    expect((await get('/v1/me', await idp.mint({ iss: 'https://evil.example' }))).statusCode).toBe(
      401,
    );
    const forged = (await idp.mint()).replace(/\.[^.]+$/, '.AAAA');
    expect((await get('/v1/me', forged)).statusCode).toBe(401);
    expect((await get('/v1/me', 'pas-un-jwt')).statusCode).toBe(401);
  });

  it('utilisateur authentifié mais non accordé => 403, aucun compte créé implicitement', async () => {
    const before = await db.user.count();
    const r = await get('/v1/bootstrap', await idp.mint({ sub: 'mallory' }));
    expect(r.statusCode).toBe(403);
    expect(await db.user.count()).toBe(before);
  });

  it('localhost n’ouvre plus de principal de développement quand OIDC est configuré', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-dev-role': 'admin' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('viewer : lecture autorisée, mutations refusées (403)', async () => {
    const t = await idp.mint({ sub: 'victor' });
    expect((await get('/v1/bootstrap', t)).statusCode).toBe(200);
    const r = await app.inject({
      method: 'POST',
      url: '/v1/tasks',
      headers: { authorization: `Bearer ${t}`, 'idempotency-key': 'k-viewer-1' },
      payload: { kind: 'qualify_lead' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('accès révoqué => 403 immédiat (rôle lu à chaque requête)', async () => {
    const t = await idp.mint({ sub: 'victor' });
    await db.membership.deleteMany({ where: { user: { displayName: 'Victor Lecteur' } } });
    expect((await get('/v1/bootstrap', t)).statusCode).toBe(403);
  });

  it('Socket.IO : connexion refusée sans jeton, acceptée avec un jeton OIDC valide', async () => {
    const tryConnect = (auth: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const s = connect(baseUrl, { auth, transports: ['websocket'], reconnection: false });
        s.on('connect', () => {
          s.close();
          resolve('ok');
        });
        s.on('connect_error', (e) => {
          s.close();
          resolve(e.message);
        });
      });
    expect(await tryConnect({})).toBe('UNAUTHORIZED');
    expect(await tryConnect({ token: await idp.mint({ sub: 'mallory' }) })).toBe('UNAUTHORIZED');
    expect(await tryConnect({ token: await idp.mint({ sub: 'alice' }) })).toBe('ok');
  });

  it('/auth/config publie émetteur et client public, jamais de secret', async () => {
    const r = await app.inject({ method: 'GET', url: '/auth/config' });
    expect(r.json().data).toEqual({
      mode: 'oidc',
      issuer: idp.issuer,
      clientId: idp.clientId,
      audience: idp.audience,
      scope: 'openid',
    });
  });

  it('en-têtes de sécurité et CORS restreint à l’origine configurée', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/v1/bootstrap',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    // L'origine renvoyée n'est jamais celle de l'attaquant : le navigateur bloque la réponse.
    expect(r.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    const ok = await app.inject({ method: 'GET', url: '/health/live' });
    expect(ok.headers['content-security-policy']).toContain("default-src 'none'");
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('M5 — limitation de débit', () => {
  it('429 RATE_LIMITED avec enveloppe d’erreur stable', async () => {
    const { app: limited } = await buildApp({
      db,
      corsOrigin: 'http://localhost:3000',
      rateLimitPerMinute: 10,
      auth: { allowDevPrincipal: true },
    });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (await limited.inject({ method: 'GET', url: '/v1/me', remoteAddress: '127.0.0.1' }))
          .statusCode,
      );
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    const r = await limited.inject({ method: 'GET', url: '/v1/me', remoteAddress: '127.0.0.1' });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('RATE_LIMITED');
    // Les sondes de santé ne sont pas limitées.
    expect((await limited.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    await limited.close();
  });
});

describe('M5 — validation de configuration au démarrage', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/x' };
  it('production sans authentification réelle : refus', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://hq.example.com' }),
    ).toThrow(/configurer OIDC/);
  });
  it('production avec origine HTTP ou émetteur HTTP : refus', () => {
    const oidc = {
      OIDC_ISSUER: 'http://idp.example.com',
      OIDC_AUDIENCE: 'api',
      OIDC_CLIENT_ID: 'web',
    };
    expect(() =>
      loadConfig({ ...base, ...oidc, NODE_ENV: 'production', WEB_ORIGIN: 'http://hq.example.com' }),
    ).toThrow(/HTTPS/);
  });
  it('OIDC partiel : refus', () => {
    expect(() => loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com' })).toThrow(
      /OIDC incomplet/,
    );
  });
  it('production OIDC complète : acceptée, aucun principal de développement', () => {
    const cfg = loadConfig({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://hq.example.com',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_AUDIENCE: 'api',
      OIDC_CLIENT_ID: 'web',
    });
    expect(cfg.auth.allowDevPrincipal).toBe(false);
    expect(cfg.auth.oidc?.settings.issuer).toBe('https://idp.example.com');
  });
  it('développement sans auth : principal de développement autorisé ; mode live refusé', () => {
    expect(loadConfig(base).auth.allowDevPrincipal).toBe(true);
    expect(() => loadConfig({ ...base, APP_MODE: 'live' })).toThrow(/live non disponible/);
  });
});
