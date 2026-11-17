import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * Extension de l'entreprise (nouveau pôle dans l'aile libre) et réunion convoquée par l'humain :
 * les agents choisis rejoignent la salle de réunion, puis la réunion est clôturée.
 */
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

test('Nouveau pôle puis réunion convoquée avec les agents choisis', async ({ page, request }) => {
  const api = (path: string, data: object) =>
    request.post(`http://localhost:4000${path}`, {
      headers: { 'idempotency-key': `e2e-${Math.random()}`, 'x-org-id': orgId },
      data,
    });
  for (const name of ['Alice', 'Bruno']) {
    const r = await api('/v1/agents', {
      name,
      title: 'Chargé de mission',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      grants: { company: ['status'] },
      goal: 'Aider l’équipe',
      instructions: 'Réponses courtes, claires et sourcées.',
    });
    expect(r.ok(), await r.text()).toBe(true);
  }
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.getByTestId('org-switcher').selectOption(orgId);
  await expect(page.getByTestId('mode-badge')).toContainText('LIVE', { timeout: 20_000 });

  // 1) Nouveau pôle
  await page.getByTestId('new-department').click();
  await page.getByTestId('department-name').fill('Juridique');
  await page.getByTestId('department-submit').click();
  await expect(page.getByTestId('filter-bar')).toContainText('Juridique', { timeout: 10_000 });
  await expect(page.getByTestId('timeline')).toContainText('Nouveau pôle « Juridique »');

  // 2) Réunion convoquée
  await page.getByTestId('convene-meeting').click();
  await page.getByTestId('meeting-topic').fill('Point hebdo');
  const dialog = page.getByTestId('convene-dialog');
  await dialog.getByRole('checkbox', { name: /Alice/ }).check();
  await dialog.getByRole('checkbox', { name: /Bruno/ }).check();
  const minutes = dialog.getByRole('checkbox', { name: /compte rendu/ });
  if (await minutes.isChecked()) await minutes.uncheck();
  await page.getByTestId('meeting-submit').click();
  await expect(page.getByTestId('inspector-title')).toHaveText('Point hebdo', { timeout: 10_000 });
  await expect(page.getByTestId('end-meeting')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/meeting-convened-1440.png' });
  await page.getByTestId('end-meeting-submit').click();
  await expect(page.getByTestId('end-meeting')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('timeline')).toContainText('Réunion terminée');
});
