import { randomUUID } from 'node:crypto';
import { activityAtRest, retiredAnchor } from '@company-os/world';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';

export type AgentLifecycleAction = 'pause' | 'resume' | 'deactivate';

/**
 * Cycle de vie administratif d'un agent (docs/03 §4, docs/01 §5).
 * - pause : plus aucune nouvelle exécution ; un run en cours se termine ;
 * - resume : retour à `active` ;
 * - deactivate : soft delete (historique conservé), refusé tant que l'agent a des tâches ouvertes.
 */
export async function setAgentLifecycle(
  db: Db,
  input: {
    orgId: string;
    agentId: string;
    action: AgentLifecycleAction;
    reason: string;
    actor: { kind: 'user'; id: string };
  },
): Promise<{ status: string; changed: boolean }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId } = ctx;
    const a = await tx.agent.findFirst({ where: { id: input.agentId, orgId, deletedAt: null } });
    if (!a) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const target =
      input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'deactivated';
    if (a.status === target) return { status: a.status, changed: false };
    const allowed: Record<AgentLifecycleAction, string[]> = {
      pause: ['active'],
      resume: ['paused'],
      deactivate: ['active', 'paused'],
    };
    if (!allowed[input.action].includes(a.status)) {
      throw new DomainError('CONFLICT', `Transition interdite ${a.status} -> ${target}`);
    }
    const queued = await tx.task.findMany({
      where: {
        orgId,
        agentId: a.id,
        status: { in: ['queued', 'running', 'waiting_approval', 'blocked'] },
      },
      select: { agentId: true, status: true },
    });
    if (input.action === 'deactivate' && queued.length > 0) {
      throw new DomainError(
        'CONFLICT',
        `${queued.length} tâche(s) ouverte(s) : à terminer ou réassigner avant désactivation`,
      );
    }
    // Même règle que le réducteur client.
    const activity =
      input.action === 'pause'
        ? a.currentTaskId
          ? a.activity
          : 'paused'
        : input.action === 'resume'
          ? a.activity === 'paused'
            ? activityAtRest(
                queued
                  .filter((t) => t.status === 'queued')
                  .map((t) => ({ agentId: t.agentId, status: 'queued' as const })),
                a,
              )
            : a.activity
          : 'offline';
    await tx.agent.update({
      where: { id: a.id },
      data: {
        status: target,
        activity,
        version: { increment: 1 },
        ...(target === 'deactivated' ? { deskAnchor: retiredAnchor(a.id) } : {}),
      },
    });
    const reason = input.reason.slice(0, 200);
    const common = {
      classification: 'internal' as const,
      aggregateType: 'agent',
      aggregateId: a.id,
      aggregateVersion: a.version + 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: input.actor,
      provenance: a.provenance,
    };
    if (input.action === 'pause')
      ctx.emit({ ...common, type: 'agent.paused', payload: { agentId: a.id, reason } });
    else if (input.action === 'resume')
      ctx.emit({ ...common, type: 'agent.resumed', payload: { agentId: a.id, reason } });
    else ctx.emit({ ...common, type: 'agent.deactivated', payload: { agentId: a.id, reason } });
    return { status: target, changed: true };
  });
  return result;
}

/** Acquittement d'alerte : idempotent, conserve l'historique. */
export async function ackAlert(db: Db, input: { orgId: string; alertId: string; userId: string }) {
  const a = await db.alert.findFirst({ where: { id: input.alertId, orgId: input.orgId } });
  if (!a) throw new DomainError('NOT_FOUND', 'Alerte introuvable');
  if (a.ackedAt) return a;
  return db.alert.update({
    where: { id: a.id },
    data: { ackedAt: new Date(), ackedBy: input.userId },
  });
}

/** « Tout marquer comme lu » : acquitte toutes les alertes ouvertes de l'organisation. */
export async function ackAllAlerts(db: Db, input: { orgId: string; userId: string }) {
  const now = new Date();
  const r = await db.alert.updateMany({
    where: { orgId: input.orgId, ackedAt: null },
    data: { ackedAt: now, ackedBy: input.userId },
  });
  return { acked: r.count, ackedAt: now.toISOString() };
}

/** « Depuis ta dernière visite » : ce qui s'est passé depuis `since` (compteurs réels). */
export async function activitySince(db: Db, orgId: string, since: Date) {
  const [completed, failed, blocked, documents, pending, cost, agents] = await Promise.all([
    db.task.count({ where: { orgId, status: 'succeeded', endedAt: { gte: since } } }),
    db.task.count({ where: { orgId, status: 'failed', endedAt: { gte: since } } }),
    db.task.count({ where: { orgId, status: 'blocked', createdAt: { gte: since } } }),
    db.document.count({ where: { orgId, createdAt: { gte: since } } }),
    db.approvalRequest.count({ where: { orgId, status: 'pending' } }),
    db.llmUsage.aggregate({
      where: { orgId, createdAt: { gte: since } },
      _sum: { costMicros: true },
    }),
    db.agent.count({ where: { orgId, createdAt: { gte: since }, deletedAt: null } }),
  ]);
  return {
    since: since.toISOString(),
    completed,
    failed,
    blocked,
    documents,
    pendingApprovals: pending,
    costMicros: cost._sum.costMicros ?? 0,
    newAgents: agents,
  };
}

export type MetricsWindow = '1h' | '24h' | '7d';
const WINDOW_MS: Record<MetricsWindow, number> = {
  '1h': 3600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

/**
 * KPI par fenêtre (docs/10 §3), calculés en base. `null` plutôt qu'un pourcentage inventé
 * quand l'échantillon est vide. Santé des outils : volume, taux d'erreur, p95, dernière utilisation.
 */
export async function metricsSummary(
  db: Db,
  orgId: string,
  window: MetricsWindow,
  now = new Date(),
) {
  const since = new Date(now.getTime() - WINDOW_MS[window]);
  const [succeeded, failed, blocked, cost, tools] = await Promise.all([
    db.task.count({ where: { orgId, status: 'succeeded', endedAt: { gte: since } } }),
    db.task.count({ where: { orgId, status: 'failed', endedAt: { gte: since } } }),
    db.task.count({ where: { orgId, status: 'blocked' } }), // bloquées à l'instant T (pas de fenêtre)
    db.agentRun.aggregate({
      where: { orgId, endedAt: { gte: since } },
      _sum: { costMicros: true, llmCalls: true },
    }),
    db.$queryRaw<
      {
        tool_id: string;
        calls: bigint;
        failures: bigint;
        p95: number | null;
        last_used: Date | null;
      }[]
    >`SELECT tool_id,
             COUNT(*) AS calls,
             COUNT(*) FILTER (WHERE status IN ('failed','timed_out')) AS failures,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS p95,
             MAX(requested_at) AS last_used
      FROM tool_invocations
      WHERE org_id = ${orgId}::uuid AND requested_at >= ${since}
      GROUP BY tool_id`,
  ]);
  const finished = succeeded + failed;
  return {
    window,
    since: since.toISOString(),
    tasks: {
      succeeded,
      failed,
      blocked,
      successRate: finished > 0 ? succeeded / finished : null,
      sample: finished,
    },
    llm: { calls: cost._sum.llmCalls ?? 0, costMicros: cost._sum.costMicros ?? 0 },
    tools: tools.map((t) => {
      const calls = Number(t.calls);
      const failures = Number(t.failures);
      const errorRate = calls > 0 ? failures / calls : null;
      return {
        toolId: t.tool_id,
        calls,
        failures,
        errorRate,
        p95Ms: t.p95 === null ? null : Math.round(t.p95),
        lastUsedAt: t.last_used ? t.last_used.toISOString() : null,
        health: errorRate !== null && calls >= 2 && errorRate >= 0.5 ? 'degraded' : 'healthy',
      };
    }),
  };
}
