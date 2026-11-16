import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { startTestMcpServer, type TestMcpServer } from '../setup/mcp-server';

/**
 * Connecteurs en libre-service : l'admin branche un vrai serveur MCP (local de test), voit ses
 * outils découverts, choisit leur politique et peut les accorder à un agent.
 */
const fixture = (...args: string[]): string =>
  execFileSync('pnpm', ['exec', 'tsx', 'tests/setup/live-fixture.ts', ...args], {
    encoding: 'utf8',
  }).trim();
const TOKEN = 'e2e-mcp-token-123456789';
let orgId = '';
let mcp: TestMcpServer;
test.beforeAll(async () => {
  orgId = fixture('create').split('\n').at(-1)!;
  mcp = await startTestMcpServer({ token: TOKEN });
});
test.afterAll(async () => {
  if (orgId) fixture('cleanup', orgId);
  await mcp?.close();
});

test('Connecteurs — ajout d’un serveur MCP, politiques, outil proposé aux agents', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('org-switcher').selectOption(orgId);
  await expect(page.getByTestId('mode-badge')).toContainText('LIVE', { timeout: 20_000 });

  await page.getByTestId('open-connectors').click();
  await expect(page.getByTestId('connectors-empty')).toBeVisible();
  await page.getByTestId('connector-name').fill('Notes équipe');
  await page.getByTestId('connector-url').fill(mcp.url);
  await page.getByTestId('connector-token').fill(TOKEN);
  await page.getByTestId('connector-submit').click();
  const card = page.getByTestId('connector');
  await expect(card).toContainText('search_notes', { timeout: 20_000 });
  await expect(card).toContainText('create_ticket');
  await expect(card).toContainText('jeton chiffré');
  await expect(page.getByTestId('connectors-panel')).not.toContainText(TOKEN);
  await expect(page.getByTestId('policy-search_notes')).toHaveValue('approval');
  await page.getByTestId('policy-search_notes').selectOption('read');
  await expect(page.getByTestId('policy-search_notes')).toHaveValue('read');
  await page.getByTestId('policy-create_ticket').selectOption('disabled');
  await expect(page.getByTestId('policy-create_ticket')).toHaveValue('disabled');
  await page.screenshot({ path: 'docs/screenshots/connectors-1440.png' });
  await page.getByRole('button', { name: 'Fermer' }).click();

  // L'outil actif est proposé à la création d'un agent ; l'outil désactivé ne l'est pas.
  await page.getByTestId('new-agent').click();
  await expect(page.locator('[data-testid$="-search_notes"]')).toHaveCount(1);
  await expect(page.locator('[data-testid$="-create_ticket"]')).toHaveCount(0);
  expect(mcp.calls).toHaveLength(0); // découverte seulement : aucun outil exécuté
});
