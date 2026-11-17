import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Live encadré dans le cockpit : bascule d'organisation, agent créé par l'admin, mission libre.
 * Sans clé Anthropic, la mission doit être bloquée PROVIDER_UNAVAILABLE (rien de simulé).
 * Avec une clé configurée, le test est ignoré pour ne jamais engager de coût réel en e2e.
 */
const fixture = (...args: string[]): string =>
  execFileSync('pnpm', ['exec', 'tsx', 'tests/setup/live-fixture.ts', ...args], {
    encoding: 'utf8',
  }).trim();
const hasKey = (): boolean => {
  if (process.env.ANTHROPIC_API_KEY) return true;
  try {
    return /^ANTHROPIC_API_KEY=\S+/m.test(readFileSync('.env', 'utf8'));
  } catch {
    return false;
  }
};

let orgId = '';
test.beforeAll(() => {
  orgId = fixture('create').split('\n').at(-1)!;
});
test.afterAll(() => {
  if (orgId) fixture('cleanup', orgId);
});

test('Live — bascule vers l’org LIVE, création d’agent, mission bloquée sans clé', async ({
  page,
}) => {
  test.skip(hasKey(), 'Clé Anthropic présente : pas d’appel réel facturé en e2e');
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('org-switcher').selectOption(orgId);
  await expect(page.getByTestId('mode-badge')).toContainText('LIVE', { timeout: 20_000 });
  await expect(page.getByTestId('mode-badge')).toContainText('outils réels sous vos règles');
  await expect(page.getByTestId('live-empty')).toBeVisible();
  // Rien de la démo ne fuit dans l'org live.
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(0);
  await expect(page.getByTestId('new-task')).toHaveCount(0);

  await page.getByTestId('new-agent').click();
  await page.getByTestId('agent-name').fill('Camille');
  await page.getByTestId('agent-title').fill('Support client');
  await page.getByTestId('agent-dept').selectOption({ label: 'Operations' });
  await page.getByTestId('agent-goal').fill('Répondre aux clients');
  await page
    .getByTestId('agent-instructions')
    .fill('Toujours vouvoyer et citer la source utilisée.');
  await page.getByTestId('agent-skills').fill('Support client, Remboursements');
  await page.getByTestId('agent-routines').fill('Répond aux tickets du jour');
  await page.getByTestId('grant-company-status').check();
  await page.getByTestId('grant-library-save_document').check();
  // Aucun outil fictif proposé en LIVE.
  await expect(page.locator('[data-testid^="grant-crm-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="grant-erp-issue_invoice"]')).toHaveCount(0);
  await page.getByTestId('agent-submit').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Camille', { timeout: 15_000 });
  await expect(page.getByTestId('team-list')).toHaveCount(0); // l'inspecteur remplace la liste
  // Fiche agent : pôle, compétences, outils accordés, tâches habituelles, actions.
  const card = page.getByTestId('agent-card');
  await expect(card).toContainText('Operations');
  await expect(card).toContainText('Remboursements');
  await expect(card).toContainText('Répond aux tickets du jour');
  await expect(card).toContainText('Entreprise', { timeout: 10_000 });
  await expect(card).toContainText('Au poste');
  await expect(page.getByTestId('agent-dept')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/agent-card-1440.png' });

  await page.getByTestId('agent-mission').click();
  await page.getByTestId('mission-title').fill('Réponse type remboursement');
  await page
    .getByTestId('mission-instructions')
    .fill('Rédige une réponse type pour une demande de remboursement.');
  await page.getByTestId('mission-submit').click();
  await expect(page.getByTestId('inspector')).toContainText('PROVIDER_UNAVAILABLE', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('timeline')).toContainText('PROVIDER_UNAVAILABLE');
  await page.screenshot({ path: 'docs/screenshots/live-mission-1440.png' });

  // Relancer (ex. après ajout d'une clé) : nouvelle tâche, l'ancienne est annulée et reliée.
  const firstTitle = await page.getByTestId('inspector-title').innerText();
  await page.getByTestId('task-retry').click();
  await expect(page.getByTestId('inspector')).toContainText('PROVIDER_UNAVAILABLE', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('inspector-title')).toHaveText(firstTitle);
  await expect(page.getByTestId('timeline')).toContainText('tâche annulée et relancée');
  // Annuler la nouvelle tâche bloquée (motif obligatoire) : statut « Annulée », agent libéré.
  page.once('dialog', (d) => void d.accept('Abandon de la mission (e2e)'));
  await page.getByTestId('task-cancel').click();
  await expect(page.getByTestId('inspector')).toContainText('Annulée', { timeout: 15_000 });
  await expect(page.getByTestId('task-cancel')).toHaveCount(0);
  await expect(page.getByTestId('timeline')).toContainText('Abandon de la mission (e2e)');

  // Retour à la démo : l'agent live n'y apparaît pas.
  await page.getByTestId('org-switcher').selectOption({ label: 'DEMO · Living HQ — démo' });
  await expect(page.getByTestId('mode-badge')).toContainText('DEMO', { timeout: 20_000 });
  await expect(page.getByTestId('team-list')).not.toContainText('Camille');
});
