import { expect, test } from '@playwright/test';

/** Cockpit téléphone : navigation au pouce, fiches et pages en plein écran, sans QG 3D. */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('Téléphone — accueil, équipe, fiche agent, missions, organigramme', async ({ page }) => {
  await page.goto('/');
  const app = page.getByTestId('mobile-view');
  await expect(app).toBeVisible({ timeout: 20_000 });
  await expect(app).toContainText('agents actifs');
  // Aucun QG 3D chargé sur téléphone.
  await expect(page.locator('[data-testid="world-canvas"]')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/mobile-home.png' });

  await page.getByTestId('m-tab-team').click();
  await page.locator('[data-testid^="m-agent-"]').first().click();
  const sheet = page.getByTestId('m-detail');
  await expect(sheet.getByTestId('agent-popover')).toBeVisible();
  await expect(sheet.getByTestId('agent-card-name')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/mobile-agent.png' });
  await page.getByTestId('m-sheet-close').click();
  await expect(sheet).toHaveCount(0);

  await page.getByTestId('m-tab-missions').click();
  await expect(app.getByRole('tab', { name: /En cours/ })).toBeVisible();

  await page.getByTestId('m-tab-more').click();
  await page.getByTestId('m-more-org').click();
  await expect(page.getByTestId('m-page-org')).toContainText('Organigramme');
  await page.getByTestId('m-sheet-close').click();

  await page.getByTestId('m-tab-approvals').click();
  await expect(app.getByRole('heading', { name: 'À valider' })).toBeVisible();
});
