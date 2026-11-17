import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import {
  generateTotpSecret,
  hashPassword,
  totpCode,
  totpStep,
} from '../../packages/policies/src/owner-login';

/**
 * ADR-053 — connexion propriétaire dans le navigateur : mot de passe + code du téléphone, contre
 * une seconde API démarrée avec ce seul mode (aucun jeton, aucun principal de développement).
 */
const API_PORT = 4102;
const API = `http://localhost:${API_PORT}`;
const PASSWORD = 'mon-mot-de-passe-e2e';
let secret = '';
let api: ChildProcess;

test.beforeAll(async () => {
  secret = generateTotpSecret();
  api = spawn('pnpm', ['--filter', '@company-os/api', 'start'], {
    env: {
      ...process.env,
      API_PORT: String(API_PORT),
      API_HOST: '127.0.0.1',
      API_ACCESS_TOKEN: '',
      WEB_ORIGIN: 'http://localhost:3000',
      OWNER_PASSWORD_HASH: await hashPassword(PASSWORD),
      OWNER_TOTP_SECRET: secret,
      OWNER_SESSION_SECRET: 's'.repeat(40),
    },
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
  throw new Error('API (connexion propriétaire) non démarrée');
});

test.afterAll(() => {
  if (api.pid) process.kill(-api.pid, 'SIGTERM');
});

async function useOwnerBackend(page: Page): Promise<void> {
  await page.addInitScript((url) => {
    window.localStorage.setItem('companyos.backend', JSON.stringify({ url, token: null }));
  }, API);
}
/** Code du pas suivant/précédent : chaque test consomme un code neuf (rejeu refusé). */
let offset = -1;
const freshCode = (): string => totpCode(secret, totpStep(Date.now()) + offset++);

test('connexion : écran simple, aucune donnée avant connexion', async ({ page }) => {
  await useOwnerBackend(page);
  await page.goto('/');
  const panel = page.getByTestId('login-panel');
  await expect(panel).toContainText('Bienvenue au QG');
  await expect(page.getByTestId('login-password')).toBeFocused();
  await expect(page.getByTestId('team-list')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/owner-login.png' });
});

test('mauvais code : message clair, champ code vidé, toujours aucune donnée', async ({ page }) => {
  await useOwnerBackend(page);
  await page.goto('/');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-code').fill('000000'); // validé automatiquement au 6ᵉ chiffre
  await expect(page.getByTestId('login-error')).toHaveText('Mot de passe ou code incorrect.');
  await expect(page.getByTestId('login-code')).toHaveValue('');
  await expect(page.getByTestId('team-list')).toHaveCount(0);
});

test('bon mot de passe + code : cockpit en temps réel, session gardée, déconnexion', async ({
  page,
}) => {
  await useOwnerBackend(page);
  await page.goto('/');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-code').fill(freshCode());
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  // Rechargement : « rester connecté » (coché par défaut) conserve la session.
  await page.reload();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('owner-logout').click();
  await expect(page.getByTestId('login-panel')).toContainText('Bienvenue au QG');
  await expect(page.getByTestId('team-list')).toHaveCount(0);
});
