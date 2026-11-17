import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTask,
  decideApproval,
  DEMO_ORG,
  listEventsByCorrelation,
  loadSnapshot,
  startNextTask,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';

const db = testDb();
const org = DEMO_ORG.id;
const admin = { kind: 'user', id: 'dev-admin' } as const;
const acts = createActivities({
  db,
  gateway: new ToolGateway(db, { latencyScale: 0 }),
  pricing: loadPricing(),
  liveProvider: null,
});

beforeEach(() => resetAndSeed(db));
afterAll(() => db.$disconnect());

async function start(kind: Parameters<typeof createTask>[1]['kind'], agentId?: string) {
  const { task } = await createTask(db, { orgId: org, kind, agentId, requester: admin });
  const started = (await startNextTask(db, org))!;
  expect(started.task.id).toBe(task.id);
  return { task, started, run: runAgentTaskInline(acts, started.runId, 20) };
}
const pendingApproval = async () => {
  await expect
    .poll(() => db.approvalRequest.count({ where: { status: 'pending' } }), { timeout: 10_000 })
    .toBe(1);
  return db.approvalRequest.findFirstOrThrow({ where: { status: 'pending' } });
};
const expectConsistent = async () => {
  const snap = (await loadSnapshot(db, org))!;
  expect(comparable(await foldAll(db, snap))).toEqual(comparable(snap));
  return snap;
};

describe('validation humaine d’une action externe (send_email)', () => {
  it('suspend l’invocation, attend la décision, puis exécute une seule fois', async () => {
    const { task, run } = await start('send_followup', 'sdr-01');
    const a = await pendingApproval();
    expect(a).toMatchObject({
      kind: 'tool_action',
      toolId: 'email',
      action: 'send_email',
      agentId: 'sdr-01',
    });
    expect(
      (await db.toolInvocation.findFirstOrThrow({ where: { id: a.invocationId! } })).status,
    ).toBe('waiting_approval');
    const mid = await expectConsistent();
    expect(mid.agents.find((x) => x.id === 'sdr-01')?.activity).toBe('waiting_approval');
    expect(mid.approvals[0]).toMatchObject({ status: 'pending', kind: 'tool_action' });

    await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'approved',
      reviewer: admin,
      reason: 'Relance validée',
    });
    const outcome = await run;
    expect(outcome.status).toBe('succeeded');
    const invs = await db.toolInvocation.findMany({ where: { taskId: task.id } });
    expect(invs.map((i) => i.status)).toEqual(['succeeded']);
    const types = (await listEventsByCorrelation(db, org, task.correlationId)).map((e) => e.type);
    expect(types).toEqual([
      'task.created',
      'task.started',
      'agent.run.started',
      'tool.invocation.requested',
      'approval.requested',
      'approval.decided',
      'tool.invocation.started',
      'tool.invocation.succeeded',
      'agent.run.completed',
      'task.completed',
    ]);
    await expectConsistent();
  });

  it('refusée : l’invocation est rejetée sans exécution, la tâche est bloquée', async () => {
    const { task, run } = await start('send_followup', 'sdr-02');
    const a = await pendingApproval();
    await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'rejected',
      reviewer: admin,
      reason: 'Pas maintenant',
    });
    expect((await run).status).toBe('blocked');
    const inv = await db.toolInvocation.findFirstOrThrow({ where: { taskId: task.id } });
    expect(inv).toMatchObject({ status: 'rejected', errorCode: 'APPROVAL_REJECTED' });
    const types = (await listEventsByCorrelation(db, org, task.correlationId)).map((e) => e.type);
    expect(types).not.toContain('tool.invocation.succeeded');
    await expectConsistent();
  });

  it('décision : humains uniquement, idempotente au double-clic, terminale', async () => {
    const { run } = await start('send_followup', 'sdr-01');
    const a = await pendingApproval();
    await expect(
      decideApproval(db, {
        orgId: org,
        approvalId: a.id,
        decision: 'approved',
        reviewer: { kind: 'system', id: 'sdr-01' },
        reason: 'auto',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const first = await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'approved',
      reviewer: admin,
      reason: 'ok',
    });
    const again = await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'approved',
      reviewer: admin,
      reason: 'ok',
    });
    expect([first.changed, again.changed]).toEqual([true, false]);
    await expect(
      decideApproval(db, {
        orgId: org,
        approvalId: a.id,
        decision: 'rejected',
        reviewer: admin,
        reason: 'trop tard',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await run;
    expect(await db.eventLog.count({ where: { type: 'approval.decided' } })).toBe(1);
  });
});

describe('S05 — recrutement : RH propose, admin approuve, apparition', () => {
  it('aucun agent avant décision ; après approbation : agent actif, poste libre, droits explicites', async () => {
    const { run } = await start('propose_hire');
    expect((await run).status).toBe('succeeded');
    const a = await db.approvalRequest.findFirstOrThrow({ where: { kind: 'agent_hire' } });
    expect(a).toMatchObject({ status: 'pending', agentId: 'hr-manager' });
    expect(await db.agent.count()).toBe(12);

    await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'approved',
      reviewer: admin,
      reason: 'Capacité Support validée',
    });
    const hired = await db.agent.findFirstOrThrow({
      where: { departmentId: 'operations', createdBy: 'user:dev-admin' },
      include: { grants: true },
    });
    expect(hired).toMatchObject({
      status: 'active',
      deskAnchor: 'operations-desk-03',
      managerId: 'ops-manager',
    });
    expect(hired.grants.map((g) => [g.toolId, g.actions])).toEqual(
      expect.arrayContaining([
        ['docs', ['draft_doc']],
        ['email', ['draft_email']],
      ]),
    );
    expect(await db.budget.count({ where: { scopeType: 'agent', scopeId: hired.id } })).toBe(1);
    const created = await db.eventLog.findFirstOrThrow({
      where: { type: 'agent.created', aggregateId: hired.id },
    });
    expect(created).toMatchObject({ actorKind: 'user', actorId: 'dev-admin' });
    const snap = await expectConsistent();
    expect(snap.agents).toHaveLength(13);
  });

  it('refus : historique conservé, aucun agent créé', async () => {
    await (
      await start('propose_hire')
    ).run;
    const a = await db.approvalRequest.findFirstOrThrow({ where: { kind: 'agent_hire' } });
    await decideApproval(db, {
      orgId: org,
      approvalId: a.id,
      decision: 'rejected',
      reviewer: admin,
      reason: 'Budget',
    });
    expect(await db.agent.count()).toBe(12);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'rejected',
    );
  });

  it('plus de poste libre : le nouvel agent attend à l’accueil', async () => {
    for (let i = 0; i < 5; i++) {
      await (
        await start('propose_hire')
      ).run;
      const a = await db.approvalRequest.findFirstOrThrow({
        where: { kind: 'agent_hire', status: 'pending' },
      });
      await decideApproval(db, {
        orgId: org,
        approvalId: a.id,
        decision: 'approved',
        reviewer: admin,
        reason: 'ok',
      });
    }
    const hires = await db.agent.findMany({
      where: { createdBy: 'user:dev-admin' },
      orderBy: { createdAt: 'asc' },
    });
    expect(hires.map((h) => h.deskAnchor)).toEqual([
      'operations-desk-03',
      'operations-desk-04',
      'operations-desk-05',
      'operations-desk-06',
      'entry-wait-01',
    ]);
  });
});

describe('S06 — réunion : sièges, décisions, délégation, retour', () => {
  it('3 participants assis sans chevauchement, décisions persistées, tâche déléguée', async () => {
    const { task, run } = await start('pricing_review', 'finance-manager');
    expect((await run).status).toBe('succeeded');
    const m = await db.meeting.findFirstOrThrow({ include: { participants: true } });
    expect(m.status).toBe('completed');
    expect(m.participants.map((p) => p.agentId).sort()).toEqual([
      'billing-01',
      'finance-manager',
      'sales-manager',
    ]);
    expect(new Set(m.participants.map((p) => p.seatAnchor)).size).toBe(3);
    expect(m.decisions).toHaveLength(2);
    const child = await db.task.findFirstOrThrow({ where: { parentTaskId: task.id } });
    expect(child).toMatchObject({
      kind: 'prepare_offer',
      depth: 1,
      status: 'queued',
      correlationId: task.correlationId,
    });
    const types = (await listEventsByCorrelation(db, org, task.correlationId)).map((e) => e.type);
    expect(types.indexOf('meeting.started')).toBeLessThan(types.indexOf('meeting.completed'));
    expect(types.indexOf('task.created', 1)).toBeLessThan(types.indexOf('meeting.completed'));
    const snap = await expectConsistent();
    for (const id of ['finance-manager', 'sales-manager', 'billing-01']) {
      expect(snap.agents.find((a) => a.id === id)?.activity).not.toBe('in_meeting');
    }
    expect(snap.meetings[0]).toMatchObject({ status: 'completed', taskIdsCreated: [child.id] });
  });

  it('un participant occupé par une autre tâche n’est pas arraché à son travail', async () => {
    await createTask(db, {
      orgId: org,
      kind: 'check_invoice',
      agentId: 'billing-01',
      requester: admin,
    });
    await startNextTask(db, org); // billing-01 démarre sa tâche (non exécutée ici)
    const { run } = await start('pricing_review', 'finance-manager');
    await run;
    const m = await db.meeting.findFirstOrThrow({ include: { participants: true } });
    expect(m.participants.map((p) => p.agentId).sort()).toEqual([
      'finance-manager',
      'sales-manager',
    ]);
    expect(m.summary).toContain('absents : billing-01');
  });
});

describe('délégation bornée (docs/04 §6)', () => {
  it('cycle A→B→A refusé, profondeur > 3 refusée, plus de 5 sous-tâches refusées', async () => {
    const root = (
      await createTask(db, {
        orgId: org,
        kind: 'qualify_lead',
        agentId: 'sales-manager',
        requester: admin,
      })
    ).task;
    const b = (
      await createTask(db, {
        orgId: org,
        kind: 'forecast_cashflow',
        agentId: 'finance-manager',
        requester: admin,
        parentTaskId: root.id,
      })
    ).task;
    expect(b.depth).toBe(1);
    await expect(
      createTask(db, {
        orgId: org,
        kind: 'prepare_offer',
        agentId: 'sales-manager',
        requester: admin,
        parentTaskId: b.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const c = (
      await createTask(db, {
        orgId: org,
        kind: 'prepare_offer',
        agentId: 'sdr-01',
        requester: admin,
        parentTaskId: b.id,
      })
    ).task;
    const d = (
      await createTask(db, {
        orgId: org,
        kind: 'weekly_review',
        agentId: 'coo-01',
        requester: admin,
        parentTaskId: c.id,
      })
    ).task;
    expect(d.depth).toBe(3);
    await expect(
      createTask(db, { orgId: org, kind: 'draft_campaign', requester: admin, parentTaskId: d.id }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    const parent = (await createTask(db, { orgId: org, kind: 'weekly_review', requester: admin }))
      .task;
    const kinds = [
      'qualify_lead',
      'draft_campaign',
      'screen_candidates',
      'answer_ticket',
      'forecast_cashflow',
    ] as const;
    for (const k of kinds)
      await createTask(db, { orgId: org, kind: k, requester: admin, parentTaskId: parent.id });
    await expect(
      createTask(db, {
        orgId: org,
        kind: 'prepare_offer',
        requester: admin,
        parentTaskId: parent.id,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});
