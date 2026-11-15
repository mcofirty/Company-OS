import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel');
});

test('affiche le QG en mode démo, clairement étiqueté', async ({ page }) => {
  await expect(page.getByTestId('mode-badge')).toHaveText(/MODE DÉMO/);
  await expect(page.getByTestId('world-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('roster').locator('li')).toHaveCount(5);
});

test('cliquer un avatar dans le monde isométrique ouvre son inspecteur', async ({ page }) => {
  await page.waitForFunction(() => window.__officeScene?.agentScreenPosition('ag_demo_eng'));
  const canvas = page.getByTestId('world-canvas').locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas absent');
  // L'agent peut marcher : on relit sa position juste avant de cliquer.
  await expect(async () => {
    const pos = await page.evaluate(() => window.__officeScene?.agentScreenPosition('ag_demo_eng'));
    if (!pos) throw new Error('agent introuvable');
    await page.mouse.click(box.x + pos.x, box.y + pos.y);
    await expect(page.getByTestId('inspector')).toContainText('Bastien', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByTestId('inspector')).toContainText('Ingénierie');
  await expect(page.getByTestId('inspector')).toContainText('Démo (simulé)');
  await expect(page.getByTestId('inspector').locator('ol li').first()).toBeVisible();
});

test("les événements backend arrivent en temps réel dans l'UI", async ({ page }) => {
  const seqText = page.locator('.seq');
  const first = Number((await seqText.textContent())?.replace(/\D/g, ''));
  await expect
    .poll(async () => Number((await seqText.textContent())?.replace(/\D/g, '')), {
      timeout: 15_000,
    })
    .toBeGreaterThan(first);
  await expect(page.getByTestId('feed').locator('li').first()).not.toContainText('En attente');
});

test('reprend sans perte après une coupure du WebSocket', async ({ page }) => {
  const seq = async (): Promise<number> =>
    Number((await page.locator('.seq').textContent())?.replace(/\D/g, ''));
  await page.waitForFunction(() => window.__hqSocket?.connected);
  // Coupe le transport ; socket.io-client se reconnectera automatiquement.
  await page.evaluate(() => {
    const s = window.__hqSocket!;
    s.io.reconnectionDelay(2500);
    s.io.engine.close();
  });
  await expect(page.getByTestId('connection')).toContainText('Reconnexion');
  const before = await seq();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 15_000 });
  // Le worker a continué d'écrire pendant la coupure : l'UI rattrape l'état serveur.
  await expect
    .poll(
      async () => {
        const server = (await (
          await page.request.get('http://localhost:4000/api/companies/co_demo/world')
        ).json()) as { lastSeq: number };
        const ui = await seq();
        return ui > before && server.lastSeq - ui <= 3;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
