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
  await expect(page.getByTestId('toolwall')).toBeVisible();
  await expect(page.getByTestId('kpis')).toContainText('Agents actifs');
  const boot = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
    data: {
      departments: unknown[];
      tools: unknown[];
      agents: { provenance: string; status: string }[];
    };
  };
  // ≥ 12 agents seedés (des recrutements approuvés lors d'autres scénarios peuvent s'ajouter).
  expect(boot.data.agents.length).toBeGreaterThanOrEqual(12);
  // Liste d'équipe : agents en activité (les anciens, désactivés, sont masqués par défaut).
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(
    boot.data.agents.filter((a) => a.status !== 'deactivated').length,
  );
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
    // Chaque événement (même replié dans une mission) a exactement un bouton dans le fil.
    const titles = [...document.querySelectorAll('[data-testid=timeline] button.tl-item')].map(
      (b) => b.getAttribute('title'),
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

test('M2 — inspecteur de run : fournisseur, version, coût (démo : aucun LLM)', async ({ page }) => {
  await open(page);
  const id = await createViaUi(page, 'forecast_cashflow');
  await expect(page.getByTestId('inspector')).toContainText('Réussie', { timeout: 30_000 });
  const run = page.getByTestId('run-card').first();
  await expect(run).toContainText('Démo scripté — aucun LLM appelé');
  await expect(run).toContainText('v1');
  await expect(run).toContainText('agent-task-');
  await expect(page.getByTestId('kpi-cost')).toContainText('$0.00');
  const d = await taskDetail(page, id);
  expect(d.task.status).toBe('succeeded');
});

test('S12 — kill switch depuis le cockpit : bannière, timeline, reprise', async ({ page }) => {
  await open(page);
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId('kill-switch').click();
  await expect(page.getByTestId('pause-banner')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('timeline')).toContainText('Système mis en pause');
  const boot = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
    data: { system: { paused: boolean } };
  };
  expect(boot.data.system.paused).toBe(true);
  await page.getByTestId('kill-switch').click();
  await expect(page.getByTestId('pause-banner')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('timeline')).toContainText('Système repris');
});

test('S05 — RH propose un agent, l’admin approuve depuis le cockpit, l’agent apparaît et persiste', async ({
  page,
}) => {
  await open(page);
  page.on('dialog', (d) => void d.accept('Capacité Support validée (e2e)'));
  const agentIds = async (): Promise<string[]> =>
    (
      (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
        data: { agents: { id: string }[] };
      }
    ).data.agents.map((a) => a.id);
  const beforeIds = new Set(await agentIds());
  const before = await page.getByTestId('team-list').locator('li').count();
  await createViaUi(page, 'propose_hire');
  await page.keyboard.press('Escape');
  const row = page.getByTestId('approval-row').filter({ hasText: 'Nouvel agent' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId('inspector')).toContainText('décision engageante');
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('inspector')).toContainText('APPROUVÉE', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(before + 1, {
    timeout: 10_000,
  });
  await expect(page.getByTestId('timeline')).toContainText("rejoint l'équipe");
  // Au rechargement, l'agent est toujours là (état serveur), sans nouvelle notification d'arrivée.
  await page.reload();
  await expect(page.getByTestId('connection')).toContainText('Temps réel', { timeout: 20_000 });
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(before + 1);
  await expect(page.locator('.toast').filter({ hasText: 'Nouvel agent' })).toHaveCount(0);

  // Nettoyage : désactiver la recrue libère son poste (sinon les exécutions répétées remplissent le QG).
  const hired = (await agentIds()).filter((id) => !beforeIds.has(id));
  expect(hired).toHaveLength(1);
  const res = await page.request.post(`${API}/v1/agents/${hired[0]}/deactivate`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { reason: 'Nettoyage e2e S05' },
  });
  expect(res.status()).toBe(200);
});

test('S06 — réunion réelle : participants, décisions et tâche déléguée visibles', async ({
  page,
}) => {
  await open(page);
  const id = await createViaUi(page, 'pricing_review');
  await expect(page.getByTestId('inspector')).toContainText('Réussie', { timeout: 40_000 });
  const meetings = (await (await page.request.get(`${API}/v1/meetings`)).json()) as {
    data: { id: string; taskId: string; participantAgentIds: string[]; decisions: unknown[] }[];
  };
  const m = meetings.data.find((x) => x.taskId === id)!;
  expect(m.participantAgentIds.length).toBeGreaterThanOrEqual(2);
  expect(m.decisions.length).toBeGreaterThan(0);
  // Fil groupé par mission : déplier la mission qui contient la réunion, puis l'ouvrir.
  const group = page
    .getByTestId('timeline')
    .locator('li.feed-group', { has: page.locator('button[title*="meeting.completed"]') })
    .first();
  await group.locator('.feed-toggle').click();
  await group.locator('button[title*="meeting.completed"]').first().click();
  await expect(page.getByTestId('inspector-title')).toContainText('Remise');
  await expect(page.getByTestId('inspector')).toContainText('Décisions');
  await expect(page.getByTestId('inspector')).toContainText('Préparer une offre');
});

test('validation d’un envoi d’email : en attente, puis approuvé depuis l’inbox', async ({
  page,
}) => {
  await open(page);
  page.on('dialog', (d) => void d.accept('Relance validée (e2e)'));
  const id = await createViaUi(page, 'send_followup');
  await page.keyboard.press('Escape');
  // La demande de CETTE tâche (l'autopilote démo peut en créer d'autres en parallèle).
  const row = page.locator(`[data-testid="approval-row"][data-task-id="${id}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('Action externe');
  await expect(page.getByTestId('kpi-approvals')).not.toContainText(/^0/);
  await row.click();
  await page.getByTestId('approve').click();
  await expect
    .poll(async () => (await taskDetail(page, id)).task.status, { timeout: 40_000 })
    .toBe('succeeded');
  const d = await taskDetail(page, id);
  expect(d.invocations.map((i) => i.status)).toEqual(['succeeded']);
});

test('M4 — recherche Ctrl+K : trouver un agent et ouvrir son inspecteur', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.getByTestId('search-input').fill('sdr');
  await expect(page.getByTestId('search-result').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('inspector')).toBeVisible();
});

test('M4 — filtre département : avatars estompés, liste et outils filtrés', async ({ page }) => {
  await open(page);
  const total = await page.getByTestId('team-list').locator('li').count();
  await page.getByTestId('filter-sales').click();
  const filtered = await page.getByTestId('team-list').locator('li').count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total);
  const alpha = await page.evaluate(() => ({
    sales: window.__hqScene?.agentAlpha('sdr-01'),
    other: window.__hqScene?.agentAlpha('billing-01'),
  }));
  expect(alpha.sales).toBe(1);
  expect(alpha.other).toBeLessThan(1);
  await page.getByTestId('filter-sales').click();
  await expect(page.getByTestId('team-list').locator('li')).toHaveCount(total);
});

test('S13 — liens agent→outil : au plus 5 tracés, uniquement pour des invocations actives', async ({
  page,
}) => {
  await open(page);
  for (let i = 0; i < 3; i++) await createViaUi(page, 'qualify_lead');
  await page.getByTestId('toggle-links').click();
  await expect(page.getByTestId('toggle-links')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(800);
  const links = await page.evaluate(() => ({
    drawn: window.__hqScene?.drawnLinks ?? [],
  }));
  expect(links.drawn.length).toBeLessThanOrEqual(5);
  const boot = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
    data: { invocations: { agentId: string; toolId: string; status: string }[] };
  };
  // Chaque lien tracé correspond à une invocation qui existe côté serveur (jamais inventé).
  for (const l of links.drawn) {
    expect(
      boot.data.invocations.some((i) => i.agentId === l.agentId && i.toolId === l.toolId),
    ).toBe(true);
  }
});

test('M4 — replay : bandeau REPLAY, lecture seule, aucune requête mutatrice', async ({ page }) => {
  await open(page);
  const mutations: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') mutations.push(`${r.method()} ${r.url()}`);
  });
  await page.getByTestId('toggle-replay').click();
  await expect(page.getByTestId('replay-bar')).toContainText('REPLAY');
  await expect(page.getByTestId('replay-slider')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('new-task')).toHaveCount(0);
  await expect(page.getByTestId('kill-switch')).toHaveCount(0);
  await page.getByTestId('replay-slider').fill('5');
  await expect(page.getByTestId('replay-time')).not.toHaveText('—');
  await page.getByTestId('replay-play').click();
  await page.waitForTimeout(1000);
  await page.getByTestId('replay-exit').click();
  await expect(page.getByTestId('replay-bar')).toHaveCount(0);
  await expect(page.getByTestId('new-task')).toBeVisible();
  expect(mutations).toEqual([]);
});

test('M4 — suspendre puis reprendre un agent ; alerte acquittée', async ({ page }) => {
  await open(page);
  page.on('dialog', (d) => void d.accept('Contrôle e2e M4'));
  await page.getByTestId('team-list').locator('li', { hasText: 'Nora' }).first().click();
  await expect(page.getByTestId('agent-pause')).toBeVisible();
  await page.getByTestId('agent-pause').click();
  await expect(page.getByTestId('agent-resume')).toBeVisible();
  await expect(page.getByTestId('timeline')).toContainText('suspendu');
  await page.getByTestId('agent-resume').click();
  await expect(page.getByTestId('agent-pause')).toBeVisible();

  // Une alerte (validation d'email en attente) apparaît dans le centre d'alertes et s'acquitte.
  const taskId = await createViaUi(page, 'send_followup');
  await page.getByTestId('alerts-button').click();
  const row = page
    .getByTestId('alert-row')
    .filter({ has: page.getByTestId('alert-ack') })
    .first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Le numéro de séquence (#seq) identifie l'alerte de façon unique, même si d'autres arrivent.
  const seq = /#\d+/.exec(await row.innerText())![0];
  await row.getByTestId('alert-ack').click();
  const same = page.getByTestId('alert-row').filter({ hasText: seq });
  await expect(same).toContainText('acquittée');
  await expect(same.getByTestId('alert-ack')).toHaveCount(0);

  // Nettoyage : refuser la validation créée pour ne pas bloquer l'agent dans les scénarios suivants.
  await expect
    .poll(
      async () => {
        const b = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
          data: { approvals: { id: string; taskId: string | null; status: string }[] };
        };
        return (
          b.data.approvals.find((a) => a.taskId === taskId && a.status === 'pending')?.id ?? ''
        );
      },
      { timeout: 30_000 },
    )
    .not.toBe('');
  const b = (await (await page.request.get(`${API}/v1/bootstrap`)).json()) as {
    data: { approvals: { id: string; taskId: string | null; status: string }[] };
  };
  const pending = b.data.approvals.find((a) => a.taskId === taskId && a.status === 'pending')!;
  const res = await page.request.post(`${API}/v1/approvals/${pending.id}/decide`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { decision: 'reject', reason: 'Nettoyage e2e M4' },
  });
  expect(res.status()).toBe(200);
});
