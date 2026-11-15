import { expect, test } from '@playwright/test';

/**
 * M5 — banc de rendu 50 avatars (docs/08 §3). Monde synthétique local : aucune requête réseau
 * hors de l'application. Le nombre d'images/s est consigné (la valeur dépend fortement du GPU ;
 * ce test vérifie le fonctionnement, la mesure de référence est notée dans docs/PROGRESS.md).
 */
test('M5 — /bench : 50 avatars animés, aucune requête externe, compteur d’images/s', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:3000')) external.push(r.url());
  });
  await page.goto('/bench?agents=50');
  await expect(page.getByTestId('bench-head')).toContainText('monde synthétique local');
  await page.waitForFunction(() => (window.__bench?.samples.length ?? 0) >= 4, null, {
    timeout: 30_000,
  });
  const samples = await page.evaluate(() => window.__bench!.samples);
  console.log(`bench 50 avatars : ${samples.join(', ')} img/s`);
  expect(Math.max(...samples)).toBeGreaterThan(5);
  expect(external).toEqual([]);
  const rendered = await page.evaluate(() =>
    ['bench-0', 'bench-25', 'bench-49'].every((id) => window.__hqScene?.agentScreenPosition(id)),
  );
  expect(rendered).toBe(true);
});
