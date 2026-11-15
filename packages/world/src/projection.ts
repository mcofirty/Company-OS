import {
  LIMITS,
  OPEN_TASK_STATUSES,
  ACTIVE_INVOCATION_STATUSES,
  toolAction,
  type AgentView,
  type DomainEvent,
  type InvocationView,
  type TaskView,
  type WorldSnapshot,
} from '@company-os/contracts';

export type ApplyOutcome = 'applied' | 'duplicate' | 'gap';

/**
 * Réducteur pur et idempotent : snapshot + événement -> snapshot.
 * - seq <= lastSeq : doublon ignoré ;
 * - seq > lastSeq + 1 : trou de séquence, le client doit rattraper via /v1/events.
 * Le serveur produit les mêmes vues depuis ses tables (testé en intégration).
 */
export function applyEvent(
  world: WorldSnapshot,
  e: DomainEvent,
): { world: WorldSnapshot; outcome: ApplyOutcome } {
  if (e.orgId !== world.org.id || e.seq <= world.lastSeq) return { world, outcome: 'duplicate' };
  if (e.seq > world.lastSeq + 1) return { world, outcome: 'gap' };

  let w: WorldSnapshot = {
    ...world,
    lastSeq: e.seq,
    timeline: [e, ...world.timeline].slice(0, LIMITS.timeline),
  };
  const at = e.occurredAt;

  switch (e.type) {
    case 'agent.created': {
      const p = e.payload;
      if (w.agents.some((a) => a.id === p.agentId)) break;
      const agent: AgentView = {
        id: p.agentId,
        name: p.name,
        title: p.title,
        role: p.role,
        departmentId: p.departmentId,
        managerId: p.managerId,
        avatarId: p.avatarId,
        deskAnchor: p.deskAnchor,
        status: 'draft',
        activity: 'idle',
        currentTaskId: null,
        lastTaskEndedAt: null,
        provenance: e.provenance,
      };
      w = { ...w, agents: [...w.agents, agent].sort((a, b) => a.id.localeCompare(b.id)) };
      break;
    }
    case 'agent.activated':
      w = patchAgent(w, e.payload.agentId, () => ({ status: 'active' }));
      break;
    case 'task.created': {
      const p = e.payload;
      const task: TaskView = {
        id: p.taskId,
        kind: p.kind,
        title: p.title,
        status: 'queued',
        agentId: p.agentId,
        correlationId: e.correlationId,
        createdAt: at,
        startedAt: null,
        endedAt: null,
        resultSummary: null,
        failureCode: null,
        provenance: e.provenance,
      };
      w = { ...w, tasks: trimTasks([task, ...w.tasks]) };
      w = patchAgent(w, p.agentId, (a) => (a.activity === 'idle' ? { activity: 'queued' } : {}));
      break;
    }
    case 'task.started':
      w = patchTask(w, e.payload.taskId, () => ({ status: 'running', startedAt: at }));
      w = patchAgent(w, e.payload.agentId, () => ({
        currentTaskId: e.payload.taskId,
        activity: 'working',
      }));
      break;
    case 'agent.run.started':
      break;
    case 'agent.run.completed': {
      const u = e.payload.usage;
      if (u.llmCalls > 0 || u.costMicros > 0) {
        w = {
          ...w,
          costs: {
            llmCalls: w.costs.llmCalls + u.llmCalls,
            inputTokens: w.costs.inputTokens + u.inputTokens,
            outputTokens: w.costs.outputTokens + u.outputTokens,
            costMicros: w.costs.costMicros + u.costMicros,
            estimated: w.costs.estimated || u.costSource === 'estimated',
          },
          // Même règle que le serveur : le coût réel est imputé au budget org et au budget agent.
          budgets: w.budgets.map((b) =>
            b.scopeType === 'org' || (b.scopeType === 'agent' && b.scopeId === e.payload.agentId)
              ? { ...b, usedMicros: b.usedMicros + u.costMicros }
              : b,
          ),
        };
      }
      break;
    }
    case 'budget.threshold_reached':
      break;
    case 'system.paused':
      w = { ...w, system: { paused: true } };
      break;
    case 'system.resumed':
      w = { ...w, system: { paused: false } };
      break;
    case 'tool.invocation.requested': {
      const p = e.payload;
      const inv: InvocationView = {
        id: p.invocationId,
        toolId: p.toolId,
        agentId: p.agentId,
        taskId: p.taskId,
        action: p.action,
        actionKind: p.actionKind,
        risk: p.risk,
        status: 'requested',
        attempt: 1,
        requestedAt: at,
        startedAt: null,
        endedAt: null,
        durationMs: null,
        safeSummary: null,
        errorCode: null,
        correlationId: e.correlationId,
        provenance: e.provenance,
      };
      w = { ...w, invocations: trimInvocations([inv, ...w.invocations]) };
      break;
    }
    case 'tool.invocation.started':
      w = patchInvocation(w, e.payload.invocationId, (i) => ({
        status: 'running',
        startedAt: i.startedAt ?? at,
        attempt: e.payload.attempt,
      }));
      w = patchAgent(w, e.payload.agentId, () => ({ activity: 'using_tool' }));
      break;
    case 'tool.invocation.succeeded':
      w = patchInvocation(w, e.payload.invocationId, () => ({
        status: 'succeeded',
        endedAt: at,
        durationMs: e.payload.durationMs,
        safeSummary: e.payload.safeSummary,
      }));
      w = patchAgent(w, e.payload.agentId, (a) =>
        a.activity === 'using_tool' ? { activity: 'working' } : {},
      );
      w = { ...w, invocations: trimInvocations(w.invocations) };
      break;
    case 'tool.invocation.failed':
      w = patchInvocation(w, e.payload.invocationId, () => ({
        status: 'failed',
        endedAt: at,
        durationMs: e.payload.durationMs,
        errorCode: e.payload.errorCode,
        attempt: e.payload.attempt,
      }));
      w = patchAgent(w, e.payload.agentId, (a) =>
        a.activity === 'using_tool' ? { activity: 'working' } : {},
      );
      w = { ...w, invocations: trimInvocations(w.invocations) };
      break;
    case 'tool.invocation.rejected':
      w = patchInvocation(w, e.payload.invocationId, () => ({
        status: 'rejected',
        endedAt: at,
        errorCode: e.payload.reasonCode,
      }));
      w = { ...w, invocations: trimInvocations(w.invocations) };
      break;
    case 'task.completed':
      w = patchTask(w, e.payload.taskId, () => ({
        status: 'succeeded',
        endedAt: at,
        resultSummary: e.payload.safeSummary,
      }));
      w = finishAgentTask(w, e.payload.agentId, e.payload.taskId, at, false);
      w = { ...w, tasks: trimTasks(w.tasks) };
      break;
    case 'task.failed':
    case 'task.blocked':
      w = patchTask(w, e.payload.taskId, () => ({
        status: e.type === 'task.failed' ? 'failed' : 'blocked',
        endedAt: e.type === 'task.failed' ? at : null,
        resultSummary: e.payload.safeSummary,
        failureCode: e.payload.reasonCode,
      }));
      w = finishAgentTask(w, e.payload.agentId, e.payload.taskId, at, true);
      w = { ...w, tasks: trimTasks(w.tasks) };
      break;
  }
  return { world: w, outcome: 'applied' };
}

export function applyEvents(world: WorldSnapshot, events: readonly DomainEvent[]): WorldSnapshot {
  let w = world;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const r = applyEvent(w, e);
    if (r.outcome === 'gap')
      throw new Error(`Trou de séquence : attendu ${w.lastSeq + 1}, reçu ${e.seq}`);
    w = r.world;
  }
  return w;
}

/** Règle commune serveur/client : activité d'un agent qui vient de terminer une tâche. */
export function activityAfterTask(
  tasks: readonly Pick<TaskView, 'agentId' | 'status'>[],
  agentId: string,
  blocked: boolean,
): AgentView['activity'] {
  if (blocked) return 'blocked';
  return tasks.some((t) => t.agentId === agentId && t.status === 'queued') ? 'queued' : 'idle';
}

function finishAgentTask(
  w: WorldSnapshot,
  agentId: string,
  taskId: string,
  at: string,
  blocked: boolean,
): WorldSnapshot {
  return patchAgent(w, agentId, (a) =>
    a.currentTaskId === taskId || a.currentTaskId === null
      ? {
          currentTaskId: null,
          activity: activityAfterTask(w.tasks, agentId, blocked),
          lastTaskEndedAt: at,
        }
      : {},
  );
}

const isOpenTask = (t: TaskView): boolean => OPEN_TASK_STATUSES.includes(t.status);
const isActiveInv = (i: InvocationView): boolean => ACTIVE_INVOCATION_STATUSES.includes(i.status);

/** Garde toutes les tâches ouvertes + les plus récentes terminées (même règle côté serveur). */
export function trimTasks(tasks: TaskView[]): TaskView[] {
  const open = tasks.filter(isOpenTask);
  const done = tasks
    .filter((t) => !isOpenTask(t))
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, LIMITS.tasks - open.length));
  return [...open, ...done].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
}
export function trimInvocations(invs: InvocationView[]): InvocationView[] {
  const active = invs.filter(isActiveInv);
  const done = invs
    .filter((i) => !isActiveInv(i))
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, LIMITS.invocations - active.length));
  return [...active, ...done].sort(
    (a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id),
  );
}

function patchAgent(
  w: WorldSnapshot,
  id: string,
  fn: (a: AgentView) => Partial<AgentView>,
): WorldSnapshot {
  return { ...w, agents: w.agents.map((a) => (a.id === id ? { ...a, ...fn(a) } : a)) };
}
function patchTask(
  w: WorldSnapshot,
  id: string,
  fn: (t: TaskView) => Partial<TaskView>,
): WorldSnapshot {
  return { ...w, tasks: w.tasks.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) };
}
function patchInvocation(
  w: WorldSnapshot,
  id: string,
  fn: (i: InvocationView) => Partial<InvocationView>,
): WorldSnapshot {
  return { ...w, invocations: w.invocations.map((i) => (i.id === id ? { ...i, ...fn(i) } : i)) };
}

// ---------- KPI ----------
export interface Metrics {
  activeAgents: number;
  busyAgents: number;
  tasksQueued: number;
  tasksRunning: number;
  tasksBlocked: number;
  activeInvocations: number;
  activeToolIds: string[];
  pendingApprovals: number;
  /** Coût LLM cumulé (micro-dollars) et nature (estimé depuis la grille tarifaire). */
  llmCostMicros: number;
  llmCalls: number;
  costEstimated: boolean;
  systemPaused: boolean;
  incidents: number;
}

export function computeMetrics(w: WorldSnapshot): Metrics {
  const active = w.invocations.filter(isActiveInv);
  return {
    activeAgents: w.agents.filter((a) => a.status === 'active').length,
    busyAgents: w.agents.filter((a) => a.currentTaskId !== null).length,
    tasksQueued: w.tasks.filter((t) => t.status === 'queued').length,
    tasksRunning: w.tasks.filter((t) => t.status === 'running').length,
    tasksBlocked: w.tasks.filter((t) => t.status === 'blocked').length,
    activeInvocations: active.length,
    activeToolIds: [...new Set(active.map((i) => i.toolId))],
    pendingApprovals: 0,
    llmCostMicros: w.costs.costMicros,
    llmCalls: w.costs.llmCalls,
    costEstimated: w.costs.estimated,
    systemPaused: w.system.paused,
    incidents:
      w.tasks.filter((t) => t.status === 'blocked' || t.status === 'failed').length +
      w.invocations.filter((i) => i.status === 'failed').length,
  };
}

export const actionKindOf = (toolId: string, action: string) =>
  toolAction(toolId, action)?.kind ?? 'execute';
