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
const newAgent = (grants: Record<string, string[]> = { crm: ['lookup_lead'] }) =>
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
    const { agentId } = await newAgent({ crm: ['lookup_lead'], email: ['draft_email'] });
    const a = await db.agent.findUniqueOrThrow({
      where: { id: agentId },
      include: { grants: true, versions: true },
    });
    expect(a).toMatchObject({ status: 'active', provenance: 'live', avatarId: 'avatar-04' });
    expect(a.deskAnchor).toMatch(/^sales-desk-/);
    expect(a.grants.map((g) => [g.toolId, g.actions]).sort()).toEqual([
      ['crm', ['lookup_lead']],
      ['email', ['draft_email']],
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
      () => ({ content: [tool('t1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
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
    expect(llm.requests[0]!.tools.map((t) => t.name)).toEqual(['crm__lookup_lead', SUBMIT_RESULT]);
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
});
