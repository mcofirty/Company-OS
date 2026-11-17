import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Cockpit v2 (organisation LIVE) : premier démarrage guidé, gestion d'un agent (version,
 * modèle, budget), mission récurrente lancée à la main, suite de mission, indicateurs
 * cliquables, livrables, notifications, thème sombre.
 */
const API = 'http://localhost:4000';
const fixture = (...args: string[]): string =>
  execFileSync('pnpm', ['exec', 'tsx', 'tests/setup/live-fixture.ts', ...args], {
    encoding: 'utf8',
  }).trim();
let orgId = '';
test.beforeAll(() => {
  orgId = fixture('create').split('\n').at(-1)!;
});
test.afterAll(() => {
  if (orgId) fixture('cleanup', orgId);
});

test('Cockpit v2 — gérer un agent, planifier, suite, pages et réglages', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('org-switcher').selectOption(orgId);
  await expect(page.getByTestId('mode-badge')).toContainText('LIVE', { timeout: 20_000 });
  await expect(page.getByTestId('onboarding')).toContainText('Crée ton premier agent');

  const created = await page.request.post(`${API}/v1/agents`, {
    headers: { 'x-org-id': orgId, 'idempotency-key': `e2e-${Date.now()}` },
    data: {
      name: 'Iris',
      title: 'Directrice générale',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      role: 'manager',
      grants: { company: ['status'] },
      goal: 'Piloter l’entreprise',
      instructions: 'Rapport hebdomadaire clair, chiffres sourcés.',
      modelTier: 'quality',
    },
  });
  const agentId = ((await created.json()) as { data: { agentId: string } }).data.agentId;
  await expect(page.getByTestId('team-list')).toContainText('Iris', { timeout: 15_000 });

  // Gérer l'agent : nouvelle version (consignes + modèle économique) et budget.
  await page.getByTestId('team-list').getByText('Iris').click();
  await page.getByTestId('agent-edit-version').click();
  await page
    .getByTestId('version-instructions')
    .fill('Rapport le lundi : missions, coûts, risques, trois priorités.');
  await page.getByTestId('version-model').selectOption('economy');
  await page.getByTestId('version-save').click();
  await expect(page.getByTestId('agent-model-label')).toHaveText('Économique', { timeout: 15_000 });
  await page.getByTestId('agent-budget-input').fill('12');
  await page.getByTestId('agent-budget-save').click();
  await expect
    .poll(async () => {
      const r = await page.request.get(`${API}/v1/budgets`, { headers: { 'x-org-id': orgId } });
      const b = ((await r.json()) as { data: { scopeId: string; limitMicros: number }[] }).data;
      return b.find((x) => x.scopeId === agentId)?.limitMicros;
    })
    .toBe(12_000_000);
  await page.keyboard.press('Escape');

  // Mission récurrente : création, puis « Lancer » (exécution immédiate).
  await page.getByTestId('tab-missions').click();
  await page.getByTestId('missions-tab-recurring').click();
  await page.getByTestId('schedule-new').click();
  await page.getByTestId('schedule-title').fill('Rapport d’activité hebdomadaire');
  await page
    .getByTestId('schedule-instructions')
    .fill('Fais le point de la semaine : missions, coûts, risques, 3 priorités.');
  await page.getByTestId('schedule-save').click();
  const row = page.getByTestId('schedule-row');
  await expect(row).toContainText('chaque lundi à 9h00');
  await row.getByTestId('schedule-run').click();
  // Sans clé Anthropic en e2e : la mission lancée se bloque (PROVIDER_UNAVAILABLE) => incident.
  await expect(page.getByTestId('kpi-incidents')).not.toContainText(/^0/, { timeout: 30_000 });
  await page.getByTestId('kpi-incidents').click();
  await expect(page.getByTestId('missions-tab-incidents')).toHaveAttribute('aria-selected', 'true');
  await page
    .getByTestId('missions-table')
    .getByText('Rapport d’activité hebdomadaire')
    .first()
    .click();
  await expect(page.getByTestId('inspector')).toContainText('PROVIDER_UNAVAILABLE');

  // Demander une suite : nouvelle mission pour le même agent, avec le résultat précédent.
  await page.getByTestId('task-follow-up').click();
  await page
    .getByTestId('follow-up-text')
    .fill('Reprends avec les chiffres de la semaine dernière.');
  await page.getByTestId('follow-up-send').click();
  await expect(page.getByTestId('inspector-title')).toContainText('Suite — Rapport', {
    timeout: 15_000,
  });

  // Livrables, notifications, thème.
  await page.getByTestId('tab-deliverables').click();
  await expect(page.getByTestId('deliverables-page')).toContainText('Aucun document');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('settings-tab-notifications').click();
  await page.getByTestId('notify-url').fill('http://127.0.0.1:9/hq-e2e-sujet');
  await page.getByTestId('notify-save').click();
  await expect(page.getByTestId('notifications-settings')).toContainText('Configuré');
  await expect(page.getByTestId('notifications-settings')).not.toContainText('hq-e2e-sujet');
  await page.getByTestId('settings-tab-appearance').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/screenshots/cockpit-v2-dark.png' });
  await page.getByTestId('theme-auto').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

  // Fil d'activité : la mission récurrente et la nouvelle version y figurent.
  await page.getByTestId('tab-office').click();
  await expect(page.getByTestId('timeline')).toContainText('Rapport d’activité hebdomadaire');
  await expect(page.getByTestId('timeline')).toContainText('version 2');
  await page.screenshot({ path: 'docs/screenshots/cockpit-v2-1440.png' });
});
