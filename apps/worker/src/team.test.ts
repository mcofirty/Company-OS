import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentByAdmin,
  createTask,
  decideApproval,
  DEV_ADMIN,
  initLiveOrg,
  loadSnapshot,
  startNextTask,
  updateReporting,
  deleteAgent,
  proposeSubordinate,
} from '@company-os/db';
import { ToolGateway } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';

const db = testDb();
const admin = { kind: 'user', id: DEV_ADMIN.id } as const;
const gateway = new ToolGateway(db, { latencyScale: 0 });
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

const hire = (name: string, role: 'manager' | 'specialist', grants: Record<string, string[]>) =>
  createAgentByAdmin(db, {
    orgId,
    actor: admin,
    req: {
      name,
      title: role === 'manager' ? 'Directrice commerciale' : 'Commercial',
      departmentId: `${orgId.slice(0, 8)}-sales`,
      role,
      grants,
      goal: 'Développer les ventes',
      instructions: 'Rendre compte chaque semaine avec des chiffres sourcés.',
      monthlyBudgetUsd: 2,
      avatarId: 'avatar-03',
      skills: [],
      routines: [],
    },
  });
/** Démarre une mission de l'agent pour obtenir un run (contexte d'exécution réel). */
const runOf = async (agentId: string) => {
  await createTask(db, {
    orgId,
    kind: 'custom',
    agentId,
    mission: { title: 'Structurer l’équipe', instructions: 'Organise ton équipe commerciale.' },
    requester: admin,
  });
  return (await startNextTask(db, orgId))!.runId;
};
const call = (runId: string, agentId: string, action: string, input: Record<string, string>) =>
  gateway.invoke({
    orgId,
    runId,
    agentId,
    toolId: 'team',
    action,
    input,
    idempotencyKey: `${runId}:${action}:${JSON.stringify(input).length}`,
    causationId: null,
  });

describe('Équipe d’un manager (live)', () => {
  it('outil Équipe réservé aux managers', async () => {
    await expect(hire('Paul', 'specialist', { team: ['list'] })).rejects.toThrow(/managers/);
  });

  it('recrute (validation humaine), puis confie une mission à son subordonné', async () => {
    const { agentId: mgr } = await hire('Inès', 'manager', {
      team: ['list', 'assign', 'recruit'],
      company: ['status'],
      library: ['save_document'],
    });
    const runId = await runOf(mgr);
    // Escalade refusée : droit que la manager ne possède pas, ou l'outil Équipe lui-même.
    const escal = await call(runId, mgr, 'recruit', {
      name: 'Hugo',
      title: 'Commercial',
      goal: 'Relancer les prospects',
      instructions: 'Relancer poliment, sans promesse tarifaire.',
      tools: 'web.search',
      justification: 'Charge de relances',
    });
    expect(escal).toMatchObject({ status: 'failed', errorCode: 'POLICY_DENIED' });
    const proposed = await call(runId, mgr, 'recruit', {
      name: 'Hugo',
      title: 'Commercial',
      goal: 'Relancer les prospects',
      instructions: 'Relancer poliment, sans promesse tarifaire.',
      tools: 'company.status, library.save_document',
      justification: 'Charge de relances trop forte',
    });
    expect(proposed.status).toBe('succeeded');
    // Rien n'est créé avant la décision humaine.
    expect(await db.agent.count({ where: { orgId } })).toBe(1);
    const approval = await db.approvalRequest.findFirstOrThrow({
      where: { orgId, kind: 'agent_hire' },
    });
    expect(approval.safePreview).toMatchObject({ name: 'Hugo', manager: 'Inès' });
    await decideApproval(db, {
      orgId,
      approvalId: approval.id,
      decision: 'approved',
      reviewer: admin,
      reason: 'Besoin confirmé',
    });
    const hugo = await db.agent.findFirstOrThrow({
      where: { orgId, name: 'Hugo' },
      include: { grants: true },
    });
    expect(hugo).toMatchObject({
      managerId: mgr,
      role: 'specialist',
      createdBy: `user:${DEV_ADMIN.id}`,
    });
    expect(Object.fromEntries(hugo.grants.map((g) => [g.toolId, g.actions]))).toEqual({
      company: ['status'],
      library: ['save_document'],
    });

    const assigned = await call(runId, mgr, 'assign', {
      assigneeAgentId: hugo.id,
      title: 'Relancer 3 prospects',
      instructions: 'Rédige trois relances et enregistre-les dans la bibliothèque.',
    });
    expect(assigned.status).toBe('succeeded');
    const sub = await db.task.findFirstOrThrow({ where: { orgId, agentId: hugo.id } });
    expect(sub).toMatchObject({ kind: 'custom', requesterType: 'agent', requesterId: mgr });
    expect(sub.parentTaskId).not.toBeNull();

    const listed = await call(runId, mgr, 'list', { focus: 'tout' });
    expect(listed.status === 'succeeded' && JSON.stringify(listed.output)).toContain('Relancer 3');
    // La projection du QG reflète la hiérarchie (rejeu = état serveur).
    const snap = (await loadSnapshot(db, orgId))!;
    expect(snap.agents.find((a) => a.id === hugo.id)?.managerId).toBe(mgr);
  });

  it('un manager ne pilote que ses subordonnés directs', async () => {
    const { agentId: a } = await hire('Inès', 'manager', { team: ['assign'] });
    const { agentId: other } = await hire('Léo', 'specialist', { company: ['status'] });
    const runId = await runOf(a);
    const r = await call(runId, a, 'assign', {
      assigneeAgentId: other,
      title: 'Hors équipe',
      instructions: 'Ne doit pas être possible.',
    });
    expect(r).toMatchObject({ status: 'failed', errorCode: 'POLICY_DENIED' });
  });

  it('organigramme : pas de cycle, promotion automatique, rétrogradation bloquée', async () => {
    const { agentId: a } = await hire('Inès', 'manager', {});
    const { agentId: b } = await hire('Léo', 'specialist', {});
    const { agentId: c } = await hire('Zoé', 'specialist', {});
    const set = (agentId: string, managerId: string | null, role: 'manager' | 'specialist') =>
      updateReporting(db, { orgId, actorId: DEV_ADMIN.id, agentId, managerId, role });
    await set(b, a, 'specialist');
    // Rattacher Zoé sous Léo (spécialiste) => Léo devient manager.
    await set(c, b, 'specialist');
    expect((await db.agent.findUniqueOrThrow({ where: { id: b } })).role).toBe('manager');
    // Cycle : Inès sous Zoé (qui est sous Léo, sous Inès) => refusé.
    await expect(set(a, c, 'manager')).rejects.toThrow(/fait partie de l'équipe/);
    // Rétrograder Léo alors qu'il encadre Zoé => refusé.
    await expect(set(b, a, 'specialist')).rejects.toThrow(/encadre encore/);
    const events = await db.eventLog.findMany({
      where: { orgId, type: 'agent.reporting.updated' },
    });
    expect(events).toHaveLength(3); // Léo rattaché, Léo promu, Zoé rattachée
  });

  it('suppression : équipe rattachée, tâches en attente annulées, refus en pleine mission', async () => {
    const { agentId: boss } = await hire('Iris', 'manager', {});
    const { agentId: mgr } = await hire('Inès', 'manager', { company: ['status'] });
    const { agentId: sub } = await hire('Hugo', 'specialist', {});
    await updateReporting(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      agentId: mgr,
      managerId: boss,
      role: 'manager',
    });
    await updateReporting(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      agentId: sub,
      managerId: mgr,
      role: 'specialist',
    });
    // Mission en cours : suppression refusée.
    const runId = await runOf(mgr);
    await expect(
      deleteAgent(db, { orgId, actorId: DEV_ADMIN.id, agentId: mgr, reason: 'Réorganisation' }),
    ).rejects.toThrow(/pleine mission/);
    await db.agentRun.update({ where: { id: runId }, data: { status: 'succeeded' } });
    await db.task.updateMany({ where: { orgId, agentId: mgr }, data: { status: 'succeeded' } });
    await db.agent.update({ where: { id: mgr }, data: { currentTaskId: null, activity: 'idle' } });
    // Une tâche en file et une proposition de recrutement en attente.
    await createTask(db, {
      orgId,
      kind: 'custom',
      agentId: mgr,
      mission: { title: 'Plus tard', instructions: 'Tâche en file à annuler.' },
      requester: admin,
    });
    await proposeSubordinate(db, {
      orgId,
      managerAgentId: mgr,
      taskId: null,
      name: 'Lou',
      title: 'Assistante',
      goal: 'Aider',
      instructions: 'Aider l’équipe au quotidien.',
      tools: 'company.status',
      justification: 'Charge',
      idempotencyKey: 'hire-lou',
      correlationId: crypto.randomUUID(),
      causationId: null,
    });

    const r = await deleteAgent(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      agentId: mgr,
      reason: 'Réorganisation',
    });
    expect(r).toEqual({ cancelledTasks: 1, reassigned: 1 });
    expect((await db.agent.findUniqueOrThrow({ where: { id: sub } })).managerId).toBe(boss);
    expect(await db.agentToolGrant.count({ where: { agentId: mgr } })).toBe(0);
    expect(
      (await db.approvalRequest.findFirstOrThrow({ where: { orgId, agentId: mgr } })).status,
    ).toBe('rejected');
    // L'historique reste ; l'agent disparaît du QG ; snapshot = rejeu du journal.
    expect(await db.task.count({ where: { orgId, agentId: mgr } })).toBe(2);
    const snap = (await loadSnapshot(db, orgId))!;
    expect(snap.agents.map((a) => a.id)).not.toContain(mgr);
    expect(snap.agents.find((a) => a.id === sub)?.managerId).toBe(boss);
    await expect(
      deleteAgent(db, { orgId, actorId: DEV_ADMIN.id, agentId: mgr, reason: 'Encore' }),
    ).rejects.toThrow(/introuvable/);
  });
});
