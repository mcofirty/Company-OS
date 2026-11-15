import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:4000';

interface TaskDetail {
  data: {
    task: { id: string; status: string };
    invocations: { id: string; status: string; toolId: string }[];
    events: { type: string; seq: number; correlationId: string; provenance: string }[];
  };
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await page.waitForFunction(
    () => (window.__hqScene?.agentScreenPosition('sdr-01') ?? null) !== null,
  );
}

async function createViaUi(page: Page, kind: string): Promise<string> {
  await page.getByTestId('new-task').click();
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/v1/tasks') && r.request().method() === 'POST'),
    page.getByTestId(`task-${kind}`).click(),
  ]);
  expect(res.status()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

async function taskDetail(page: Page, id: string): Promise<TaskDetail['data']> {
  return ((await (await page.request.get(`${API}/v1/tasks/${id}`)).json()) as TaskDetail).data;
}

test('S01 — premier affichage : carte, départements, 12 agents, outils, KPI, DEMO', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByTestId('mode-badge')).toContainText('DEMO');
  await expect(page.getByTestId('mode-badge')).toContainText('activité simulée');
  await expect(page.getByTestId('world-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(12);
  await expect(page.getByTestId('toolwall')).toBeVisible();
  await expect(page.getByTestId('kpis')).toContainText('Agents actifs');
  const boot = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
    data: { departments: unknown[]; tools: unknown[]; agents: { provenance: string }[] };
  };
  expect(boot.data.departments.length).toBeGreaterThanOrEqual(6);
  expect(boot.data.tools.length).toBeGreaterThanOrEqual(8);
  expect(boot.data.agents.every((a) => a.provenance === 'demo')).toBe(true);
  // Chaque agent a un avatar rendu dans le canvas.
  const rendered = await page.evaluate(() =>
    ['coo-01', 'sdr-01', 'billing-01', 'support-01', 'hr-manager', 'content-01'].every(
      (id) => window.__hqScene?.agentScreenPosition(id) !== null,
    ),
  );
  expect(rendered).toBe(true);
});

test('clic sur un avatar dans la carte -> inspecteur agent', async ({ page }) => {
  await open(page);
  const canvas = page.getByTestId('world-canvas').locator('canvas');
  const box = (await canvas.boundingBox())!;
  await expect(async () => {
    const pos = await page.evaluate(() => window.__hqScene?.agentScreenPosition('billing-01'));
    if (!pos) throw new Error('avatar absent');
    await page.mouse.click(box.x + pos.x, box.y + pos.y);
    await expect(page.getByTestId('inspector-title')).toHaveText('Mei', { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId('inspector')).toContainText('Facturation');
  await expect(page.getByTestId('inspector')).toContainText('DEMO');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toHaveCount(0);
});

test('S02 — cycle complet : tâche -> CRM -> succès, timeline/KPI, refresh sans perte', async ({
  page,
}) => {
  await open(page);
  const id = await createViaUi(page, 'qualify_lead');
  await expect(page.getByTestId('inspector-title')).toHaveText('Qualifier un prospect (DEMO)');
  // Ligne CRM active dans le mur des outils, corrélée à la tâche.
  await expect(
    page.getByTestId('tool-row').filter({ hasText: 'Qualifier un prospect' }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('inspector')).toContainText('Réussie', { timeout: 30_000 });
  const d = await taskDetail(page, id);
  expect(d.task.status).toBe('succeeded');
  expect(d.invocations).toHaveLength(1);
  expect(d.invocations[0]).toMatchObject({ toolId: 'crm', status: 'succeeded' });
  expect(d.events.map((e) => e.type)).toEqual([
    'task.created',
    'task.started',
    'agent.run.started',
    'tool.invocation.requested',
    'tool.invocation.started',
    'tool.invocation.succeeded',
    'agent.run.completed',
    'task.completed',
  ]);
  expect(new Set(d.events.map((e) => e.correlationId)).size).toBe(1);
  expect(d.events.every((e) => e.provenance === 'demo')).toBe(true);
  await expect(page.getByTestId('timeline')).toContainText('a terminé');

  // Refresh : l'état officiel est rechargé depuis le serveur, sans nouvelle exécution.
  await page.reload();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  const after = await taskDetail(page, id);
  expect(after.invocations).toHaveLength(1);
  expect(after.events).toHaveLength(8);
});

test('S03 — coupure WebSocket pendant un run : aucun événement perdu ni doublé', async ({
  page,
}) => {
  await open(page);
  const id = await createViaUi(page, 'draft_campaign');
  await expect(
    page.getByTestId('tool-row').filter({ hasText: 'Brouillon de campagne' }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.evaluate(() => {
    const s = window.__hqSocket!;
    s.io.reconnectionDelay(4000);
    s.io.engine.close();
  });
  await expect(page.getByTestId('connection')).toContainText(/Reconnexion|Hors ligne/);
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await expect
    .poll(async () => (await taskDetail(page, id)).task.status, { timeout: 30_000 })
    .toBe('succeeded');
  // L'UI converge exactement vers le seq serveur.
  await expect
    .poll(
      async () => {
        const server = (
          (await (await page.request.get(`${API}/v1/events?afterSeq=0&limit=1`)).json()) as {
            meta: { lastSeq: number };
          }
        ).meta.lastSeq;
        const ui = Number(
          (await page.locator('.timeline header .muted').textContent())?.replace(/\D/g, ''),
        );
        return server - ui;
      },
      { timeout: 15_000 },
    )
    .toBeLessThanOrEqual(0);
  await page.getByTestId('timeline').locator('button').first().waitFor();
  const seqs = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('[data-testid=timeline] button')].map((b) =>
      b.getAttribute('title'),
    );
    return titles.map((t) => Number(t?.match(/#(\d+)/)?.[1]));
  });
  expect(new Set(seqs).size).toBe(seqs.length); // pas de doublon
});

test('S04 — erreur outil ERP : échec visible, tâche bloquée, aucun faux succès', async ({
  page,
}) => {
  await open(page);
  const id = await createViaUi(page, 'check_invoice');
  await expect(page.getByTestId('inspector')).toContainText('Bloquée', { timeout: 30_000 });
  await expect(page.getByTestId('inspector')).toContainText('UPSTREAM_503');
  const d = await taskDetail(page, id);
  expect(d.task.status).toBe('blocked');
  expect(d.invocations[0]).toMatchObject({ toolId: 'erp', status: 'failed' });
  expect(d.events.map((e) => e.type)).not.toContain('task.completed');
  await page.getByTestId('tab-recent').click();
  await expect(page.locator('[data-testid=tool-row][data-status=failed]').first()).toContainText(
    'ÉCHEC',
  );
  await expect(page.getByTestId('kpi-incidents')).not.toContainText(/^0/);
});
