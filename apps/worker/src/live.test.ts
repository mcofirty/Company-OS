import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider, SUBMIT_RESULT, type LlmContentBlock } from '@company-os/agents';
import {
  createAgentByAdmin,
  createTask,
  DEMO_ORG,
  DEV_ADMIN,
  initLiveOrg,
  listEventsByCorrelation,
  loadSnapshot,
  startNextTask,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';
import { inlineLauncher, startOrgDispatchers } from './worker';

const db = testDb();
const admin = { kind: 'user', id: DEV_ADMIN.id } as const;
let orgId = '';

beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
});
afterAll(() => db.$disconnect());

const prefix = (): string => orgId.slice(0, 8);
const newAgent = (
  grants: Record<string, string[]> = { company: ['status'], library: ['save_document'] },
) =>
  createAgentByAdmin(db, {
    orgId,
    actor: admin,
    req: {
      name: 'Léa Martin',
      title: 'Commerciale',
      departmentId: `${prefix()}-sales`,
      role: 'specialist',
      grants,
      goal: 'Préparer les relances commerciales',
      instructions: 'Ton chaleureux, toujours proposer un rendez-vous de 20 minutes.',
      monthlyBudgetUsd: 3,
      avatarId: 'avatar-04',
      skills: [],
      routines: [],
    },
  });
const mission = {
  title: 'Relancer le prospect demo-lead-042',
  instructions: 'Consulte la fiche CRM du prospect demo-lead-042 et propose une relance.',
};
const tool = (id: string, name: string, input: Record<string, string>): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const submit: LlmContentBlock = {
  type: 'tool_use',
  id: 'toolu_submit',
  name: SUBMIT_RESULT,
  input: {
    status: 'completed',
    summary: 'Relance préparée pour demo-lead-042.',
    verifiedFacts: [{ claim: 'Prospect trouvé', sourceRef: 'crm.lookup_lead' }],
    followUpTasks: [],
    uncertainty: [],
  },
};

describe('Live encadré — organisation, agents définis par un humain, missions libres', () => {
  it('initLiveOrg : org live séparée, 6 départements, budget à plafond dur, admin membre, aucun agent', async () => {
    const snap = (await loadSnapshot(db, orgId))!;
    expect(snap.org.mode).toBe('live');
    expect(snap.departments).toHaveLength(6);
    expect(snap.agents).toHaveLength(0);
    expect(snap.budgets).toEqual([
      expect.objectContaining({ scopeType: 'org', limitMicros: 5_000_000, hardStop: true }),
    ]);
    expect(await db.membership.findFirst({ where: { orgId, userId: DEV_ADMIN.id } })).toMatchObject(
      { role: 'admin' },
    );
    // Relancer la commande ne crée pas de doublon.
    const again = await initLiveOrg(db, {
      name: 'Ma Société',
      adminUserIds: [DEV_ADMIN.id],
      monthlyBudgetUsd: 5,
    });
    expect(again).toEqual({ orgId, created: false });
  });

  it('agent créé par un admin : droits exacts, poste du département, budget, consignes ajoutées, acteur humain', async () => {
    const { agentId } = await newAgent({
      company: ['status'],
      library: ['save_document', 'read_document'],
      web: ['search'],
    });
    const a = await db.agent.findUniqueOrThrow({
      where: { id: agentId },
      include: { grants: true, versions: true },
    });
    expect(a).toMatchObject({ status: 'active', provenance: 'live', avatarId: 'avatar-04' });
    expect(a.deskAnchor).toMatch(/^sales-desk-/);
    expect(a.grants.map((g) => [g.toolId, g.actions]).sort()).toEqual([
      ['company', ['status']],
      ['library', ['save_document', 'read_document']],
      ['web', ['search']],
    ]);
    expect(a.versions[0]!.instructions).toContain('Ton chaleureux');
    expect(a.versions[0]!.instructions).toContain('Consignes de l’administrateur');
    const budget = await db.budget.findFirstOrThrow({
      where: { scopeType: 'agent', scopeId: agentId },
    });
    expect(budget).toMatchObject({ limitMicros: 3_000_000, hardStop: true });
    const created = (await loadSnapshot(db, orgId))!.timeline.find(
      (e) => e.type === 'agent.created',
    )!;
    expect(created.actor).toEqual(admin);
    expect(created.provenance).toBe('live');
  });

  it('refus : action à fort impact, actions de plateforme, outil inconnu, organisation démo', async () => {
    await expect(newAgent({ erp: ['issue_invoice'] })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(newAgent({ platform: ['delegate_task'] })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(newAgent({ nope: ['x'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Aucune donnée fictive en LIVE : les outils de démonstration sont refusés.
    await expect(newAgent({ crm: ['lookup_lead'] })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(
      createAgentByAdmin(db, {
        orgId: DEMO_ORG.id,
        actor: admin,
        req: {
          name: 'X',
          title: 'Y',
          departmentId: 'sales',
          role: 'specialist',
          grants: {},
          goal: 'Objectif',
          instructions: 'Consignes suffisamment longues.',
          monthlyBudgetUsd: 1,
          avatarId: 'avatar-01',
          skills: [],
          routines: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('mission libre : refusée en démo, exécutée en live avec le modèle (faux Claude ici)', async () => {
    await expect(
      createTask(db, {
        orgId: DEMO_ORG.id,
        kind: 'custom',
        agentId: 'sdr-01',
        mission,
        requester: admin,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const { agentId } = await newAgent();
    const { task } = await createTask(db, {
      orgId,
      kind: 'custom',
      agentId,
      mission,
      requester: admin,
    });
    expect(task).toMatchObject({ kind: 'custom', title: mission.title, status: 'queued' });
    const started = (await startNextTask(db, orgId))!;
    const llm = new MockProvider([
      () => ({ content: [tool('t1', 'company__status', { focus: 'tout' })] }),
      () => ({
        content: [
          tool('t2', 'library__save_document', {
            title: 'Rapport de situation',
            content: '# Situation\nUne agente active. Contact : lea@example.com',
          }),
        ],
      }),
      () => ({ content: [submit] }),
    ]);
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: llm,
    });
    expect(await runAgentTaskInline(acts, started.runId)).toMatchObject({ status: 'succeeded' });
    // Le modèle reçoit la mission de l'humain et ses consignes, et seulement les outils accordés.
    expect(JSON.stringify(llm.requests[0]!.messages)).toContain('Consulte la fiche CRM');
    expect(llm.requests[0]!.system).toContain('Ton chaleureux');
    expect(llm.requests[0]!.tools.map((t) => t.name)).toEqual([
      'company__status',
      'library__save_document',
      SUBMIT_RESULT,
    ]);
    // L'état renvoyé est RÉEL : l'agent lui-même et sa mission en cours y figurent.
    const statusResult = JSON.stringify(llm.requests[1]!.messages.at(-1));
    expect(statusResult).toContain('Léa Martin');
    expect(statusResult).toContain(mission.title);
    // Document réellement enregistré, rattaché à la tâche ; coordonnées conservées (secrets seuls masqués).
    const docs = await db.document.findMany({ where: { orgId } });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: 'Rapport de situation', taskId: task.id, agentId });
    expect(docs[0]!.content).toContain('lea@example.com');
    const events = await listEventsByCorrelation(db, orgId, task.correlationId);
    expect(events.every((e) => e.provenance === 'live')).toBe(true);
    expect(events.map((e) => e.type)).toContain('task.completed');
    // Coût estimé imputé aux budgets de l'agent et de l'org.
    const run = await db.agentRun.findFirstOrThrow({ where: { taskId: task.id } });
    expect(run.costMicros).toBeGreaterThan(0);
    // Projection serveur = rejeu du journal de l'organisation live.
    const snap = (await loadSnapshot(db, orgId))!;
    const all = await db.eventLog.count({ where: { orgId } });
    expect(snap.lastSeq).toBe(all);
  });

  it('sans clé Anthropic : mission bloquée PROVIDER_UNAVAILABLE, rien de simulé', async () => {
    const { agentId } = await newAgent();
    const { task } = await createTask(db, {
      orgId,
      kind: 'custom',
      agentId,
      mission,
      requester: admin,
    });
    const started = (await startNextTask(db, orgId))!;
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: null,
    });
    expect(await runAgentTaskInline(acts, started.runId)).toMatchObject({
      status: 'blocked',
      reasonCode: 'PROVIDER_UNAVAILABLE',
    });
    expect(await db.toolInvocation.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('worker : un dispatcher par org (y compris créée après), autopilote jamais en live', async () => {
    const { agentId } = await newAgent();
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: null,
    });
    const d = startOrgDispatchers(
      db,
      inlineLauncher(acts, () => undefined),
      {
        autopilot: { enabled: true, intervalMs: 1000, maxOpenTasks: 4 },
        rescanMs: 200,
      },
    );
    try {
      const { task } = await createTask(db, {
        orgId,
        kind: 'custom',
        agentId,
        mission,
        requester: admin,
      });
      await expect
        .poll(async () => (await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, {
          timeout: 10_000,
        })
        .toBe('blocked');
      expect(d.orgIds().sort()).toEqual([DEMO_ORG.id, orgId].sort());
      await new Promise((r) => setTimeout(r, 1500));
      // Aucune tâche inventée dans l'organisation live.
      expect(await db.task.count({ where: { orgId } })).toBe(1);
    } finally {
      await d.stop();
    }
  });

  it('recherche web (exécutée par Anthropic) : tracée dans le cockpit et facturée 0,01 $', async () => {
    const { agentId } = await newAgent({ web: ['search', 'fetch'] });
    await createTask(db, { orgId, kind: 'custom', agentId, mission, requester: admin });
    const started = (await startNextTask(db, orgId))!;
    const llm = new MockProvider([
      (req) => {
        // Outils serveur demandés au fournisseur, pas d'outil client « web__… ».
        expect(req.webTools).toEqual({ search: true, fetch: true });
        expect(req.tools.map((t) => t.name)).toEqual([SUBMIT_RESULT]);
        return {
          usage: { webSearchRequests: 2 },
          content: [
            {
              type: 'server_tool_use',
              id: 'srvtoolu_1',
              name: 'web_search',
              input: { query: 'prix SaaS CRM 2026' },
            },
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srvtoolu_1',
              content: [
                {
                  type: 'web_search_result',
                  url: 'https://a.example',
                  title: 'A',
                  encrypted_content: 'x',
                },
                {
                  type: 'web_search_result',
                  url: 'https://b.example',
                  title: 'B',
                  encrypted_content: 'y',
                },
              ],
            },
            {
              type: 'server_tool_use',
              id: 'srvtoolu_2',
              name: 'web_search',
              input: { query: 'erreur' },
            },
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srvtoolu_2',
              content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' },
            },
            submit,
          ] as never,
        };
      },
    ]);
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: llm,
    });
    expect(await runAgentTaskInline(acts, started.runId)).toMatchObject({ status: 'succeeded' });
    const invs = await db.toolInvocation.findMany({
      where: { orgId },
      orderBy: { requestedAt: 'asc' },
    });
    expect(invs.map((i) => [i.toolId, i.action, i.status])).toEqual([
      ['web', 'search', 'succeeded'],
      ['web', 'search', 'failed'],
    ]);
    expect(invs[0]!.safeSummary).toContain('prix SaaS CRM 2026');
    expect(invs[0]!.safeSummary).toContain('2 résultat(s)');
    // 1 appel : 1000 in × 4 $/M + 200 out × 20 $/M = 8 000 µ$ ; + 2 recherches × 10 000 µ$.
    const run = await db.agentRun.findFirstOrThrow({ where: { id: started.runId } });
    expect(run.costMicros).toBe(28_000);
  });

  it('agent live portant un ancien droit fictif : refusé par la passerelle (DEMO_TOOL_DISABLED)', async () => {
    const { agentId } = await newAgent();
    // Simule un agent créé avant cette règle avec un outil de démonstration.
    await db.agentToolGrant.create({
      data: { agentId, toolId: 'crm', actions: ['lookup_lead'], grantedBy: 'test' },
    });
    await createTask(db, { orgId, kind: 'custom', agentId, mission, requester: admin });
    const started = (await startNextTask(db, orgId))!;
    const llm = new MockProvider([
      () => ({ content: [tool('t1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
      () => ({ content: [submit] }),
    ]);
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: llm,
    });
    await runAgentTaskInline(acts, started.runId);
    const inv = await db.toolInvocation.findFirstOrThrow({ where: { orgId, toolId: 'crm' } });
    expect(inv.status).toBe('rejected');
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toContain('DEMO_TOOL_DISABLED');
  });
});
