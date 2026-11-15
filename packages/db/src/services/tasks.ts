import { randomUUID } from 'node:crypto';
import {
  canTransitionTask,
  DEMO_TASK_CATALOG,
  type Actor,
  type TaskKind,
  type TaskStatus,
  type TaskView,
} from '@company-os/contracts';
import { activityAfterTask } from '@company-os/world';
import type { Db, Tx } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { taskView } from '../views';

const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
const base = { classification: 'internal' } as const;

export interface CreateTaskInput {
  orgId: string;
  kind: TaskKind;
  agentId?: string;
  requester: Actor;
  idempotencyKey?: string;
  now?: Date;
}

/** Crée une tâche démo (statut `queued`) et émet `task.created`. Idempotent par clé. */
export async function createTask(
  db: Db,
  input: CreateTaskInput,
): Promise<{ task: TaskView; created: boolean }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    if (input.idempotencyKey) {
      const prior = await tx.idempotencyKey.findUnique({
        where: {
          orgId_key_operation: { orgId, key: input.idempotencyKey, operation: 'create_task' },
        },
      });
      if (prior) {
        const task = await tx.task.findUniqueOrThrow({ where: { id: prior.responseRef } });
        return { task: taskView(task), created: false };
      }
    }
    // En live, les scénarios du catalogue s'exécutent avec un vrai modèle mais des outils
    // démo (mode « hybride », signalé) : la provenance suit le mode de l'organisation.
    const provenance = ctx.mode === 'demo' ? 'demo' : 'live';
    const spec = DEMO_TASK_CATALOG[input.kind];
    const agent = await pickAgent(tx, orgId, spec.departmentId, input.agentId);

    const taskId = randomUUID();
    const correlationId = randomUUID();
    const row = await tx.task.create({
      data: {
        id: taskId,
        orgId,
        kind: input.kind,
        title: spec.title,
        description: spec.description,
        status: 'queued',
        agentId: agent.id,
        requesterType: input.requester.kind,
        requesterId: input.requester.id,
        correlationId,
        provenance,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
      },
    });
    if (agent.activity === 'idle') {
      await tx.agent.update({ where: { id: agent.id }, data: { activity: 'queued' } });
    }
    if (input.idempotencyKey) {
      await tx.idempotencyKey.create({
        data: {
          orgId,
          key: input.idempotencyKey,
          operation: 'create_task',
          responseRef: taskId,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
        },
      });
    }
    ctx.emit({
      ...base,
      type: 'task.created',
      aggregateType: 'task',
      aggregateId: taskId,
      aggregateVersion: 1,
      correlationId,
      causationId: null,
      actor: input.requester,
      provenance,
      payload: { taskId, agentId: agent.id, kind: input.kind, title: spec.title },
    });
    return { task: taskView(row), created: true };
  });
  return result;
}

async function pickAgent(tx: Tx, orgId: string, departmentId: string, agentId?: string) {
  if (agentId) {
    const agent = await tx.agent.findFirst({ where: { id: agentId, orgId, deletedAt: null } });
    if (!agent) throw new DomainError('NOT_FOUND', `Agent ${agentId} introuvable`);
    if (agent.status !== 'active') throw new DomainError('CONFLICT', `Agent ${agentId} non actif`);
    const dept = await tx.department.findUniqueOrThrow({ where: { id: agent.departmentId } });
    if (dept.roomId !== departmentId) {
      throw new DomainError('POLICY_DENIED', `Cette tâche relève du département ${departmentId}`);
    }
    return agent;
  }
  const candidates = await tx.agent.findMany({
    where: { orgId, department: { roomId: departmentId }, status: 'active', deletedAt: null },
    include: {
      _count: { select: { tasks: { where: { status: { in: ['queued', 'running'] } } } } },
    },
    orderBy: { id: 'asc' },
  });
  // Agent le moins chargé, puis le moins récemment occupé, puis id (déterministe).
  const ended = (d: Date | null): number => d?.getTime() ?? 0;
  const best = [...candidates].sort(
    (a, b) =>
      a._count.tasks - b._count.tasks ||
      ended(a.lastTaskEndedAt) - ended(b.lastTaskEndedAt) ||
      a.id.localeCompare(b.id),
  )[0];
  if (!best) throw new DomainError('CONFLICT', `Aucun agent actif dans ${departmentId}`);
  return best;
}

export interface StartedTask {
  task: TaskView;
  runId: string;
  runEventId: string;
}

/**
 * Démarre la plus ancienne tâche `queued` dont l'agent est actif et libre :
 * task.started + agent.run.started. Retourne null s'il n'y a rien à faire.
 */
export async function startNextTask(
  db: Db,
  orgId: string,
  now = new Date(),
): Promise<StartedTask | null> {
  const { result } = await withOrgTx(db, orgId, now, async (ctx) => {
    const { tx } = ctx;
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.killSwitch) return null;
    const task = await tx.task.findFirst({
      where: { orgId, status: 'queued', agent: { status: 'active', currentTaskId: null } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { agent: true },
    });
    if (!task) return null;
    const runId = randomUUID();
    // Démo : fournisseur scripté déterministe (aucun LLM). Live : modèle de la version active.
    const version = await tx.agentVersion.findUnique({
      where: { agentId_version: { agentId: task.agentId, version: task.agent.activeVersion } },
    });
    const policy = (version?.modelPolicy ?? {}) as { model?: string };
    const providerClass = org.mode === 'demo' ? 'demo' : 'llm';
    const model = providerClass === 'llm' ? (policy.model ?? null) : null;
    const updated = await transitionTask(ctx, task.id, 'running', {
      startedAt: now,
      attempts: { increment: 1 },
    });
    await tx.agent.update({
      where: { id: task.agentId },
      data: { currentTaskId: task.id, activity: 'working', version: { increment: 1 } },
    });
    const startedId = ctx.emit({
      ...base,
      type: 'task.started',
      aggregateType: 'task',
      aggregateId: task.id,
      aggregateVersion: updated.version,
      correlationId: task.correlationId,
      causationId: null,
      actor: { kind: 'system', id: 'task-runner' },
      provenance: task.provenance,
      payload: { taskId: task.id, agentId: task.agentId, targetAnchor: task.agent.deskAnchor },
    });
    const runEventId = ctx.emit({
      ...base,
      type: 'agent.run.started',
      aggregateType: 'agent_run',
      aggregateId: runId,
      aggregateVersion: 1,
      correlationId: task.correlationId,
      causationId: startedId,
      actor: { kind: 'agent', id: task.agentId },
      provenance: task.provenance,
      payload: {
        runId,
        agentId: task.agentId,
        taskId: task.id,
        providerClass,
        model,
        agentVersion: task.agent.activeVersion,
      },
    });
    await tx.agentRun.create({
      data: {
        id: runId,
        orgId,
        agentId: task.agentId,
        taskId: task.id,
        provider: providerClass === 'demo' ? 'demo-scripted' : 'anthropic',
        model,
        status: 'running',
        startedAt: now,
        provenance: task.provenance,
        startEventId: runEventId,
        agentVersion: task.agent.activeVersion,
        workflowId: `agent-task-${task.id}`,
      },
    });
    return { task: taskView(updated), runId, runEventId };
  });
  return result;
}

async function transitionTask(
  ctx: OrgTxContext,
  taskId: string,
  to: TaskStatus,
  data: Record<string, unknown> = {},
) {
  const task = await ctx.tx.task.findFirst({ where: { id: taskId, orgId: ctx.orgId } });
  if (!task) throw new DomainError('NOT_FOUND', `Tâche ${taskId} introuvable`);
  const from = task.status as TaskStatus;
  if (!canTransitionTask(from, to)) {
    throw new DomainError('CONFLICT', `Transition interdite ${from} -> ${to}`);
  }
  // Concurrence optimiste sur la version.
  const res = await ctx.tx.task.updateMany({
    where: { id: taskId, version: task.version },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  if (res.count !== 1) throw new DomainError('CONFLICT', 'Tâche modifiée en parallèle');
  return ctx.tx.task.findUniqueOrThrow({ where: { id: taskId } });
}

export type TaskOutcome =
  | { status: 'succeeded'; resultRef: string; safeSummary: string }
  | { status: 'blocked' | 'failed'; reasonCode: string; safeSummary: string };

/** Termine le run et la tâche : agent.run.completed + task.completed|blocked|failed. */
export async function finishTask(
  db: Db,
  input: {
    orgId: string;
    taskId: string;
    runId: string;
    causationId: string | null;
    outcome: TaskOutcome;
    now?: Date;
  },
): Promise<TaskView> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx } = ctx;
    const o = input.outcome;
    const isEnd = o.status !== 'blocked';
    const updated = await transitionTask(ctx, input.taskId, o.status, {
      endedAt: isEnd ? now : null,
      resultSummary: o.safeSummary,
      resultRef: o.status === 'succeeded' ? o.resultRef : null,
      failureCode: o.status === 'succeeded' ? null : o.reasonCode,
    });
    const run = await tx.agentRun.update({
      where: { id: input.runId },
      data: {
        status: o.status,
        endedAt: now,
        outcomeSummary: o.safeSummary,
        failureCode: o.status === 'succeeded' ? null : o.reasonCode,
      },
    });
    const runDone = ctx.emit({
      ...base,
      type: 'agent.run.completed',
      aggregateType: 'agent_run',
      aggregateId: run.id,
      aggregateVersion: 2,
      correlationId: updated.correlationId,
      causationId: input.causationId,
      actor: { kind: 'agent', id: updated.agentId },
      provenance: updated.provenance,
      payload: {
        runId: run.id,
        agentId: updated.agentId,
        taskId: updated.id,
        status: o.status,
        stepCount: run.stepCount,
        usage: {
          llmCalls: run.llmCalls,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          costMicros: run.costMicros,
          costSource:
            run.costSource === 'estimated' || run.costSource === 'measured'
              ? run.costSource
              : 'none',
          model: run.model,
        },
      },
    });
    const common = {
      ...base,
      aggregateType: 'task',
      aggregateId: updated.id,
      aggregateVersion: updated.version,
      correlationId: updated.correlationId,
      causationId: runDone,
      actor: { kind: 'system', id: 'task-runner' } as const,
      provenance: updated.provenance,
    };
    if (o.status === 'succeeded') {
      ctx.emit({
        ...common,
        type: 'task.completed',
        payload: {
          taskId: updated.id,
          agentId: updated.agentId,
          resultRef: o.resultRef,
          safeSummary: o.safeSummary,
        },
      });
    } else {
      ctx.emit({
        ...common,
        type: o.status === 'failed' ? 'task.failed' : 'task.blocked',
        payload: {
          taskId: updated.id,
          agentId: updated.agentId,
          reasonCode: o.reasonCode,
          safeSummary: o.safeSummary,
        },
      });
    }
    // Même règle que le réducteur client.
    const queued = await tx.task.findMany({
      where: { orgId: ctx.orgId, agentId: updated.agentId, status: 'queued' },
      select: { agentId: true, status: true },
    });
    await tx.agent.update({
      where: { id: updated.agentId },
      data: {
        currentTaskId: null,
        lastTaskEndedAt: now,
        activity: activityAfterTask(
          queued.map((q) => ({ agentId: q.agentId, status: 'queued' as const })),
          updated.agentId,
          o.status !== 'succeeded',
        ),
        version: { increment: 1 },
      },
    });
    return taskView(updated);
  });
  return result;
}

/** Tâches `running` à reprendre après un redémarrage du worker. */
export async function listRunningTasks(db: Db, orgId: string) {
  return db.task.findMany({
    where: { orgId, status: 'running' },
    include: { runs: { where: { status: 'running' }, orderBy: { startedAt: 'desc' }, take: 1 } },
    orderBy: { startedAt: 'asc' },
  });
}
