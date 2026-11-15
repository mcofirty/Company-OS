import type { AlertView, DomainEvent } from '@company-os/contracts';

/**
 * Règle unique (serveur ET client) : quels événements produisent une alerte persistée, et à quel
 * niveau (docs/10 §5). Le bruit normal reste dans la timeline. id de l'alerte = eventId.
 */
export function alertFromEvent(e: DomainEvent): AlertView | null {
  const base = {
    id: e.eventId,
    eventSeq: e.seq,
    createdAt: e.occurredAt,
    ackedAt: null,
    ackedBy: null,
  };
  switch (e.type) {
    case 'task.blocked':
      return {
        ...base,
        level: 'error',
        title: `Tâche bloquée · ${e.payload.reasonCode}`,
        resourceType: 'task',
        resourceId: e.payload.taskId,
      };
    case 'task.failed':
      return {
        ...base,
        level: 'error',
        title: `Tâche en échec · ${e.payload.reasonCode}`,
        resourceType: 'task',
        resourceId: e.payload.taskId,
      };
    case 'tool.invocation.failed':
      return {
        ...base,
        level: 'error',
        title: `Outil ${e.payload.toolId} en échec · ${e.payload.errorCode}`,
        resourceType: 'invocation',
        resourceId: e.payload.invocationId,
      };
    case 'tool.invocation.rejected':
      return {
        ...base,
        level: 'warning',
        title: `Appel ${e.payload.toolId} refusé · ${e.payload.reasonCode}`,
        resourceType: 'invocation',
        resourceId: e.payload.invocationId,
      };
    case 'approval.requested':
      return {
        ...base,
        level: 'warning',
        title:
          e.payload.kind === 'agent_hire'
            ? 'Validation requise : nouvel agent'
            : `Validation requise : ${e.payload.toolId}.${e.payload.action}`,
        resourceType: 'approval',
        resourceId: e.payload.approvalId,
      };
    case 'budget.threshold_reached':
      return {
        ...base,
        level: e.payload.percent >= 100 && e.payload.hardStop ? 'critical' : 'warning',
        title: `Budget ${e.payload.scopeType === 'org' ? 'organisation' : e.payload.scopeId} à ${e.payload.percent} %`,
        resourceType: e.payload.scopeType === 'agent' ? 'agent' : 'budget',
        resourceId: e.payload.scopeType === 'agent' ? e.payload.scopeId : e.payload.budgetId,
      };
    case 'system.paused':
      return {
        ...base,
        level: 'critical',
        title: `Système en pause : ${e.payload.reason}`,
        resourceType: 'system',
        resourceId: e.orgId,
      };
    case 'agent.deactivated':
      return {
        ...base,
        level: 'info',
        title: `Agent désactivé : ${e.payload.agentId}`,
        resourceType: 'agent',
        resourceId: e.payload.agentId,
      };
    case 'agent.created':
      // Seulement les recrutements décidés par un humain (pas le seed).
      return e.actor.kind === 'user'
        ? {
            ...base,
            level: 'info',
            title: `Nouvel agent : ${e.payload.name}`,
            resourceType: 'agent',
            resourceId: e.payload.agentId,
          }
        : null;
    default:
      return null;
  }
}
