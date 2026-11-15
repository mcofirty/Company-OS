import { randomUUID } from 'node:crypto';
import {
  canTransitionInvocation,
  toolAction,
  type InvocationStatus,
  type InvocationView,
} from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { invocationView } from '../views';

const base = { classification: 'internal' } as const;
type Json = Record<string, string | number | boolean | null>;

export interface RequestInvocationInput {
  orgId: string;
  runId: string;
  toolId: string;
  action: string;
  /** Entrée déjà redigée (jamais de secret ni de PII complète). */
  redactedInput: Json;
  idempotencyKey: string;
  causationId: string | null;
  now?: Date;
}

/** tool.invocation.requested (idempotent par clé logique). */
export async function requestInvocation(
  db: Db,
  input: RequestInvocationInput,
): Promise<{ invocation: InvocationView; eventId: string | null; existing: boolean }> {
  const now = input.now ?? new Date();
  const spec = toolAction(input.toolId, input.action);
  if (!spec)
    throw new DomainError('VALIDATION_ERROR', `Action inconnue ${input.toolId}.${input.action}`);
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const prior = await tx.toolInvocation.findUnique({
      where: { orgId_idempotencyKey: { orgId, idempotencyKey: input.idempotencyKey } },
    });
    if (prior) return { invocation: invocationView(prior), eventId: null, existing: true };
    const run = await tx.agentRun.findFirst({
      where: { id: input.runId, orgId },
      include: { task: true },
    });
    if (!run) throw new DomainError('NOT_FOUND', `Run ${input.runId} introuvable`);
    const id = randomUUID();
    const row = await tx.toolInvocation.create({
      data: {
        id,
        orgId,
        toolId: input.toolId,
        agentRunId: run.id,
        agentId: run.agentId,
        taskId: run.taskId,
        action: input.action,
        actionKind: spec.kind,
        risk: spec.risk,
        status: 'requested',
        redactedInput: input.redactedInput,
        idempotencyKey: input.idempotencyKey,
        correlationId: run.task.correlationId,
        provenance: run.provenance,
        requestedAt: now,
      },
    });
    await tx.agentRun.update({ where: { id: run.id }, data: { stepCount: { increment: 1 } } });
    const eventId = ctx.emit({
      ...base,
      type: 'tool.invocation.requested',
      aggregateType: 'tool_invocation',
      aggregateId: id,
      aggregateVersion: 1,
      correlationId: run.task.correlationId,
      causationId: input.causationId,
      actor: { kind: 'agent', id: run.agentId },
      provenance: run.provenance,
      payload: {
        invocationId: id,
        toolId: input.toolId,
        agentId: run.agentId,
        taskId: run.taskId,
        action: input.action,
        actionKind: spec.kind,
        risk: spec.risk,
      },
    });
    return { invocation: invocationView(row), eventId, existing: false };
  });
  return result;
}

async function transition(
  ctx: OrgTxContext,
  invocationId: string,
  to: InvocationStatus,
  data: Record<string, unknown>,
) {
  const inv = await ctx.tx.toolInvocation.findFirst({
    where: { id: invocationId, orgId: ctx.orgId },
  });
  if (!inv) throw new DomainError('NOT_FOUND', `Invocation ${invocationId} introuvable`);
  const from = inv.status as InvocationStatus;
  // `authorized` est un état transitoire interne : requested -> authorized -> running.
  const path: InvocationStatus[] =
    from === 'requested' && to === 'running' ? ['authorized', 'running'] : [to];
  let cur = from;
  for (const step of path) {
    if (!canTransitionInvocation(cur, step)) {
      throw new DomainError('CONFLICT', `Transition d'invocation interdite ${cur} -> ${step}`);
    }
    cur = step;
  }
  return ctx.tx.toolInvocation.update({
    where: { id: invocationId },
    data: { ...data, status: to },
  });
}

export async function rejectInvocation(
  db: Db,
  input: {
    orgId: string;
    invocationId: string;
    reasonCode: string;
    causationId: string | null;
    now?: Date;
  },
): Promise<{ invocation: InvocationView; eventId: string }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const inv = await transition(ctx, input.invocationId, 'rejected', {
      endedAt: now,
      errorCode: input.reasonCode,
    });
    const eventId = ctx.emit({
      ...base,
      type: 'tool.invocation.rejected',
      aggregateType: 'tool_invocation',
      aggregateId: inv.id,
      aggregateVersion: 2,
      correlationId: inv.correlationId,
      causationId: input.causationId,
      actor: { kind: 'system', id: 'tool-gateway' },
      provenance: inv.provenance,
      payload: {
        invocationId: inv.id,
        toolId: inv.toolId,
        agentId: inv.agentId,
        taskId: inv.taskId,
        reasonCode: input.reasonCode,
      },
    });
    return { invocation: invocationView(inv), eventId };
  });
  return result;
}

export async function startInvocation(
  db: Db,
  input: {
    orgId: string;
    invocationId: string;
    attempt: number;
    causationId: string | null;
    now?: Date;
  },
): Promise<{ invocation: InvocationView; eventId: string }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const current = await ctx.tx.toolInvocation.findFirst({
      where: { id: input.invocationId, orgId: ctx.orgId },
    });
    // Une nouvelle tentative garde l'invocation en `running` (pas de second started si déjà en cours).
    const inv =
      current?.status === 'running'
        ? await ctx.tx.toolInvocation.update({
            where: { id: input.invocationId },
            data: { attempt: input.attempt },
          })
        : await transition(ctx, input.invocationId, 'running', {
            startedAt: now,
            attempt: input.attempt,
          });
    await ctx.tx.agent.update({ where: { id: inv.agentId }, data: { activity: 'using_tool' } });
    const eventId = ctx.emit({
      ...base,
      type: 'tool.invocation.started',
      aggregateType: 'tool_invocation',
      aggregateId: inv.id,
      aggregateVersion: 2,
      correlationId: inv.correlationId,
      causationId: input.causationId,
      actor: { kind: 'agent', id: inv.agentId },
      provenance: inv.provenance,
      payload: {
        invocationId: inv.id,
        toolId: inv.toolId,
        agentId: inv.agentId,
        taskId: inv.taskId,
        action: inv.action,
        attempt: input.attempt,
      },
    });
    return { invocation: invocationView(inv), eventId };
  });
  return result;
}

export async function completeInvocation(
  db: Db,
  input: {
    orgId: string;
    invocationId: string;
    causationId: string | null;
    now?: Date;
  } & ({ ok: true; safeSummary: string } | { ok: false; errorCode: string; attempt: number }),
): Promise<{ invocation: InvocationView; eventId: string }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const before = await ctx.tx.toolInvocation.findFirst({
      where: { id: input.invocationId, orgId: ctx.orgId },
    });
    if (!before) throw new DomainError('NOT_FOUND', `Invocation ${input.invocationId} introuvable`);
    // Durée mesurée depuis les horodatages persistés, jamais depuis un minuteur UI.
    const durationMs = Math.max(
      0,
      now.getTime() - (before.startedAt ?? before.requestedAt).getTime(),
    );
    const inv = input.ok
      ? await transition(ctx, input.invocationId, 'succeeded', {
          endedAt: now,
          durationMs,
          safeSummary: input.safeSummary,
        })
      : await transition(ctx, input.invocationId, 'failed', {
          endedAt: now,
          durationMs,
          errorCode: input.errorCode,
          attempt: input.attempt,
        });
    await ctx.tx.agent.updateMany({
      where: { id: inv.agentId, activity: 'using_tool' },
      data: { activity: 'working' },
    });
    const common = {
      ...base,
      aggregateType: 'tool_invocation',
      aggregateId: inv.id,
      aggregateVersion: 3,
      correlationId: inv.correlationId,
      causationId: input.causationId,
      actor: { kind: 'tool', id: inv.toolId } as const,
      provenance: inv.provenance,
    };
    const ids = {
      invocationId: inv.id,
      toolId: inv.toolId,
      agentId: inv.agentId,
      taskId: inv.taskId,
    };
    const eventId = input.ok
      ? ctx.emit({
          ...common,
          type: 'tool.invocation.succeeded',
          payload: { ...ids, durationMs, safeSummary: input.safeSummary },
        })
      : ctx.emit({
          ...common,
          type: 'tool.invocation.failed',
          payload: { ...ids, durationMs, errorCode: input.errorCode, attempt: input.attempt },
        });
    return { invocation: invocationView(inv), eventId };
  });
  return result;
}
