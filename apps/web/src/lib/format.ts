import type {
  AgentActivity,
  DomainEvent,
  TaskStatus,
  InvocationStatus,
  WorldSnapshot,
} from '@company-os/contracts';

export const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  idle: 'Disponible',
  queued: 'Tâche en file',
  thinking: 'Requête modèle',
  working: 'Travaille',
  using_tool: 'Utilise un outil',
  in_meeting: 'En réunion',
  waiting_approval: 'Attend une validation',
  blocked: 'Bloqué',
  paused: 'Suspendu',
  offline: 'Hors ligne',
};
export const ACTIVITY_TONE: Record<AgentActivity, string> = {
  idle: 'neutral',
  queued: 'info',
  thinking: 'info',
  working: 'success',
  using_tool: 'accent',
  in_meeting: 'accent',
  waiting_approval: 'warning',
  blocked: 'danger',
  paused: 'neutral',
  offline: 'neutral',
};
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  created: 'Créée',
  queued: 'En file',
  running: 'En cours',
  waiting_approval: 'Validation',
  blocked: 'Bloquée',
  succeeded: 'Réussie',
  failed: 'Échec',
  cancelled: 'Annulée',
};
export const INVOCATION_STATUS_LABEL: Record<InvocationStatus, string> = {
  requested: 'DEMANDÉ',
  authorized: 'AUTORISÉ',
  waiting_approval: 'VALIDATION',
  running: 'EN COURS',
  rejected: 'REFUSÉ',
  succeeded: 'RÉUSSI',
  failed: 'ÉCHEC',
  timed_out: 'DÉLAI',
  cancelled: 'ANNULÉ',
};

export const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export type EventTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning' | 'accent';

/** Description lisible et sanitisée d'un événement (jamais de raisonnement interne). */
export function describe(
  e: DomainEvent,
  w: WorldSnapshot | null,
): { text: string; tone: EventTone; icon: string } {
  const agentName = (id: string): string => w?.agents.find((a) => a.id === id)?.name ?? id;
  const tool = (id: string): string => w?.tools.find((t) => t.id === id)?.code ?? id.toUpperCase();
  const taskTitle = (id: string): string => w?.tasks.find((t) => t.id === id)?.title ?? 'tâche';
  switch (e.type) {
    case 'agent.created':
      return {
        text: `${e.payload.name} rejoint l'équipe (${e.payload.title})`,
        tone: 'info',
        icon: '+',
      };
    case 'agent.activated':
      return { text: `${agentName(e.payload.agentId)} activé`, tone: 'neutral', icon: '✓' };
    case 'task.created':
      return {
        text: `${agentName(e.payload.agentId)} · nouvelle tâche « ${e.payload.title} »`,
        tone: 'neutral',
        icon: '◇',
      };
    case 'task.started':
      return {
        text: `${agentName(e.payload.agentId)} démarre « ${taskTitle(e.payload.taskId)} »`,
        tone: 'info',
        icon: '▶',
      };
    case 'agent.run.started':
      return {
        text: `${agentName(e.payload.agentId)} · exécution ${e.payload.providerClass === 'demo' ? 'démo (sans LLM)' : 'LLM'}`,
        tone: 'neutral',
        icon: '·',
      };
    case 'agent.run.completed':
      return {
        text: `${agentName(e.payload.agentId)} · exécution terminée (${e.payload.stepCount} étape)`,
        tone: 'neutral',
        icon: '·',
      };
    case 'tool.invocation.requested':
      return {
        text: `${agentName(e.payload.agentId)} → ${tool(e.payload.toolId)} · ${e.payload.action} demandé`,
        tone: 'neutral',
        icon: '?',
      };
    case 'tool.invocation.started':
      return {
        text: `${agentName(e.payload.agentId)} → ${tool(e.payload.toolId)} · ${e.payload.action}${e.payload.attempt > 1 ? ` (tentative ${e.payload.attempt})` : ''}`,
        tone: 'accent',
        icon: '⚙',
      };
    case 'tool.invocation.succeeded':
      return {
        text: `${tool(e.payload.toolId)} ✓ ${e.payload.safeSummary}`,
        tone: 'success',
        icon: '✓',
      };
    case 'tool.invocation.failed':
      return {
        text: `${tool(e.payload.toolId)} en échec · ${e.payload.errorCode}`,
        tone: 'danger',
        icon: '!',
      };
    case 'tool.invocation.rejected':
      return {
        text: `${tool(e.payload.toolId)} refusé par la politique · ${e.payload.reasonCode}`,
        tone: 'danger',
        icon: '⛔',
      };
    case 'task.completed':
      return {
        text: `${agentName(e.payload.agentId)} a terminé « ${taskTitle(e.payload.taskId)} »`,
        tone: 'success',
        icon: '✓',
      };
    case 'task.failed':
      return { text: `Tâche en échec · ${e.payload.reasonCode}`, tone: 'danger', icon: '!' };
    case 'task.blocked':
      return {
        text: `${agentName(e.payload.agentId)} bloqué · ${e.payload.reasonCode}`,
        tone: 'danger',
        icon: '!',
      };
    case 'budget.threshold_reached':
      return {
        text: `Budget ${e.payload.scopeType === 'org' ? 'organisation' : agentName(e.payload.scopeId)} à ${e.payload.percent} % (${usd(e.payload.usedMicros)} / ${usd(e.payload.limitMicros)})`,
        tone: 'warning',
        icon: '$',
      };
    case 'system.paused':
      return { text: `Système mis en pause : ${e.payload.reason}`, tone: 'danger', icon: '■' };
    case 'system.resumed':
      return { text: `Système repris : ${e.payload.reason}`, tone: 'success', icon: '▶' };
  }
}

/** Micro-dollars -> USD (4 décimales sous un cent, jamais d'arrondi trompeur à $0.00). */
export function usd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars > 0 && dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

/** Cible d'inspection associée à un événement. */
export function eventTarget(e: DomainEvent): { kind: 'agent' | 'task' | 'invocation'; id: string } {
  if (e.type.startsWith('tool.invocation')) return { kind: 'invocation', id: e.aggregateId };
  if (e.type.startsWith('task.')) return { kind: 'task', id: e.aggregateId };
  const p = e.payload as {
    taskId?: string;
    agentId?: string;
    scopeId?: string;
    scopeType?: string;
  };
  if (e.type === 'budget.threshold_reached' && p.scopeType === 'agent' && p.scopeId) {
    return { kind: 'agent', id: p.scopeId };
  }
  if (e.type.startsWith('agent.run') && p.taskId) return { kind: 'task', id: p.taskId };
  return { kind: 'agent', id: p.agentId ?? e.aggregateId };
}
