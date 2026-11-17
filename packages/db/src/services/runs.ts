import { randomUUID } from 'node:crypto';
import { canReserve, crossesThreshold, usagePercent } from '@company-os/policies';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';

export interface ModelPolicy {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
}
export interface RunLimits {
  maxSteps: number;
  maxDurationMs: number;
  maxCostMicros: number;
}

/** Contexte immuable d'un run : agent, version active, autorisations, tâche, mode. */
export async function loadRunContext(db: Db, runId: string) {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    include: { task: true, agent: { include: { grants: true, department: true } } },
  });
  if (!run) throw new DomainError('NOT_FOUND', `Run ${runId} introuvable`);
  const version = await db.agentVersion.findUnique({
    where: { agentId_version: { agentId: run.agentId, version: run.agentVersion } },
  });
  if (!version)
    throw new DomainError('NOT_FOUND', `Version ${run.agentVersion} de ${run.agentId} introuvable`);
  const org = await db.organization.findUniqueOrThrow({ where: { id: run.orgId } });
  const manager = run.agent.managerId
    ? await db.agent.findUnique({
        where: { id: run.agent.managerId },
        select: { name: true, title: true },
      })
    : null;
  return {
    run,
    task: run.task,
    agent: run.agent,
    manager,
    org,
    version: {
      version: version.version,
      promptVersion: version.promptVersion,
      instructions: version.instructions,
      goal: version.goal,
      modelPolicy: version.modelPolicy as unknown as ModelPolicy,
      // Mission récurrente : plafond de coût fixé pour CETTE exécution (les budgets restent appliqués).
      limits: {
        ...(version.limits as unknown as RunLimits),
        ...(run.task.costCapMicros !== null ? { maxCostMicros: run.task.costCapMicros } : {}),
      },
    },
    grants: run.agent.grants.map((g) => ({ toolId: g.toolId, actions: g.actions })),
  };
}

/**
 * Réserve un montant sur les budgets org + agent avant un appel modèle (docs/05 §6).
 * Refus `BUDGET_EXCEEDED` si un plafond dur serait dépassé. Aucun événement émis.
 */
export async function reserveBudget(
  db: Db,
  input: { orgId: string; agentId: string; amountMicros: number },
): Promise<{ ok: true } | { ok: false; code: 'BUDGET_EXCEEDED'; scope: string }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async ({ tx, orgId }) => {
    const budgets = await tx.budget.findMany({
      where: { orgId, OR: [{ scopeType: 'org' }, { scopeType: 'agent', scopeId: input.agentId }] },
    });
    for (const b of budgets) {
      const d = canReserve(b, input.amountMicros);
      if (!d.ok) return { ok: false as const, code: d.code, scope: `${b.scopeType}:${b.scopeId}` };
    }
    for (const b of budgets) {
      await tx.budget.update({
        where: { id: b.id },
        data: { reservedMicros: { increment: input.amountMicros } },
      });
    }
    return { ok: true as const };
  });
  return result;
}

export interface LlmCallRecord {
  orgId: string;
  runId: string;
  agentId: string;
  step: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** null si le modèle n'est pas tarifé : le coût n'est pas inventé. */
  costMicros: number | null;
  reservedMicros: number;
  pricingVersion: string;
  stopReason: string;
  correlationId: string;
  now?: Date;
}

/**
 * Enregistre un appel LLM (idempotent par run+étape), libère la réserve, impute le coût réel
 * aux budgets et au run, et émet `budget.threshold_reached` au franchissement du seuil.
 */
export async function recordLlmCall(db: Db, r: LlmCallRecord): Promise<{ recorded: boolean }> {
  const now = r.now ?? new Date();
  const { result } = await withOrgTx(db, r.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const existing = await tx.llmUsage.findUnique({
      where: { agentRunId_step: { agentRunId: r.runId, step: r.step } },
    });
    if (existing) return { recorded: false };
    const cost = r.costMicros ?? 0;
    await tx.llmUsage.create({
      data: {
        id: randomUUID(),
        orgId,
        agentRunId: r.runId,
        agentId: r.agentId,
        step: r.step,
        provider: r.provider,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        costMicros: r.costMicros,
        measuredOrEstimated: 'estimated',
        pricingVersion: r.pricingVersion,
        stopReason: r.stopReason,
        createdAt: now,
      },
    });
    await tx.agentRun.update({
      where: { id: r.runId },
      data: {
        llmCalls: { increment: 1 },
        inputTokens: { increment: r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens },
        outputTokens: { increment: r.outputTokens },
        costMicros: { increment: cost },
        costSource: 'estimated',
        model: r.model,
      },
    });
    const budgets = await tx.budget.findMany({
      where: { orgId, OR: [{ scopeType: 'org' }, { scopeType: 'agent', scopeId: r.agentId }] },
    });
    for (const b of budgets) {
      const after = b.usedMicros + cost;
      await tx.budget.update({
        where: { id: b.id },
        data: {
          usedMicros: after,
          reservedMicros: Math.max(0, b.reservedMicros - r.reservedMicros),
          ...(crossesThreshold(b.usedMicros, after, b.limitMicros, b.alertThreshold)
            ? { alertedAt: now }
            : {}),
        },
      });
      if (crossesThreshold(b.usedMicros, after, b.limitMicros, b.alertThreshold)) {
        ctx.emit({
          type: 'budget.threshold_reached',
          classification: 'internal',
          aggregateType: 'budget',
          aggregateId: b.id,
          aggregateVersion: 1,
          correlationId: r.correlationId,
          causationId: null,
          actor: { kind: 'system', id: 'budget-guard' },
          provenance: ctx.mode,
          payload: {
            budgetId: b.id,
            scopeType: b.scopeType === 'agent' ? 'agent' : 'org',
            scopeId: b.scopeId,
            percent: usagePercent(after, b.limitMicros),
            usedMicros: after,
            limitMicros: b.limitMicros,
            hardStop: b.hardStop,
          },
        });
      }
    }
    return { recorded: true };
  });
  return result;
}

/** Libère une réserve non consommée (appel modèle en échec). */
export async function releaseBudget(
  db: Db,
  input: { orgId: string; agentId: string; amountMicros: number },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async ({ tx, orgId }) => {
    const budgets = await tx.budget.findMany({
      where: { orgId, OR: [{ scopeType: 'org' }, { scopeType: 'agent', scopeId: input.agentId }] },
    });
    for (const b of budgets) {
      await tx.budget.update({
        where: { id: b.id },
        data: { reservedMicros: Math.max(0, b.reservedMicros - input.amountMicros) },
      });
    }
  });
}

/** Kill switch d'organisation (docs/04 §10) : coupe les nouvelles exécutions et invocations. */
export async function setSystemPaused(
  db: Db,
  input: {
    orgId: string;
    paused: boolean;
    reason: string;
    actor: { kind: 'user' | 'system'; id: string };
  },
): Promise<{ changed: boolean }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const org = await ctx.tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    if (org.killSwitch === input.paused) return { changed: false };
    await ctx.tx.organization.update({
      where: { id: ctx.orgId },
      data: { killSwitch: input.paused },
    });
    const common = {
      classification: 'internal' as const,
      aggregateType: 'organization',
      aggregateId: ctx.orgId,
      aggregateVersion: 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: input.actor,
      provenance: ctx.mode,
    };
    if (input.paused)
      ctx.emit({ ...common, type: 'system.paused', payload: { reason: input.reason } });
    else ctx.emit({ ...common, type: 'system.resumed', payload: { reason: input.reason } });
    return { changed: true };
  });
  return result;
}
