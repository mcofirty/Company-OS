import { randomUUID } from 'node:crypto';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import { MODEL_TIERS, tierOfModel, type ModelTier } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';

const ADMIN_MARK = 'Consignes de l’administrateur :\n';

/** Partie « consignes de l'administrateur » d'une version (pour l'édition dans le cockpit). */
export function adminInstructionsOf(instructions: string): string {
  const i = instructions.indexOf(ADMIN_MARK);
  return i >= 0 ? instructions.slice(i + ADMIN_MARK.length) : '';
}

/**
 * Nouvelle version d'un agent (objectif, consignes, niveau de modèle) décidée par un
 * administrateur. Les versions précédentes restent (historique) ; les runs déjà démarrés gardent
 * la leur, les suivants prennent la nouvelle. Les règles de la plateforme restent en tête.
 */
export async function updateAgentVersion(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    agentId: string;
    goal: string;
    instructions: string;
    modelTier: ModelTier;
    note?: string;
  },
): Promise<{ version: number }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId } = ctx;
    const agent = await tx.agent.findFirst({
      where: { id: input.agentId, orgId, deletedAt: null },
      include: { department: true },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const current = await tx.agentVersion.findFirstOrThrow({
      where: { agentId: agent.id },
      orderBy: { version: 'desc' },
    });
    const version = current.version + 1;
    const policy = current.modelPolicy as Record<string, unknown>;
    const model = MODEL_TIERS[input.modelTier].model;
    await tx.agentVersion.create({
      data: {
        id: randomUUID(),
        agentId: agent.id,
        version,
        promptVersion: PROMPT_VERSION,
        instructions: `${instructionsFor(agent.department.roomId, agent.role as 'manager')}\n\n${ADMIN_MARK}${input.instructions.trim()}`,
        goal: input.goal.trim(),
        modelPolicy: { ...policy, model },
        limits: current.limits as object,
        createdBy: `user:${input.actorId}`,
      },
    });
    await tx.agent.update({
      where: { id: agent.id },
      data: { activeVersion: version, version: { increment: 1 } },
    });
    ctx.emit({
      classification: 'internal',
      aggregateType: 'agent',
      aggregateId: agent.id,
      aggregateVersion: agent.version + 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: { kind: 'user', id: input.actorId },
      provenance: ctx.mode,
      type: 'agent.version.updated',
      payload: {
        agentId: agent.id,
        version,
        model,
        note: (input.note ?? '').slice(0, 200) || 'Consignes mises à jour',
      },
    });
    return { version };
  });
  return result;
}

/** Historique des versions d'un agent (sans les règles de plateforme). */
export async function agentVersions(db: Db, agentId: string) {
  const rows = await db.agentVersion.findMany({
    where: { agentId },
    orderBy: { version: 'desc' },
    take: 20,
  });
  return rows.map((v) => {
    const model = String((v.modelPolicy as { model?: string }).model ?? '');
    return {
      version: v.version,
      goal: v.goal,
      instructions: adminInstructionsOf(v.instructions),
      model,
      modelTier: tierOfModel(model),
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
    };
  });
}

/** Plafond mensuel d'un budget (organisation ou agent) modifié par un administrateur. */
export async function updateBudgetLimit(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    scopeType: 'org' | 'agent';
    scopeId: string;
    monthlyLimitUsd: number;
  },
): Promise<{ limitMicros: number }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId } = ctx;
    const scopeId = input.scopeType === 'org' ? orgId : input.scopeId;
    const b = await tx.budget.findFirst({
      where: { orgId, scopeType: input.scopeType, scopeId, period: 'month' },
    });
    if (!b) throw new DomainError('NOT_FOUND', 'Budget introuvable');
    const limitMicros = Math.round(input.monthlyLimitUsd * 1_000_000);
    await tx.budget.update({
      where: { id: b.id },
      // Nouveau plafond : l'alerte de seuil peut se redéclencher.
      data: { limitMicros, alertedAt: null },
    });
    ctx.emit({
      classification: 'internal',
      aggregateType: 'budget',
      aggregateId: b.id,
      aggregateVersion: 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: { kind: 'user', id: input.actorId },
      provenance: ctx.mode,
      type: 'budget.updated',
      payload: {
        budgetId: b.id,
        scopeType: input.scopeType,
        scopeId,
        limitMicros,
        previousLimitMicros: b.limitMicros,
        usedMicros: b.usedMicros,
        reason: 'limit_changed',
      },
    });
    return { limitMicros };
  });
  return result;
}

export const monthStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Remise à zéro mensuelle des budgets (1er du mois, UTC). Appelée périodiquement par le worker ;
 * idempotente. Chaque remise émet `budget.updated` (raison `new_period`) : la projection suit.
 */
export async function rollBudgetPeriods(db: Db, now = new Date()): Promise<number> {
  const start = monthStart(now);
  const due = await db.budget.findMany({
    where: { period: 'month', periodStart: { lt: start } },
    select: { id: true, orgId: true },
  });
  for (const d of due) {
    await withOrgTx(db, d.orgId, now, async (ctx) => {
      const b = await ctx.tx.budget.findUnique({ where: { id: d.id } });
      if (!b || b.periodStart >= start) return;
      await ctx.tx.budget.update({
        where: { id: b.id },
        data: { usedMicros: 0, reservedMicros: 0, alertedAt: null, periodStart: start },
      });
      ctx.emit({
        classification: 'internal',
        aggregateType: 'budget',
        aggregateId: b.id,
        aggregateVersion: 1,
        correlationId: randomUUID(),
        causationId: null,
        actor: { kind: 'system', id: 'budget-period' },
        provenance: ctx.mode,
        type: 'budget.updated',
        payload: {
          budgetId: b.id,
          scopeType: b.scopeType as 'org' | 'agent',
          scopeId: b.scopeId,
          limitMicros: b.limitMicros,
          previousLimitMicros: b.limitMicros,
          usedMicros: 0,
          reason: 'new_period',
        },
      });
    });
  }
  return due.length;
}
