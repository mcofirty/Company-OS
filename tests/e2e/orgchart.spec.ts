import { expect, test } from '@playwright/test';

/**
 * Organigramme : hiérarchie réelle (managerId), réorganisation par un admin, journalisée et
 * reflétée en temps réel ; fiche de l'agent affichée à côté de son personnage.
 */
test('Organigramme — lecture de la hiérarchie, rattachement modifié puis rétabli', async ({
  page,
  request,
}) => {
  // État de départ connu (un run précédent interrompu a pu laisser un autre rattachement).
  const reset = await request.post('http://localhost:4000/v1/agents/sdr-01/reporting', {
    headers: { 'idempotency-key': `e2e-${Date.now()}` },
    data: { managerId: 'sales-manager', role: 'specialist' },
  });
  expect(reset.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('open-orgchart').click();
  const chart = page.getByTestId('org-chart');
  await expect(chart.getByTestId('org-root')).toBeVisible();
  // Hiérarchie de la démo : sdr-01 rend compte à sales-manager, lui-même sous coo-01.
  const sdr = chart.getByTestId('org-node-sdr-01');
  await expect(sdr).toBeVisible();
  await expect(chart.getByTestId('org-node-sales-manager')).toContainText('★ Manager');
  await page.screenshot({ path: 'docs/screenshots/orgchart-1440.png' });

  await sdr.click();
  const select = page.getByTestId('org-manager-select');
  await expect(select).toHaveValue('sales-manager');
  await select.selectOption('growth-manager');
  await expect(select).toHaveValue('growth-manager', { timeout: 10_000 });
  // Cycle impossible : les subordonnés (directs ou non) de coo-01 ne lui sont jamais proposés.
  await chart.getByTestId('org-node-coo-01').click();
  const opts = page.getByTestId('org-manager-select').locator('option');
  await expect(opts.filter({ hasText: 'Vous (administrateur)' })).toHaveCount(1);
  await expect(
    page.getByTestId('org-manager-select').locator('option[value="sales-manager"]'),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('org-manager-select').locator('option[value="sdr-01"]'),
  ).toHaveCount(0);
  // Rétablir.
  await sdr.click();
  await page.getByTestId('org-manager-select').selectOption('sales-manager');
  await expect(page.getByTestId('org-manager-select')).toHaveValue('sales-manager', {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Fermer l’organigramme' }).click();
  await expect(page.getByTestId('timeline')).toContainText('rattaché à');
});

test('Fiche agent à côté de son personnage, qui suit l’avatar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  const canvas = page.locator('[data-testid="world-canvas"] canvas');
  const cBox = (await canvas.boundingBox())!;
  let pos = { x: 0, y: 0 };
  await expect(async () => {
    const p = await page.evaluate(() => window.__hqScene?.agentScreenPosition('billing-01'));
    if (!p) throw new Error('avatar absent');
    pos = p;
    await page.mouse.click(cBox.x + p.x, cBox.y + p.y);
    await expect(page.getByTestId('agent-card-name')).toHaveText('Mei', { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const pop = page.getByTestId('agent-popover');
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId('agent-card-name')).toHaveText(/./);
  await expect(pop).toContainText('Rend compte à');
  // La fiche est proche du personnage (pas collée dans un coin).
  const box = (await pop.boundingBox())!;
  const ax = cBox.x + pos.x;
  expect(Math.min(Math.abs(box.x - ax), Math.abs(box.x + box.width - ax))).toBeLessThan(120);
  await page.screenshot({ path: 'docs/screenshots/agent-popover-1440.png' });
  await pop.getByRole('button', { name: 'Fermer la fiche' }).click();
  await expect(pop).toHaveCount(0);
});
