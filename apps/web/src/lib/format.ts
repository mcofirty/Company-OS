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
  if (s >= 3600)
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
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
        text: `${agentName(e.payload.agentId)} · exécution ${
          e.payload.providerClass === 'demo'
            ? 'démo (sans LLM)'
            : e.payload.routing
              ? `${e.payload.routing.auto ? 'auto → ' : ''}${e.payload.routing.reason}`
              : 'LLM'
        }`,
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
    case 'approval.requested':
      return {
        text:
          e.payload.kind === 'agent_hire'
            ? `${agentName(e.payload.agentId)} propose un nouvel agent · validation admin requise`
            : `${agentName(e.payload.agentId)} → ${tool(e.payload.toolId ?? '')} · ${e.payload.action} en attente de validation`,
        tone: 'warning',
        icon: '?',
      };
    case 'approval.decided':
      return {
        text: `Validation ${e.payload.decision === 'approved' ? 'accordée' : e.payload.decision === 'rejected' ? 'refusée' : 'expirée'} · ${e.payload.reason}`,
        tone: e.payload.decision === 'approved' ? 'success' : 'danger',
        icon: e.payload.decision === 'approved' ? '✓' : '✕',
      };
    case 'meeting.started':
      return {
        text: `Réunion « ${e.payload.topic} » · ${e.payload.participantAgentIds.map(agentName).join(', ')}`,
        tone: 'accent',
        icon: '◎',
      };
    case 'meeting.completed':
      return {
        text: `Réunion terminée · ${e.payload.decisions.length} décision(s), ${e.payload.taskIdsCreated.length} tâche(s) déléguée(s)`,
        tone: 'success',
        icon: '◎',
      };
    case 'agent.paused':
      return {
        text: `${agentName(e.payload.agentId)} suspendu · ${e.payload.reason}`,
        tone: 'warning',
        icon: '❚❚',
      };
    case 'agent.resumed':
      return {
        text: `${agentName(e.payload.agentId)} repris · ${e.payload.reason}`,
        tone: 'success',
        icon: '▶',
      };
    case 'task.cancelled':
      return {
        text: `${agentName(e.payload.agentId)} · tâche annulée${e.payload.retriedAs ? ' et relancée' : ''} · ${e.payload.reason}`,
        tone: 'neutral',
        icon: '⊘',
      };
    case 'agent.deactivated':
      return {
        text: `${agentName(e.payload.agentId)} désactivé · ${e.payload.reason}`,
        tone: 'neutral',
        icon: '✕',
      };
    case 'tool.connector.updated': {
      const what = {
        added: 'ajouté',
        synced: 'synchronisé',
        policy: 'politique modifiée',
        removed: 'retiré',
        error: 'injoignable',
      }[e.payload.change];
      return {
        text: `Connecteur ${e.payload.name} ${what} · ${e.payload.actions.length} outil(s) actif(s)`,
        tone:
          e.payload.change === 'error'
            ? 'danger'
            : e.payload.change === 'removed'
              ? 'neutral'
              : 'accent',
        icon: '⇄',
      };
    }
    case 'schedule.updated': {
      const what = {
        created: 'planifiée',
        updated: 'modifiée',
        paused: 'suspendue',
        resumed: 'reprise',
        deleted: 'supprimée',
        triggered: 'lancée',
        skipped: 'sautée (agent indisponible)',
      }[e.payload.change];
      return {
        text: `Mission récurrente « ${e.payload.title} » ${what} · ${agentName(e.payload.agentId)}`,
        tone: e.payload.change === 'skipped' ? 'warning' : 'accent',
        icon: '⟳',
      };
    }
    case 'agent.version.updated':
      return {
        text: `${agentName(e.payload.agentId)} · version ${e.payload.version} (${e.payload.model}) · ${e.payload.note}`,
        tone: 'accent',
        icon: '✎',
      };
    case 'budget.updated':
      return {
        text:
          e.payload.reason === 'new_period'
            ? `Nouveau mois : budget ${e.payload.scopeType === 'org' ? 'de l’organisation' : agentName(e.payload.scopeId)} remis à zéro`
            : `Budget ${e.payload.scopeType === 'org' ? 'de l’organisation' : agentName(e.payload.scopeId)} : ${usd(e.payload.previousLimitMicros)} → ${usd(e.payload.limitMicros)} / mois`,
        tone: 'neutral',
        icon: '$',
      };
    case 'department.updated':
      return {
        text:
          e.payload.change === 'created'
            ? `Nouveau pôle « ${e.payload.name} » · ${e.payload.capacity} postes`
            : `Pôle « ${e.payload.name} » modifié`,
        tone: 'success',
        icon: '🏢',
      };
    case 'agent.deleted':
      return {
        text: `Agent ${e.payload.agentId} supprimé · ${e.payload.reason}`,
        tone: 'neutral',
        icon: '🗑',
      };
    case 'agent.reporting.updated':
      return {
        text: `${agentName(e.payload.agentId)} ${e.payload.managerId ? `rattaché à ${agentName(e.payload.managerId)}` : 'rattaché directement à l’administrateur'}${e.payload.role === 'manager' ? ' · manager' : ''} · ${e.payload.reason}`,
        tone: 'accent',
        icon: '⑂',
      };
    case 'agent.profile.updated':
      return {
        text: `Fiche de ${agentName(e.payload.agentId)} mise à jour · ${e.payload.skills.length} compétence(s)`,
        tone: 'neutral',
        icon: '✎',
      };
    case 'agent.grants.updated':
      return {
        text: `Droits de ${agentName(e.payload.agentId)} modifiés par un administrateur · ${Object.keys(e.payload.grants).length} outil(s)`,
        tone: 'warning',
        icon: '⚿',
      };
  }
}

/** Micro-dollars -> USD (4 décimales sous un cent, jamais d'arrondi trompeur à $0.00). */
export function usd(micros: number): string {
  const dollars = micros / 1_000_000;
  return `$${dollars > 0 && dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}

/** Cible d'inspection associée à un événement. */
export function eventTarget(e: DomainEvent): {
  kind: 'agent' | 'task' | 'invocation' | 'approval' | 'meeting';
  id: string;
} {
  if (e.type.startsWith('approval.')) return { kind: 'approval', id: e.aggregateId };
  if (e.type.startsWith('meeting.')) return { kind: 'meeting', id: e.aggregateId };
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
