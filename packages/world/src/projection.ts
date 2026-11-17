import { alertFromEvent } from './alerts';
import {
  LIMITS,
  OPEN_TASK_STATUSES,
  ACTIVE_INVOCATION_STATUSES,
  toolAction,
  type AgentView,
  type ApprovalView,
  type AlertView,
  type MeetingView,
  type DomainEvent,
  type InvocationView,
  type TaskView,
  type WorldSnapshot,
} from '@company-os/contracts';

/** Ancrage fictif d'un agent désactivé : son poste redevient attribuable (ADR-030). */
export const retiredAnchor = (agentId: string): string => `retired:${agentId}`;

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
        parentTaskId: p.parentTaskId,
        depth: p.depth,
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
    case 'approval.requested': {
      const p = e.payload;
      const approval: ApprovalView = {
        id: p.approvalId,
        kind: p.kind,
        status: 'pending',
        agentId: p.agentId,
        taskId: p.taskId,
        invocationId: p.invocationId,
        toolId: p.toolId,
        action: p.action,
        riskReason: p.riskReason,
        safePreview: p.safePreview,
        requestedAt: at,
        deadlineAt: p.deadlineAt,
        reviewedBy: null,
        reviewedAt: null,
        decisionReason: null,
      };
      w = { ...w, approvals: trimApprovals([approval, ...w.approvals]) };
      if (p.invocationId) {
        w = patchInvocation(w, p.invocationId, () => ({ status: 'waiting_approval' }));
      }
      if (p.kind === 'tool_action') {
        w = patchAgent(w, p.agentId, () => ({ activity: 'waiting_approval' }));
      }
      break;
    }
    case 'approval.decided': {
      const p = e.payload;
      const before = w.approvals.find((a) => a.id === p.approvalId);
      w = {
        ...w,
        approvals: trimApprovals(
          w.approvals.map((a) =>
            a.id === p.approvalId
              ? {
                  ...a,
                  status: p.decision,
                  reviewedBy: p.reviewerId,
                  reviewedAt: at,
                  decisionReason: p.reason,
                }
              : a,
          ),
        ),
      };
      if (before?.kind === 'tool_action') {
        w = patchAgent(w, before.agentId, (a) =>
          a.activity === 'waiting_approval' ? { activity: 'working' } : {},
        );
      }
      break;
    }
    case 'meeting.started': {
      const p = e.payload;
      const meeting: MeetingView = {
        id: p.meetingId,
        topic: p.topic,
        status: 'in_progress',
        roomId: p.roomId,
        initiatorAgentId: p.initiatorAgentId,
        taskId: p.taskId,
        participantAgentIds: p.participantAgentIds,
        seats: p.seats,
        startedAt: at,
        endedAt: null,
        summary: null,
        decisions: [],
        taskIdsCreated: [],
      };
      w = { ...w, meetings: trimMeetings([meeting, ...w.meetings]) };
      for (const id of p.participantAgentIds)
        w = patchAgent(w, id, () => ({ activity: 'in_meeting' }));
      break;
    }
    case 'agent.paused':
      w = patchAgent(w, e.payload.agentId, (a) => ({
        status: 'paused',
        activity: a.currentTaskId ? a.activity : 'paused',
      }));
      break;
    case 'agent.resumed':
      w = patchAgent(w, e.payload.agentId, (a) => ({
        status: 'active',
        activity: a.activity === 'paused' ? activityAtRest(w.tasks, a) : a.activity,
      }));
      break;
    case 'agent.deactivated':
      // Libère le poste (contrainte unique org+poste) ; le poste d'origine reste dans agent.created.
      w = patchAgent(w, e.payload.agentId, () => ({
        status: 'deactivated',
        activity: 'offline',
        deskAnchor: retiredAnchor(e.payload.agentId),
      }));
      break;
    case 'meeting.completed': {
      const p = e.payload;
      const m = w.meetings.find((x) => x.id === p.meetingId);
      w = {
        ...w,
        meetings: trimMeetings(
          w.meetings.map((x) =>
            x.id === p.meetingId
              ? {
                  ...x,
                  status: 'completed',
                  endedAt: at,
                  summary: p.summary,
                  decisions: p.decisions,
                  taskIdsCreated: p.taskIdsCreated,
                }
              : x,
          ),
        ),
      };
      for (const id of m?.participantAgentIds ?? []) {
        w = patchAgent(w, id, (a) => ({ activity: activityAtRest(w.tasks, a) }));
      }
      break;
    }
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
    case 'task.cancelled': {
      const p = e.payload;
      w = patchTask(w, p.taskId, () => ({
        status: 'cancelled',
        endedAt: at,
        resultSummary: `Annulée : ${p.reason}`,
      }));
      w = patchAgent(w, p.agentId, (a) =>
        a.currentTaskId === p.taskId
          ? {
              // Mission arrêtée en cours : l'agent est libéré (même règle côté serveur).
              currentTaskId: null,
              lastTaskEndedAt: at,
              activity:
                a.status === 'paused' ? 'paused' : activityAfterTask(w.tasks, p.agentId, false),
            }
          : { activity: activityAfterCancel(a.activity, w.tasks, p.agentId) },
      );
      w = { ...w, tasks: trimTasks(w.tasks) };
      break;
    }
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
    case 'tool.connector.updated': {
      const p = e.payload;
      const others = w.tools.filter((t) => t.id !== p.toolId);
      w = {
        ...w,
        tools: p.removed
          ? others
          : sortTools([
              ...others,
              {
                id: p.toolId,
                name: p.name,
                code: p.code,
                category: 'connector',
                color: p.color,
                status: p.status,
                actions: p.actions,
              },
            ]),
      };
      break;
    }
    case 'agent.grants.updated':
    case 'agent.profile.updated':
      break;
    case 'schedule.updated':
      break; // audit : les planifications sont lues par l'API
    case 'agent.version.updated':
      break; // audit : la version active est lue côté serveur au démarrage de chaque run
    case 'budget.updated': {
      const p = e.payload;
      w = {
        ...w,
        budgets: w.budgets.map((b) =>
          b.id === p.budgetId ? { ...b, limitMicros: p.limitMicros, usedMicros: p.usedMicros } : b,
        ),
      };
      break;
    }
    case 'agent.deleted':
      w = { ...w, agents: w.agents.filter((a) => a.id !== e.payload.agentId) };
      break;
    case 'agent.reporting.updated':
      w = patchAgent(w, e.payload.agentId, () => ({
        managerId: e.payload.managerId,
        role: e.payload.role,
      }));
      break; // journal / audit seulement : les droits ne font pas partie de la projection
  }
  const alert = alertFromEvent(e);
  if (alert) w = { ...w, alerts: trimAlerts([alert, ...w.alerts]) };
  return { world: w, outcome: 'applied' };
}

/** Ordre des machines-outils, identique côté serveur (snapshot) et client (fold). */
export const sortTools = <T extends { id: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Garde les alertes non acquittées + les plus récentes acquittées (même règle serveur). */
export function trimAlerts(list: AlertView[]): AlertView[] {
  const open = list.filter((a) => a.ackedAt === null);
  const done = list
    .filter((a) => a.ackedAt !== null)
    .sort((a, b) => b.eventSeq - a.eventSeq)
    .slice(0, Math.max(0, LIMITS.alerts - open.length));
  return [...open, ...done].sort((a, b) => b.eventSeq - a.eventSeq);
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
/**
 * Règle commune serveur/client : activité d'un agent libéré (fin de réunion).
 * Tâche en cours -> working ; sinon tâche en file -> queued ; sinon idle.
 */
export function activityAtRest(
  tasks: readonly Pick<TaskView, 'agentId' | 'status'>[],
  agent: Pick<AgentView, 'id' | 'currentTaskId'>,
): AgentView['activity'] {
  if (agent.currentTaskId) return 'working';
  return tasks.some((t) => t.agentId === agent.id && t.status === 'queued') ? 'queued' : 'idle';
}

export function activityAfterTask(
  tasks: readonly Pick<TaskView, 'agentId' | 'status'>[],
  agentId: string,
  blocked: boolean,
): AgentView['activity'] {
  if (blocked) return 'blocked';
  return tasks.some((t) => t.agentId === agentId && t.status === 'queued') ? 'queued' : 'idle';
}

/**
 * Activité d'un agent après l'annulation d'une de ses tâches (même règle serveur et client) :
 * seul un agent au repos (en file, bloqué, disponible) change d'état ; un agent occupé, en
 * réunion ou suspendu n'est pas touché. `tasks` = état APRÈS annulation.
 */
export function activityAfterCancel(
  current: AgentView['activity'],
  tasks: readonly Pick<TaskView, 'agentId' | 'status'>[],
  agentId: string,
): AgentView['activity'] {
  if (!['blocked', 'queued', 'idle'].includes(current)) return current;
  if (tasks.some((t) => t.agentId === agentId && t.status === 'blocked')) return 'blocked';
  return activityAfterTask(tasks, agentId, false);
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
export function trimApprovals(list: ApprovalView[]): ApprovalView[] {
  const open = list.filter((a) => a.status === 'pending');
  const done = list
    .filter((a) => a.status !== 'pending')
    .sort(
      (a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || b.id.localeCompare(a.id),
    )
    .slice(0, Math.max(0, LIMITS.approvals - open.length));
  return [...open, ...done].sort(
    (a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id),
  );
}
export function trimMeetings(list: MeetingView[]): MeetingView[] {
  const open = list.filter((m) => m.status === 'in_progress');
  const done = list
    .filter((m) => m.status !== 'in_progress')
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? '') || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, LIMITS.meetings - open.length));
  return [...open, ...done].sort(
    (a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || b.id.localeCompare(a.id),
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
  activeMeetings: number;
  /** Coût LLM cumulé (micro-dollars) et nature (estimé depuis la grille tarifaire). */
  llmCostMicros: number;
  llmCalls: number;
  costEstimated: boolean;
  systemPaused: boolean;
  incidents: number;
}

/**
 * Indicateurs du bandeau. `incidents` = problèmes RÉCENTS (24 h) : tâches bloquées ou échouées
 * et actions d'outil en échec ; les anciens incidents restent consultables dans « Missions ».
 */
export function computeMetrics(w: WorldSnapshot, now: number = Date.now()): Metrics {
  const DAY = 86_400_000;
  const recent = (iso: string | null | undefined): boolean => !!iso && now - Date.parse(iso) < DAY;
  const active = w.invocations.filter(isActiveInv);
  return {
    activeAgents: w.agents.filter((a) => a.status === 'active').length,
    busyAgents: w.agents.filter((a) => a.currentTaskId !== null).length,
    tasksQueued: w.tasks.filter((t) => t.status === 'queued').length,
    tasksRunning: w.tasks.filter((t) => t.status === 'running').length,
    tasksBlocked: w.tasks.filter((t) => t.status === 'blocked').length,
    activeInvocations: active.length,
    activeToolIds: [...new Set(active.map((i) => i.toolId))],
    pendingApprovals: w.approvals.filter((a) => a.status === 'pending').length,
    activeMeetings: w.meetings.filter((m) => m.status === 'in_progress').length,
    llmCostMicros: w.costs.costMicros,
    llmCalls: w.costs.llmCalls,
    costEstimated: w.costs.estimated,
    systemPaused: w.system.paused,
    incidents:
      w.tasks.filter(
        (t) =>
          (t.status === 'failed' && recent(t.endedAt)) ||
          (t.status === 'blocked' && recent(t.startedAt ?? t.createdAt)),
      ).length + w.invocations.filter((i) => i.status === 'failed' && recent(i.endedAt)).length,
  };
}

export const actionKindOf = (toolId: string, action: string) =>
  toolAction(toolId, action)?.kind ?? 'execute';
