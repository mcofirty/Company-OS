import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import {
  generateTotpSecret,
  hashPassword,
  issueSession,
  totpCode,
  totpStep,
} from '@company-os/policies';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { OwnerLogin } from './auth';

const db = testDb();
const PASSWORD = 'correct-horse-battery';
let owner: OwnerLogin;
const apps: Awaited<ReturnType<typeof buildApp>>['app'][] = [];

async function makeApp(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const { app } = await buildApp({
    db,
    corsOrigin: 'https://hq.example.com',
    rateLimitPerMinute: 1000,
    auth: { allowDevPrincipal: false, owner },
    ...extra,
  });
  apps.push(app);
  return app;
}
const codeNow = (offsetSteps = 0): string =>
  totpCode(owner.totpSecret, totpStep(Date.now()) + offsetSteps);
const login = (
  app: Awaited<ReturnType<typeof makeApp>>,
  body: Record<string, unknown>,
  ip = '203.0.113.7',
) => app.inject({ method: 'POST', url: '/auth/login', payload: body, remoteAddress: ip });

beforeAll(async () => {
  owner = {
    passwordHash: await hashPassword(PASSWORD),
    totpSecret: generateTotpSecret(),
    sessionSecret: 'x'.repeat(40),
  };
});
beforeEach(async () => {
  await resetAndSeed(db);
});
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db.$disconnect();
});

describe('Connexion propriétaire (mot de passe + code TOTP)', () => {
  it('/auth/config annonce le mode « password » sans aucun secret', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/auth/config' });
    expect(r.json().data).toEqual({ mode: 'password' });
    expect(r.body).not.toContain(owner.totpSecret);
  });

  it('bon mot de passe + bon code => session acceptée par /v1 (administrateur)', async () => {
    const app = await makeApp();
    const r = await login(app, { password: PASSWORD, code: codeNow() });
    expect(r.statusCode).toBe(200);
    const { token, expiresAt } = r.json().data as { token: string; expiresAt: number };
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(12 * 3600 * 1000 + 1000);
    const me = await app.inject({
      method: 'GET',
      url: '/v1/bootstrap',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().meta.permissions ?? me.json().data.permissions ?? {}).toBeDefined();
  });

  it('« rester connecté » => session de 30 jours', async () => {
    const app = await makeApp();
    const r = await login(app, { password: PASSWORD, code: codeNow(), remember: true });
    const ttl = (r.json().data.expiresAt as number) - Date.now();
    expect(ttl).toBeGreaterThan(29 * 24 * 3600 * 1000);
  });

  it('mauvais mot de passe OU mauvais code => même message, aucune session', async () => {
    const app = await makeApp();
    const a = await login(app, { password: 'faux-mot-de-passe', code: codeNow() });
    const b = await login(app, { password: PASSWORD, code: codeNow(5) });
    for (const r of [a, b]) {
      expect(r.statusCode).toBe(401);
      expect(r.json().error.message).toBe('Mot de passe ou code incorrect.');
      expect(r.json().data).toBeUndefined();
    }
  });

  it('un code ne sert qu’une fois (rejeu refusé)', async () => {
    const app = await makeApp();
    const code = codeNow();
    expect((await login(app, { password: PASSWORD, code })).statusCode).toBe(200);
    expect((await login(app, { password: PASSWORD, code })).statusCode).toBe(401);
  });

  it('5 échecs => attente imposée, même avec les bons identifiants ; autre adresse non bloquée', async () => {
    const app = await makeApp();
    for (let i = 0; i < 5; i++) {
      expect((await login(app, { password: 'nope-nope-nope', code: '000000' })).statusCode).toBe(
        401,
      );
    }
    const blocked = await login(app, { password: PASSWORD, code: codeNow() });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.message).toMatch(/Réessayez dans 1 minute/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      (await login(app, { password: PASSWORD, code: codeNow() }, '198.51.100.9')).statusCode,
    ).toBe(200);
  });

  it('jeton forgé, expiré ou signé pour un ancien mot de passe => 401', async () => {
    const app = await makeApp();
    const bearer = (t: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/bootstrap',
        headers: { authorization: `Bearer ${t}` },
      });
    const expired = issueSession(
      owner.sessionSecret,
      owner.passwordHash,
      Date.now() - 13 * 3600e3,
      12 * 3600,
    );
    const otherSecret = issueSession('y'.repeat(40), owner.passwordHash, Date.now(), 3600);
    const oldPassword = issueSession(
      owner.sessionSecret,
      await hashPassword('ancien-mot-de-passe'),
      Date.now(),
      3600,
    );
    const good = issueSession(owner.sessionSecret, owner.passwordHash, Date.now(), 3600);
    const tampered = good.token.replace(
      /\.[^.]+\./,
      `.${Buffer.from('{"sub":"owner","iat":1,"exp":9999999999}').toString('base64url')}.`,
    );
    for (const t of [
      expired.token,
      otherSecret.token,
      oldPassword.token,
      tampered,
      'n’importe quoi',
    ]) {
      expect((await bearer(t)).statusCode).toBe(401);
    }
    expect((await bearer(good.token)).statusCode).toBe(200);
    expect((await bearer('')).statusCode).toBe(401);
  });

  it('sans session : /v1 refusé ; aucun principal de développement même en local', async () => {
    const app = await makeApp();
    const r = await app.inject({ method: 'GET', url: '/v1/bootstrap', remoteAddress: '127.0.0.1' });
    expect(r.statusCode).toBe(401);
  });

  it('Socket.IO : refusé sans session, accepté avec une session', async () => {
    const app = await makeApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const tryConnect = (auth: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const s = connect(url, { auth, transports: ['websocket'], reconnection: false });
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
    const { token } = issueSession(owner.sessionSecret, owner.passwordHash, Date.now(), 3600);
    expect(await tryConnect({ token })).toBe('ok');
  });

  it('sans connexion propriétaire configurée : la route de connexion n’existe pas', async () => {
    const app = await makeApp({ auth: { allowDevPrincipal: false, accessToken: 'z'.repeat(40) } });
    expect((await login(app, { password: PASSWORD, code: codeNow() })).statusCode).toBe(404);
  });
});

describe('Connexion propriétaire — configuration au démarrage', () => {
  const base = {
    DATABASE_URL: 'postgresql://x@localhost/x',
    NODE_ENV: 'production',
    WEB_ORIGIN: 'https://hq.example.com',
  };
  const ownerEnv = () => ({
    OWNER_PASSWORD_HASH: owner.passwordHash,
    OWNER_TOTP_SECRET: owner.totpSecret,
    OWNER_SESSION_SECRET: owner.sessionSecret,
  });
  it('complète : acceptée en production, sans principal de développement', () => {
    const cfg = loadConfig({ ...base, ...ownerEnv() });
    expect(cfg.auth.owner?.totpSecret).toBe(owner.totpSecret);
    expect(cfg.auth.allowDevPrincipal).toBe(false);
  });
  it('incomplète : refus', () => {
    expect(() => loadConfig({ ...base, OWNER_PASSWORD_HASH: owner.passwordHash })).toThrow(
      /incomplète/,
    );
  });
  it('avec un jeton d’accès partageable en plus : refus', () => {
    expect(() => loadConfig({ ...base, ...ownerEnv(), API_ACCESS_TOKEN: 'a'.repeat(40) })).toThrow(
      /retirer API_ACCESS_TOKEN/,
    );
  });
  it('empreinte de mot de passe en clair : refus', () => {
    expect(() =>
      loadConfig({ ...base, ...ownerEnv(), OWNER_PASSWORD_HASH: 'monmotdepasse' }),
    ).toThrow(/scrypt/);
  });
});
