import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { startMockIdp, type MockIdp } from '../setup/mock-idp';

/**
 * M5 — connexion OIDC réelle dans le navigateur (Authorization Code + PKCE) contre un fournisseur
 * factice, avec une seconde API démarrée en mode OIDC (aucun principal de développement).
 */
const API_PORT = 4101;
const API = `http://localhost:${API_PORT}`;
let idp: MockIdp;
let api: ChildProcess;

async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

test.beforeAll(async () => {
  idp = await startMockIdp();
  const env = {
    OIDC_ISSUER: idp.issuer,
    OIDC_AUDIENCE: idp.audience,
    OIDC_CLIENT_ID: idp.clientId,
    API_PORT: String(API_PORT),
    API_HOST: '127.0.0.1',
    API_ACCESS_TOKEN: '',
    WEB_ORIGIN: 'http://localhost:3000',
  };
  await run(
    'pnpm',
    ['users', 'grant', '--sub', 'alice', '--name', 'Alice (e2e)', '--role', 'admin'],
    env,
  );
  await run(
    'pnpm',
    ['users', 'grant', '--sub', 'victor', '--name', 'Victor (e2e)', '--role', 'viewer'],
    env,
  );
  api = spawn('pnpm', ['--filter', '@company-os/api', 'start'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`${API}/health/live`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API OIDC non démarrée');
});

test.afterAll(async () => {
  if (api.pid) process.kill(-api.pid, 'SIGTERM');
  await run('pnpm', ['users', 'revoke', '--sub', 'alice'], { OIDC_ISSUER: idp.issuer });
  await run('pnpm', ['users', 'revoke', '--sub', 'victor'], { OIDC_ISSUER: idp.issuer });
  await idp.close();
});

async function useOidcBackend(page: Page): Promise<void> {
  await page.addInitScript((url) => {
    window.localStorage.setItem('companyos.backend', JSON.stringify({ url, token: null }));
  }, API);
}

test('M5 — sans connexion : aucune donnée, écran de connexion OIDC', async ({ page }) => {
  await useOidcBackend(page);
  await page.goto('/');
  await expect(page.getByTestId('login-panel')).toContainText('Connexion requise');
  await expect(page.getByTestId('team-list')).toHaveCount(0);
  await expect(page.getByTestId('backend-offline')).toHaveCount(0);
});

test('M5 — connexion PKCE : retour du fournisseur, cockpit en temps réel, rôle admin', async ({
  page,
}) => {
  idp.setLoginSubject('alice');
  await useOidcBackend(page);
  await page.goto('/');
  await page.getByTestId('login-oidc').click();
  // Aller-retour fournisseur : l'URL finale ne garde ni code ni state.
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  expect(page.url()).not.toContain('code=');
  await expect(page.getByTestId('new-task')).toBeVisible();
  // Le jeton n'est pas en localStorage (seulement la session de l'onglet).
  const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(stored).not.toContain('eyJ');
  // Rechargement : la session de l'onglet est conservée.
  await page.reload();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
});

test('M5 — viewer connecté : lecture seule, aucun bouton mutateur', async ({ page }) => {
  idp.setLoginSubject('victor');
  await useOidcBackend(page);
  await page.goto('/');
  await page.getByTestId('login-oidc').click();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await expect(page.getByTestId('team-list')).toBeVisible();
  await expect(page.getByTestId('new-task')).toHaveCount(0);
  await expect(page.getByTestId('kill-switch')).toHaveCount(0);
});

test('M5 — identité valide sans accès accordé : refus explicite, aucune donnée', async ({
  page,
}) => {
  idp.setLoginSubject('mallory');
  await useOidcBackend(page);
  await page.goto('/');
  await page.getByTestId('login-oidc').click();
  await expect(page.getByTestId('login-panel')).toContainText('Accès non autorisé', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('team-list')).toHaveCount(0);
});
