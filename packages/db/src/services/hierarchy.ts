import { randomUUID } from 'node:crypto';
import type { AgentRole } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { cancelTaskInTx, createTaskInTx } from './tasks';

/**
 * Hiérarchie des agents (organigramme). Seul un administrateur humain la modifie :
 * rattachement à un manager (ou directement à l'administrateur), promotion / rétrogradation.
 * Règles : pas de cycle, pas de rattachement à un agent désactivé, un manager qui a encore des
 * subordonnés ne peut pas être rétrogradé, rattacher sous un spécialiste le promeut manager.
 */
export async function updateReporting(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    agentId: string;
    managerId: string | null;
    role: 'manager' | 'specialist';
    reason?: string;
  },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId } = ctx;
    const all = await tx.agent.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, name: true, role: true, managerId: true, status: true, version: true },
    });
    const byId = new Map(all.map((a) => [a.id, a]));
    const agent = byId.get(input.agentId);
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    if (agent.status === 'deactivated') {
      throw new DomainError('CONFLICT', 'Agent désactivé : hiérarchie figée');
    }
    const reports = all.filter((a) => a.managerId === agent.id && a.status !== 'deactivated');
    if (input.role !== 'manager' && reports.length > 0) {
      throw new DomainError(
        'CONFLICT',
        `${agent.name} encadre encore ${reports.length} agent(s) : les rattacher ailleurs d'abord`,
      );
    }
    if (input.managerId !== null) {
      const manager = byId.get(input.managerId);
      if (!manager) throw new DomainError('NOT_FOUND', 'Manager introuvable');
      if (manager.id === agent.id) throw new DomainError('VALIDATION_ERROR', 'Auto-rattachement');
      if (manager.status === 'deactivated') {
        throw new DomainError('CONFLICT', 'Impossible de rattacher à un agent désactivé');
      }
      // Cycle : le futur manager ne doit pas être sous l'agent.
      for (let cur: string | null = manager.id, n = 0; cur && n < 100; n++) {
        if (cur === agent.id) {
          throw new DomainError(
            'CONFLICT',
            `${manager.name} fait partie de l'équipe de ${agent.name}`,
          );
        }
        cur = byId.get(cur)?.managerId ?? null;
      }
      // Rattacher sous un spécialiste en fait un manager (décision du même humain).
      if (manager.role !== 'manager') {
        await tx.agent.update({ where: { id: manager.id }, data: { role: 'manager' } });
        emitReporting(ctx, input.actorId, manager, manager.managerId, 'manager', 'Promu manager');
      }
    }
    await tx.agent.update({
      where: { id: agent.id },
      data: { managerId: input.managerId, role: input.role },
    });
    if (input.role !== 'manager') {
      // L'outil Équipe n'appartient qu'aux managers.
      await tx.agentToolGrant.deleteMany({ where: { agentId: agent.id, toolId: 'team' } });
    }
    emitReporting(
      ctx,
      input.actorId,
      agent,
      input.managerId,
      input.role,
      (input.reason ?? 'Organigramme modifié').slice(0, 200),
    );
  });
}

function emitReporting(
  ctx: OrgTxContext,
  actorId: string,
  agent: { id: string; version: number },
  managerId: string | null,
  role: AgentRole,
  reason: string,
): void {
  ctx.emit({
    classification: 'internal',
    aggregateType: 'agent',
    aggregateId: agent.id,
    aggregateVersion: agent.version,
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'user', id: actorId },
    provenance: ctx.mode,
    type: 'agent.reporting.updated',
    payload: { agentId: agent.id, managerId, role, reason },
  });
}

/** Équipe directe d'un manager : état, mission en cours, derniers résultats (outil `team.list`). */
export async function teamOf(db: Db, orgId: string, managerId: string, focus = 'tout') {
  const reports = await db.agent.findMany({
    where: {
      orgId,
      managerId,
      deletedAt: null,
      ...(focus !== 'tout' && focus.trim() ? { id: focus.trim() } : {}),
    },
    orderBy: { name: 'asc' },
  });
  const out = [];
  for (const a of reports) {
    const tasks = await db.task.findMany({
      where: { orgId, agentId: a.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    out.push({
      agentId: a.id,
      name: a.name,
      title: a.title,
      status: a.status,
      activity: a.activity,
      skills: a.skills ?? [],
      recentTasks: tasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        result: (t.resultSummary ?? t.failureCode ?? '').slice(0, 400),
      })),
    });
  }
  const pendingHires = await db.approvalRequest.count({
    where: { orgId, kind: 'agent_hire', status: 'pending', agentId: managerId },
  });
  return { reports: out, pendingHires };
}

/** Un manager confie une mission à un subordonné DIRECT (sous-tâche de sa mission en cours). */
export async function assignToReport(
  db: Db,
  input: {
    orgId: string;
    managerId: string;
    assigneeAgentId: string;
    title: string;
    instructions: string;
    parentTaskId: string | null;
    idempotencyKey: string;
    causationId: string | null;
  },
) {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const assignee = await ctx.tx.agent.findFirst({
      where: { id: input.assigneeAgentId.trim(), orgId: ctx.orgId, deletedAt: null },
    });
    if (!assignee || assignee.managerId !== input.managerId) {
      throw new DomainError('POLICY_DENIED', 'Destinataire hors de votre équipe directe');
    }
    if (assignee.status !== 'active') {
      throw new DomainError('CONFLICT', `${assignee.name} n'est pas actif`);
    }
    return createTaskInTx(ctx, {
      kind: 'custom',
      agentId: assignee.id,
      mission: {
        title: input.title.trim().slice(0, 120) || 'Mission du manager',
        instructions: input.instructions.trim().slice(0, 4000),
      },
      requester: { kind: 'agent', id: input.managerId },
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      idempotencyKey: input.idempotencyKey,
      causationId: input.causationId,
    });
  });
  return result;
}

/**
 * Suppression d'un agent par un administrateur humain (suppression logique : l'historique reste).
 * Mission en cours : arrêtée (le worker s'arrête à sa prochaine étape). Tâches ouvertes : annulées. Subordonnés :
 * rattachés au manager de l'agent (ou à l'administrateur). Droits retirés, poste libéré,
 * propositions de recrutement en attente rejetées.
 */
export async function deleteAgent(
  db: Db,
  input: { orgId: string; actorId: string; agentId: string; reason: string },
): Promise<{ cancelledTasks: number; reassigned: number }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId } = ctx;
    const agent = await tx.agent.findFirst({
      where: { id: input.agentId, orgId, deletedAt: null },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const reason = input.reason.trim().slice(0, 200) || 'Suppression par un administrateur';
    const actor = { kind: 'user' as const, id: input.actorId };
    const open = await tx.task.findMany({
      where: {
        orgId,
        agentId: agent.id,
        status: { in: ['created', 'queued', 'blocked', 'running', 'waiting_approval'] },
      },
      select: { id: true },
    });
    for (const t of open) {
      await cancelTaskInTx(ctx, {
        taskId: t.id,
        reason: `Agent supprimé : ${reason}`.slice(0, 200),
        actor,
        retriedAs: null,
      });
    }
    // Subordonnés : rattachés au manager de l'agent supprimé.
    const reports = await tx.agent.findMany({
      where: { orgId, managerId: agent.id, deletedAt: null },
    });
    const newManager = agent.managerId;
    for (const r of reports) {
      await tx.agent.update({ where: { id: r.id }, data: { managerId: newManager } });
      emitReporting(
        ctx,
        input.actorId,
        r,
        newManager,
        r.role as AgentRole,
        `Rattaché suite à la suppression de ${agent.name}`,
      );
    }
    // Propositions de recrutement de cet agent encore en attente : rejetées.
    const hires = await tx.approvalRequest.findMany({
      where: { orgId, agentId: agent.id, status: 'pending' },
    });
    for (const h of hires) {
      await tx.approvalRequest.update({
        where: { id: h.id },
        data: {
          status: 'rejected',
          reviewedAt: ctx.now,
          reviewedBy: input.actorId,
          decisionReason: 'Demandeur supprimé',
          version: { increment: 1 },
        },
      });
      ctx.emit({
        classification: 'internal',
        aggregateType: 'approval',
        aggregateId: h.id,
        aggregateVersion: h.version + 1,
        correlationId: randomUUID(),
        causationId: null,
        actor,
        provenance: ctx.mode,
        type: 'approval.decided',
        payload: {
          approvalId: h.id,
          decision: 'rejected',
          reviewerId: input.actorId,
          reason: 'Demandeur supprimé',
        },
      });
    }
    await tx.agentToolGrant.deleteMany({ where: { agentId: agent.id } });
    await tx.agent.update({
      where: { id: agent.id },
      data: {
        deletedAt: ctx.now,
        status: 'deactivated',
        activity: 'offline',
        currentTaskId: null,
        deskAnchor: `deleted:${agent.id}`,
        version: { increment: 1 },
      },
    });
    ctx.emit({
      classification: 'internal',
      aggregateType: 'agent',
      aggregateId: agent.id,
      aggregateVersion: agent.version + 1,
      correlationId: randomUUID(),
      causationId: null,
      actor,
      provenance: ctx.mode,
      type: 'agent.deleted',
      payload: { agentId: agent.id, reason, reportsReassignedTo: newManager },
    });
    return { cancelledTasks: open.length, reassigned: reports.length };
  });
  return result;
}
