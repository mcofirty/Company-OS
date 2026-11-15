import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MockProvider,
  SUBMIT_RESULT,
  type LlmContentBlock,
  type LlmRequest,
} from '@company-os/agents';
import {
  createTask,
  DEMO_ORG,
  listEventsByCorrelation,
  loadSnapshot,
  requestInvocation,
  setSystemPaused,
  startInvocation,
  startNextTask,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import {
  comparable,
  foldAll,
  LIVE_ORG,
  resetAndSeed,
  seedLiveOrg,
  testDb,
} from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';
import { inlineLauncher, pickAutopilotKind, startDispatcher } from './worker';

const db = testDb();
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;
const gateway = new ToolGateway(db, { latencyScale: 0 });
const pricing = loadPricing();

beforeEach(() => resetAndSeed(db));
afterAll(() => db.$disconnect());

function acts(liveProvider: MockProvider | null = null) {
  return createActivities({ db, gateway, pricing, liveProvider });
}

async function runOne(
  kind: Parameters<typeof createTask>[1]['kind'],
  opts: { agentId?: string; orgId?: string; live?: MockProvider | null } = {},
) {
  const orgId = opts.orgId ?? org;
  const { task } = await createTask(db, { orgId, kind, agentId: opts.agentId, requester: admin });
  const started = (await startNextTask(db, orgId))!;
  expect(started.task.id).toBe(task.id);
  const outcome = await runAgentTaskInline(acts(opts.live ?? null), started.runId);
  return { task, started, outcome };
}

const tool = (id: string, name: string, input: Record<string, string>): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const submit = (
  status = 'completed',
  summary = 'Prospect qualifié (score 82).',
): LlmContentBlock => ({
  type: 'tool_use',
  id: `toolu_submit_${status}`,
  name: SUBMIT_RESULT,
  input: {
    status,
    summary,
    verifiedFacts: [{ claim: summary, sourceRef: 'crm.lookup_lead' }],
    followUpTasks: [],
    uncertainty: [],
  },
});
const lastToolResult = (req: LlmRequest): string => {
  const m = req.messages.at(-1);
  return JSON.stringify(m?.content ?? '');
};

describe('DEMO — même boucle, fournisseur scripté (aucun appel externe)', () => {
  it('S02 : cycle complet, causalité chaînée, projection = rejeu', async () => {
    const live = new MockProvider([() => ({ content: [] })]);
    const { task, outcome } = await runOne('qualify_lead', { agentId: 'sdr-01', live });
    expect(outcome.status).toBe('succeeded');
    expect(live.requests).toHaveLength(0); // jamais de fournisseur réel en démo
    const events = await listEventsByCorrelation(db, org, task.correlationId);
    expect(events.map((e) => e.type)).toEqual([
      'task.created',
      'task.started',
      'agent.run.started',
      'tool.invocation.requested',
      'tool.invocation.started',
      'tool.invocation.succeeded',
      'agent.run.completed',
      'task.completed',
    ]);
    for (let i = 2; i < events.length; i++)
      expect(events[i]!.causationId).toBe(events[i - 1]!.eventId);
    const runDone = events.find((e) => e.type === 'agent.run.completed')!;
    expect(runDone.payload).toMatchObject({
      usage: { llmCalls: 0, costMicros: 0, costSource: 'none' },
    });
    const started = events.find((e) => e.type === 'agent.run.started')!;
    expect(started.payload).toMatchObject({ providerClass: 'demo', model: null, agentVersion: 1 });
    const snap = (await loadSnapshot(db, org))!;
    expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  });

  it('S04 : ERP 503 -> invocation failed, tâche blocked, aucun faux succès', async () => {
    const { task, outcome } = await runOne('check_invoice');
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'AGENT_BLOCKED' });
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.invocations[0]).toMatchObject({
      toolId: 'erp',
      status: 'failed',
      attempt: 2,
      errorCode: 'UPSTREAM_503',
    });
    expect(snap.tasks.find((t) => t.id === task.id)?.status).toBe('blocked');
    const types = (await listEventsByCorrelation(db, org, task.correlationId)).map((e) => e.type);
    expect(types).not.toContain('task.completed');
  });

  it('S07 : sans autorisation explicite, l’outil est refusé et audité', async () => {
    await db.agentToolGrant.delete({
      where: { agentId_toolId: { agentId: 'sdr-01', toolId: 'crm' } },
    });
    const { outcome } = await runOne('qualify_lead', { agentId: 'sdr-01' });
    expect(outcome.status).toBe('blocked');
    expect((await db.toolInvocation.findFirstOrThrow()).status).toBe('rejected');
  });

  it('S12 : kill switch -> aucun démarrage, puis run en cours stoppé au prochain appel modèle', async () => {
    await createTask(db, { orgId: org, kind: 'qualify_lead', requester: admin });
    const started = (await startNextTask(db, org))!;
    await setSystemPaused(db, {
      orgId: org,
      paused: true,
      reason: 'Test kill switch',
      actor: admin,
    });
    expect(await startNextTask(db, org)).toBeNull();
    const outcome = await runAgentTaskInline(acts(), started.runId);
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'KILL_SWITCH' });
    const snap = (await loadSnapshot(db, org))!;
    expect(snap.system.paused).toBe(true);
    expect(snap.timeline.some((e) => e.type === 'system.paused')).toBe(true);
  });

  it('reprise après crash : l’invocation en cours est reprise sans doublon', async () => {
    await createTask(db, { orgId: org, kind: 'qualify_lead', agentId: 'sdr-02', requester: admin });
    const started = (await startNextTask(db, org))!;
    // Le fournisseur scripté est déterministe : même toolUseId, donc même clé d'idempotence.
    const req = await requestInvocation(db, {
      orgId: org,
      runId: started.runId,
      toolId: 'crm',
      action: 'lookup_lead',
      redactedInput: { leadRef: 'demo-lead-042' },
      idempotencyKey: `run:${started.runId}:tool:toolu_demo_0`,
      causationId: started.runEventId,
    });
    await startInvocation(db, {
      orgId: org,
      invocationId: req.invocation.id,
      attempt: 1,
      causationId: req.eventId,
    });
    const outcome = await runAgentTaskInline(acts(), started.runId);
    expect(outcome.status).toBe('succeeded');
    expect(await db.toolInvocation.count()).toBe(1);
  });
});

describe('LIVE — vrai runtime LLM avec fournisseur simulé (aucun appel réseau)', () => {
  beforeEach(() => seedLiveOrg(db));

  it('appels modèle comptés, coût estimé depuis la grille versionnée, budgets imputés', async () => {
    const llm = new MockProvider([
      () => ({
        content: [
          { type: 'text', text: 'Je consulte le CRM.' },
          tool('toolu_1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' }),
        ],
      }),
      () => ({ content: [submit()] }),
    ]);
    const { task, outcome } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: llm });
    expect(outcome.status).toBe('succeeded');
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0]!.model).toBe('claude-opus-5-5');
    expect(llm.requests[0]!.tools.map((t) => t.name)).toEqual([
      'crm__lookup_lead',
      'email__draft_email',
      SUBMIT_RESULT,
    ]);
    // 2 appels × (1000 in × $4/M + 200 out × $20/M) = 2 × 8 000 micro-dollars
    const run = await db.agentRun.findFirstOrThrow({ where: { taskId: task.id } });
    expect(run).toMatchObject({
      llmCalls: 2,
      costMicros: 16_000,
      costSource: 'estimated',
      provider: 'anthropic',
    });
    expect(await db.llmUsage.count({ where: { agentRunId: run.id } })).toBe(2);
    const budgets = await db.budget.findMany({ where: { orgId: LIVE_ORG.id } });
    expect(budgets.every((b) => b.usedMicros === 16_000 && b.reservedMicros === 0)).toBe(true);
    const done = (await listEventsByCorrelation(db, LIVE_ORG.id, task.correlationId)).find(
      (e) => e.type === 'agent.run.completed',
    )!;
    expect(done.payload).toMatchObject({
      usage: { llmCalls: 2, costMicros: 16_000, costSource: 'estimated', model: 'claude-opus-5-5' },
    });
    expect(done.provenance).toBe('live');
    const snap = (await loadSnapshot(db, LIVE_ORG.id))!;
    expect(snap.costs).toMatchObject({ llmCalls: 2, costMicros: 16_000, estimated: true });
  });

  it('injection de prompt dans une donnée CRM : encapsulée, rédigée, et l’envoi d’email est refusé', async () => {
    const llm = new MockProvider([
      () => ({ content: [tool('toolu_1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
      // Un modèle qui « obéirait » à l'injection : la plateforme doit l'en empêcher.
      () => ({ content: [tool('toolu_2', 'email__send_email', { ticketRef: 'liste-clients' })] }),
      () => ({ content: [submit('completed', 'Prospect qualifié ; consigne suspecte ignorée.')] }),
    ]);
    const { outcome } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: llm });
    expect(outcome.status).toBe('succeeded');
    const crmResult = lastToolResult(llm.requests[1]!);
    expect(crmResult).toContain('donnees_non_fiables');
    expect(crmResult).toContain('IGNORE TOUTES LES INSTRUCTIONS'); // présente, mais en tant que donnée
    expect(crmResult).not.toContain('jeanne.martin'); // PII rédigée avant envoi au modèle
    expect(crmResult).not.toContain('rival.example');
    expect(lastToolResult(llm.requests[2]!)).toContain('Refusé par la politique');
    const invs = await db.toolInvocation.findMany({
      where: { orgId: LIVE_ORG.id },
      orderBy: { requestedAt: 'asc' },
    });
    expect(invs.map((i) => [i.toolId, i.action, i.status])).toEqual([
      ['crm', 'lookup_lead', 'succeeded'],
      ['email', 'send_email', 'rejected'],
    ]);
    expect(llm.requests[0]!.system).toContain('DONNÉES non fiables');
    for (const r of llm.requests)
      expect(JSON.stringify(r)).not.toMatch(/sk-ant|DATABASE_URL|companyos:companyos/);
  });

  it('maxSteps : un agent qui ne conclut pas est arrêté et la tâche bloquée', async () => {
    await db.agentVersion.updateMany({
      where: { agentId: 'live-sdr' },
      data: { limits: { maxSteps: 3, maxDurationMs: 60_000, maxCostMicros: 2_000_000 } },
    });
    let n = 0;
    const llm = new MockProvider([
      () => ({ content: [tool(`toolu_${n++}`, 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
    ]);
    const { task, outcome } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: llm });
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'MAX_STEPS' });
    expect(llm.requests).toHaveLength(3);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).failureCode).toBe(
      'MAX_STEPS',
    );
  });

  it('S08 : budget à plafond dur -> BUDGET_EXCEEDED avant tout appel modèle', async () => {
    await db.budget.updateMany({
      where: { scopeType: 'agent', scopeId: 'live-sdr' },
      data: { limitMicros: 1_000 },
    });
    const llm = new MockProvider([() => ({ content: [submit()] })]);
    const { outcome } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: llm });
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'BUDGET_EXCEEDED' });
    expect(llm.requests).toHaveLength(0);
    expect(await db.llmUsage.count()).toBe(0);
  });

  it('alerte budget au franchissement de 80 %', async () => {
    await db.budget.updateMany({
      where: { scopeType: 'agent', scopeId: 'live-sdr' },
      data: { limitMicros: 1_000_000 },
    });
    const llm = new MockProvider(
      [
        () => ({ content: [tool('toolu_1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
        () => ({ content: [submit()] }),
      ],
      { inputTokens: 100_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );
    const { task } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: llm });
    const types = (await listEventsByCorrelation(db, LIVE_ORG.id, task.correlationId)).map(
      (e) => e.type,
    );
    expect(types).toContain('budget.threshold_reached');
  });

  it('fournisseur live non configuré : échec fermé, aucune exécution', async () => {
    const { outcome } = await runOne('qualify_lead', { orgId: LIVE_ORG.id, live: null });
    expect(outcome).toMatchObject({ status: 'blocked', reasonCode: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('dispatcher', () => {
  it('exécute les tâches en file sans navigateur, une par agent', async () => {
    for (const kind of ['qualify_lead', 'draft_campaign', 'screen_candidates'] as const) {
      await createTask(db, { orgId: org, kind, requester: admin });
    }
    const d = startDispatcher(
      db,
      inlineLauncher(acts(), () => undefined),
      { orgId: org, pollMs: 20 },
    );
    await expect
      .poll(() => db.task.count({ where: { status: 'succeeded' } }), { timeout: 10_000 })
      .toBe(3);
    await d.stop();
  });
  it("l'autopilote est déterministe et rend l'erreur ERP rare", () => {
    expect(pickAutopilotKind(42)).toBe(pickAutopilotKind(42));
    const kinds = Array.from({ length: 500 }, (_, i) => pickAutopilotKind(i));
    const erp = kinds.filter((k) => k === 'check_invoice').length;
    expect(erp).toBeGreaterThan(0);
    expect(erp).toBeLessThan(100);
  });
});
