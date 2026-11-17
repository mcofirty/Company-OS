import { randomUUID } from 'node:crypto';
import {
  canTransitionTask,
  DEMO_TASK_CATALOG,
  DELEGATION_LIMITS,
  isDemoTaskKind,
  type Actor,
  type AgentActivity,
  type Mission,
  type TaskKind,
  type TaskStatus,
  type TaskView,
} from '@company-os/contracts';
import { activityAfterCancel, activityAfterTask } from '@company-os/world';
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
  /** Délégation : tâche parente. */
  parentTaskId?: string;
  causationId?: string | null;
  /** Mission libre (kind `custom`) : organisations live seulement, agent explicite. */
  mission?: Mission;
}

/** Crée une tâche démo (statut `queued`) et émet `task.created`. Idempotent par clé. */
export async function createTask(
  db: Db,
  input: CreateTaskInput,
): Promise<{ task: TaskView; created: boolean }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, (ctx) => createTaskInTx(ctx, input));
  return result;
}

/**
 * Cœur transactionnel de la création de tâche, réutilisable dans une autre mutation
 * (délégation décidée en réunion). Règles de délégation (docs/04 §6) : profondeur ≤ 3,
 * ≤ 5 sous-tâches par tâche parente, aucun cycle d'agents (A→B→A), destinataire actif.
 */
export async function createTaskInTx(
  ctx: OrgTxContext,
  input: Omit<CreateTaskInput, 'orgId' | 'now'>,
): Promise<{ task: TaskView; created: boolean }> {
  const { tx, orgId, now } = ctx;
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
  let spec: { title: string; description: string };
  let agent: Awaited<ReturnType<typeof pickAgent>>;
  if (isDemoTaskKind(input.kind)) {
    const demo = DEMO_TASK_CATALOG[input.kind];
    spec = demo;
    agent = await pickAgent(tx, orgId, demo.departmentId, input.agentId, {
      toolId: demo.toolId,
      action: demo.action,
    });
  } else {
    // Mission libre : la démo reste déterministe (aucun modèle réel ne pourrait l'exécuter).
    if (ctx.mode !== 'live') {
      throw new DomainError('POLICY_DENIED', 'Missions libres réservées aux organisations live');
    }
    if (!input.mission || !input.agentId) {
      throw new DomainError('VALIDATION_ERROR', 'Mission et agent requis');
    }
    spec = { title: input.mission.title, description: input.mission.instructions };
    agent = await pickAgent(tx, orgId, null, input.agentId);
  }

  let depth = 0;
  let correlationId: string = randomUUID();
  if (input.parentTaskId) {
    const parent = await tx.task.findFirst({ where: { id: input.parentTaskId, orgId } });
    if (!parent) throw new DomainError('NOT_FOUND', 'Tâche parente introuvable');
    depth = parent.depth + 1;
    if (depth > DELEGATION_LIMITS.maxDepth) {
      throw new DomainError(
        'POLICY_DENIED',
        `Profondeur de délégation > ${DELEGATION_LIMITS.maxDepth}`,
      );
    }
    const siblings = await tx.task.count({ where: { orgId, parentTaskId: parent.id } });
    if (siblings >= DELEGATION_LIMITS.maxPerRun) {
      throw new DomainError(
        'POLICY_DENIED',
        `Plus de ${DELEGATION_LIMITS.maxPerRun} délégations pour cette tâche`,
      );
    }
    // Cycle : le destinataire ne doit pas apparaître dans la chaîne des ancêtres.
    let cursor: typeof parent | null = parent;
    while (cursor) {
      if (cursor.agentId === agent.id) {
        throw new DomainError(
          'CONFLICT',
          `Délégation circulaire refusée (${agent.id} est déjà dans la chaîne)`,
        );
      }
      cursor = cursor.parentTaskId
        ? await tx.task.findFirst({ where: { id: cursor.parentTaskId, orgId } })
        : null;
    }
    correlationId = parent.correlationId;
  }

  const taskId = randomUUID();
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
      parentTaskId: input.parentTaskId ?? null,
      depth,
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
    causationId: input.causationId ?? null,
    actor: input.requester,
    provenance,
    payload: {
      taskId,
      agentId: agent.id,
      kind: input.kind,
      title: spec.title,
      parentTaskId: input.parentTaskId ?? null,
      depth,
    },
  });
  return { task: taskView(row), created: true };
}

async function pickAgent(
  tx: Tx,
  orgId: string,
  /** null : agent explicite sans contrainte de département (mission libre). */
  departmentId: string | null,
  agentId?: string,
  need?: { toolId: string; action: string },
) {
  if (agentId) {
    const agent = await tx.agent.findFirst({ where: { id: agentId, orgId, deletedAt: null } });
    if (!agent) throw new DomainError('NOT_FOUND', `Agent ${agentId} introuvable`);
    if (agent.status !== 'active') throw new DomainError('CONFLICT', `Agent ${agentId} non actif`);
    if (departmentId === null) return agent;
    const dept = await tx.department.findUniqueOrThrow({ where: { id: agent.departmentId } });
    if (dept.roomId !== departmentId) {
      throw new DomainError('POLICY_DENIED', `Cette tâche relève du département ${departmentId}`);
    }
    return agent;
  }
  if (departmentId === null) throw new DomainError('VALIDATION_ERROR', 'Agent requis');
  const candidates = await tx.agent.findMany({
    where: { orgId, department: { roomId: departmentId }, status: 'active', deletedAt: null },
    include: {
      _count: { select: { tasks: { where: { status: { in: ['queued', 'running'] } } } } },
      grants: true,
    },
    orderBy: { id: 'asc' },
  });
  // Priorité aux agents explicitement autorisés pour l'outil requis (sinon la gateway refusera).
  const granted = need
    ? candidates.filter((c) =>
        c.grants.some((g) => g.toolId === need.toolId && g.actions.includes(need.action)),
      )
    : candidates;
  const pool = granted.length > 0 ? granted : candidates;
  // Agent le moins chargé, puis le moins récemment occupé, puis id (déterministe).
  const ended = (d: Date | null): number => d?.getTime() ?? 0;
  const best = [...pool].sort(
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
      where: {
        orgId,
        status: 'queued',
        agent: { status: 'active', currentTaskId: null, activity: { not: 'in_meeting' } },
      },
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

/**
 * Annulation humaine d'une tâche EN FILE ou BLOQUÉE (une tâche en cours ou en attente de
 * validation suit son workflow ; elle n'est pas interrompue ici). Émet `task.cancelled`.
 */
export async function cancelTaskInTx(
  ctx: OrgTxContext,
  input: { taskId: string; reason: string; actor: Actor; retriedAs: string | null },
): Promise<TaskView> {
  const { tx, orgId, now } = ctx;
  const task = await tx.task.findFirst({ where: { id: input.taskId, orgId } });
  if (!task) throw new DomainError('NOT_FOUND', 'Tâche introuvable');
  if (task.status !== 'queued' && task.status !== 'blocked') {
    throw new DomainError(
      'CONFLICT',
      `Annulation possible seulement en file ou bloquée (statut : ${task.status})`,
    );
  }
  const reason = input.reason.trim().slice(0, 200);
  const updated = await transitionTask(ctx, task.id, 'cancelled', {
    endedAt: now,
    resultSummary: `Annulée : ${reason}`,
  });
  // Même règle que le réducteur client (activityAfterCancel).
  const agent = await tx.agent.findUniqueOrThrow({ where: { id: task.agentId } });
  const remaining = await tx.task.findMany({
    where: { orgId, agentId: task.agentId, status: { in: ['queued', 'blocked'] } },
    select: { agentId: true, status: true },
  });
  const activity = activityAfterCancel(
    agent.activity as AgentActivity,
    remaining.map((t) => ({ agentId: t.agentId, status: t.status as TaskStatus })),
    agent.id,
  );
  if (activity !== agent.activity) {
    await tx.agent.update({
      where: { id: agent.id },
      data: { activity, version: { increment: 1 } },
    });
  }
  ctx.emit({
    ...base,
    type: 'task.cancelled',
    aggregateType: 'task',
    aggregateId: task.id,
    aggregateVersion: updated.version,
    correlationId: task.correlationId,
    causationId: null,
    actor: input.actor,
    provenance: task.provenance,
    payload: { taskId: task.id, agentId: task.agentId, reason, retriedAs: input.retriedAs },
  });
  return taskView(updated);
}

export async function cancelTask(
  db: Db,
  input: { orgId: string; taskId: string; reason: string; actor: Actor; now?: Date },
): Promise<TaskView> {
  const { result } = await withOrgTx(db, input.orgId, input.now ?? new Date(), (ctx) =>
    cancelTaskInTx(ctx, { ...input, retriedAs: null }),
  );
  return result;
}

/**
 * Relance d'une tâche bloquée ou en échec : nouvelle tâche identique (même agent, même mission),
 * puis annulation de la tâche bloquée en la reliant à sa remplaçante. Une tâche en échec reste
 * telle quelle (historique). Utile après l'ajout d'une clé ou la levée d'un blocage.
 */
export async function retryTask(
  db: Db,
  input: { orgId: string; taskId: string; actor: Actor; now?: Date },
): Promise<{ task: TaskView; replaced: TaskView }> {
  const { result } = await withOrgTx(db, input.orgId, input.now ?? new Date(), async (ctx) => {
    const old = await ctx.tx.task.findFirst({ where: { id: input.taskId, orgId: ctx.orgId } });
    if (!old) throw new DomainError('NOT_FOUND', 'Tâche introuvable');
    if (old.status !== 'blocked' && old.status !== 'failed') {
      throw new DomainError('CONFLICT', `Relance possible seulement si bloquée ou en échec`);
    }
    const kind = old.kind as TaskKind;
    const { task } = await createTaskInTx(ctx, {
      kind,
      agentId: old.agentId,
      requester: input.actor,
      ...(kind === 'custom'
        ? { mission: { title: old.title, instructions: old.description } }
        : {}),
    });
    const replaced =
      old.status === 'blocked'
        ? await cancelTaskInTx(ctx, {
            taskId: old.id,
            reason: 'Relancée',
            actor: input.actor,
            retriedAs: task.id,
          })
        : taskView(old);
    return { task, replaced };
  });
  return result;
}
