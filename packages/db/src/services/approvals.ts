import { randomUUID } from 'node:crypto';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import { anchorsOfKind, HQ_MAP } from '@company-os/world';
import type { ApprovalView } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { approvalView } from '../views';
import { createAgentInTx } from './agents';

const base = { classification: 'internal' } as const;
const DEFAULT_DEADLINE_MS = 30 * 60_000;
type Preview = Record<string, string | number | boolean | string[]>;

/** Autorisations par défaut proposées pour un nouvel agent (minimales, lecture/brouillon). */
const DEFAULT_GRANTS: Record<string, Record<string, string[]>> = {
  operations: { docs: ['draft_doc'], email: ['draft_email'] },
  sales: { crm: ['lookup_lead'], email: ['draft_email'] },
  marketing: { docs: ['draft_doc'], search: ['search'] },
  finance: { analytics: ['query_metrics'] },
  rh: { ats: ['list_candidates'] },
  direction: { analytics: ['query_metrics'] },
};
const NAME_POOL = ['Alix', 'Jules', 'Sacha', 'Maëlle', 'Noé', 'Zoé', 'Ilyes', 'Lou'];

/** Met une invocation d'outil externe en attente de validation humaine (docs/05 §5). */
export async function requestInvocationApproval(
  db: Db,
  input: {
    orgId: string;
    invocationId: string;
    riskReason: string;
    safePreview: Preview;
    causationId: string | null;
    now?: Date;
  },
): Promise<{ approval: ApprovalView; eventId: string | null }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const existing = await tx.approvalRequest.findUnique({
      where: { invocationId: input.invocationId },
    });
    if (existing) return { approval: approvalView(existing), eventId: null };
    const inv = await tx.toolInvocation.findFirst({ where: { id: input.invocationId, orgId } });
    if (!inv) throw new DomainError('NOT_FOUND', 'Invocation introuvable');
    if (inv.status !== 'requested' && inv.status !== 'authorized') {
      throw new DomainError('CONFLICT', `Invocation ${inv.status} : validation impossible`);
    }
    await tx.toolInvocation.update({ where: { id: inv.id }, data: { status: 'waiting_approval' } });
    await tx.agent.update({ where: { id: inv.agentId }, data: { activity: 'waiting_approval' } });
    const row = await tx.approvalRequest.create({
      data: {
        id: randomUUID(),
        orgId,
        kind: 'tool_action',
        agentId: inv.agentId,
        taskId: inv.taskId,
        invocationId: inv.id,
        toolId: inv.toolId,
        action: inv.action,
        riskReason: input.riskReason,
        safePreview: input.safePreview,
        payload: {},
        idempotencyKey: `inv:${inv.id}`,
        requestedAt: now,
        deadlineAt: new Date(now.getTime() + DEFAULT_DEADLINE_MS),
      },
    });
    const eventId = emitRequested(ctx, row, inv.correlationId, input.causationId);
    return { approval: approvalView(row), eventId };
  });
  return result;
}

export interface HireProposal {
  departmentId: string;
  title: string;
  justification: string;
}

/** Les RH proposent un agent : rien n'est créé avant la décision d'un admin humain. */
export async function proposeAgentHire(
  db: Db,
  input: {
    orgId: string;
    requesterAgentId: string;
    taskId: string | null;
    proposal: HireProposal;
    idempotencyKey: string;
    correlationId: string;
    causationId: string | null;
    now?: Date;
  },
): Promise<{ approval: ApprovalView }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const prior = await tx.approvalRequest.findUnique({
      where: { orgId_idempotencyKey: { orgId, idempotencyKey: input.idempotencyKey } },
    });
    if (prior) return { approval: approvalView(prior) };
    const dept = await tx.department.findFirst({
      where: { orgId, roomId: input.proposal.departmentId },
    });
    if (!dept)
      throw new DomainError(
        'VALIDATION_ERROR',
        `Département ${input.proposal.departmentId} inconnu`,
      );
    const count = await tx.agent.count({ where: { orgId } });
    const pending = await tx.approvalRequest.count({ where: { orgId, kind: 'agent_hire' } });
    const n = count + pending + 1;
    const name = NAME_POOL[(n - 1) % NAME_POOL.length] ?? 'Agent';
    const grants = DEFAULT_GRANTS[dept.roomId] ?? {};
    const payload = {
      agentId: `${dept.roomId}-${String(n).padStart(2, '0')}`,
      name,
      title: input.proposal.title.slice(0, 60),
      role: 'specialist',
      departmentId: dept.id,
      roomId: dept.roomId,
      managerId: dept.managerAgentId,
      avatarId: `avatar-0${(n % 8) + 1}`,
      grants,
      budgetMicros: 2_000_000,
    };
    const row = await tx.approvalRequest.create({
      data: {
        id: randomUUID(),
        orgId,
        kind: 'agent_hire',
        agentId: input.requesterAgentId,
        taskId: input.taskId,
        riskReason: `Création d'une identité d'agent active et attribution de droits : décision humaine obligatoire. Motif : ${input.proposal.justification.slice(0, 160)}`,
        safePreview: {
          name,
          title: payload.title,
          department: dept.name,
          manager: dept.managerAgentId ?? '—',
          tools: Object.entries(grants).map(([t, a]) => `${t}:${a.join('+')}`),
          monthlyBudgetUsd: 2,
        },
        payload,
        idempotencyKey: input.idempotencyKey,
        requestedAt: now,
        deadlineAt: new Date(now.getTime() + 24 * 3600_000),
      },
    });
    emitRequested(ctx, row, input.correlationId, input.causationId);
    return { approval: approvalView(row) };
  });
  return result;
}

function emitRequested(
  ctx: OrgTxContext,
  row: {
    id: string;
    kind: string;
    agentId: string;
    taskId: string | null;
    invocationId: string | null;
    toolId: string | null;
    action: string | null;
    riskReason: string;
    safePreview: unknown;
    deadlineAt: Date;
  },
  correlationId: string,
  causationId: string | null,
): string {
  return ctx.emit({
    ...base,
    type: 'approval.requested',
    aggregateType: 'approval',
    aggregateId: row.id,
    aggregateVersion: 1,
    correlationId,
    causationId,
    actor: { kind: 'agent', id: row.agentId },
    provenance: ctx.mode,
    payload: {
      approvalId: row.id,
      kind: row.kind === 'agent_hire' ? 'agent_hire' : 'tool_action',
      agentId: row.agentId,
      taskId: row.taskId,
      invocationId: row.invocationId,
      toolId: row.toolId,
      action: row.action,
      riskReason: row.riskReason.slice(0, 280),
      safePreview: row.safePreview as Preview,
      deadlineAt: row.deadlineAt.toISOString(),
    },
  });
}

export type Decision = 'approved' | 'rejected' | 'expired';

/**
 * Décision humaine (ou expiration système). Terminale et idempotente : une seconde décision
 * identique ne fait rien (double-clic), une décision contraire est refusée (CONFLICT).
 * - tool_action refusée : l'invocation passe `rejected` (jamais exécutée) ;
 * - agent_hire approuvée : création de l'agent, droits explicites, poste libre, activation.
 */
export async function decideApproval(
  db: Db,
  input: {
    orgId: string;
    approvalId: string;
    decision: Decision;
    reviewer: { kind: 'user' | 'system'; id: string };
    reason: string;
    now?: Date;
  },
): Promise<{ approval: ApprovalView; changed: boolean; workflowId: string | null }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const a = await tx.approvalRequest.findFirst({ where: { id: input.approvalId, orgId } });
    if (!a) throw new DomainError('NOT_FOUND', 'Demande de validation introuvable');
    const workflowId = a.invocationId
      ? ((
          await tx.toolInvocation.findUnique({
            where: { id: a.invocationId },
            include: { agentRun: true },
          })
        )?.agentRun.workflowId ?? null)
      : null;
    if (a.status !== 'pending') {
      if (a.status === input.decision)
        return { approval: approvalView(a), changed: false, workflowId };
      throw new DomainError('CONFLICT', `Déjà décidée (${a.status})`);
    }
    if (input.decision !== 'expired' && input.reviewer.kind !== 'user') {
      throw new DomainError('FORBIDDEN', 'Seul un humain habilité peut décider');
    }
    if (input.decision !== 'expired' && now > a.deadlineAt) {
      throw new DomainError('CONFLICT', 'Demande expirée');
    }
    const updated = await tx.approvalRequest.update({
      where: { id: a.id },
      data: {
        status: input.decision,
        reviewedBy: input.reviewer.id,
        reviewedAt: now,
        decisionReason: input.reason.slice(0, 280),
        version: { increment: 1 },
      },
    });
    const correlationId =
      (a.taskId ? (await tx.task.findUnique({ where: { id: a.taskId } }))?.correlationId : null) ??
      randomUUID();
    const decided = ctx.emit({
      ...base,
      type: 'approval.decided',
      aggregateType: 'approval',
      aggregateId: a.id,
      aggregateVersion: 2,
      correlationId,
      causationId: null,
      actor: input.reviewer,
      provenance: ctx.mode,
      payload: {
        approvalId: a.id,
        decision: input.decision,
        reviewerId: input.reviewer.id,
        reason: input.reason.slice(0, 280),
      },
    });

    if (a.kind === 'tool_action' && a.invocationId) {
      await tx.agent.updateMany({
        where: { id: a.agentId, activity: 'waiting_approval' },
        data: { activity: 'working' },
      });
      if (input.decision !== 'approved') {
        const inv = await tx.toolInvocation.update({
          where: { id: a.invocationId },
          data: {
            status: 'rejected',
            endedAt: now,
            errorCode: input.decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED',
          },
        });
        ctx.emit({
          ...base,
          type: 'tool.invocation.rejected',
          aggregateType: 'tool_invocation',
          aggregateId: inv.id,
          aggregateVersion: 3,
          correlationId: inv.correlationId,
          causationId: decided,
          actor: { kind: 'system', id: 'tool-gateway' },
          provenance: inv.provenance,
          payload: {
            invocationId: inv.id,
            toolId: inv.toolId,
            agentId: inv.agentId,
            taskId: inv.taskId,
            reasonCode: input.decision === 'expired' ? 'APPROVAL_EXPIRED' : 'APPROVAL_REJECTED',
          },
        });
      }
    }

    if (a.kind === 'agent_hire' && input.decision === 'approved') {
      await hireFromProposal(
        ctx,
        a.payload as unknown as HirePayload,
        input.reviewer,
        decided,
        correlationId,
      );
    }
    return { approval: approvalView(updated), changed: true, workflowId };
  });
  return result;
}

interface HirePayload {
  agentId: string;
  name: string;
  title: string;
  role: 'specialist';
  departmentId: string;
  roomId: string;
  managerId: string | null;
  avatarId: string;
  grants: Record<string, string[]>;
  budgetMicros: number;
}

async function hireFromProposal(
  ctx: OrgTxContext,
  p: HirePayload,
  reviewer: { kind: 'user' | 'system'; id: string },
  causationId: string,
  correlationId: string,
): Promise<void> {
  const { tx, orgId } = ctx;
  // Poste libre du département (contrainte unique org+poste), sinon salle d'attente.
  const taken = new Set(
    (await tx.agent.findMany({ where: { orgId }, select: { deskAnchor: true } })).map(
      (a) => a.deskAnchor,
    ),
  );
  const desk =
    anchorsOfKind(HQ_MAP, 'desk', p.roomId).find((d) => !taken.has(d.id)) ??
    anchorsOfKind(HQ_MAP, 'waiting').find((d) => !taken.has(d.id));
  if (!desk) throw new DomainError('CONFLICT', 'Aucun poste ni place d’attente disponible');
  const r = await createAgentInTx(ctx, {
    id: p.agentId,
    name: p.name,
    title: p.title,
    role: p.role,
    departmentId: p.departmentId,
    managerId: p.managerId,
    avatarId: p.avatarId,
    deskAnchor: desk.id,
    grants: p.grants,
    createdBy: reviewer, // l'approbateur humain, jamais l'agent RH
    provenance: ctx.mode,
    activate: true,
    causationId,
    correlationId,
    initialVersion: {
      promptVersion: PROMPT_VERSION,
      instructions: instructionsFor(p.roomId, p.role),
      goal: `${p.title} — ${p.roomId}`,
      modelPolicy: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 8000 },
      limits: { maxSteps: 8, maxDurationMs: 5 * 60_000, maxCostMicros: 500_000 },
    },
  });
  if (!r.created) throw new DomainError('CONFLICT', `L'agent ${p.agentId} existe déjà`);
  await tx.budget.create({
    data: {
      id: randomUUID(),
      orgId,
      scopeType: 'agent',
      scopeId: p.agentId,
      limitMicros: p.budgetMicros,
      hardStop: true,
      alertThreshold: 0.8,
    },
  });
}

export async function getApprovalStatus(db: Db, approvalId: string): Promise<string> {
  const a = await db.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!a) throw new DomainError('NOT_FOUND', 'Demande introuvable');
  return a.status;
}

/** Expire une demande dont l'échéance est passée (appelé par le workflow). */
export async function expireApprovalIfDue(
  db: Db,
  approvalId: string,
  now = new Date(),
): Promise<string> {
  const a = await db.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!a) throw new DomainError('NOT_FOUND', 'Demande introuvable');
  if (a.status !== 'pending' || now <= a.deadlineAt) return a.status;
  const r = await decideApproval(db, {
    orgId: a.orgId,
    approvalId,
    decision: 'expired',
    reviewer: { kind: 'system', id: 'approval-timeout' },
    reason: 'Échéance dépassée sans décision',
    now,
  });
  return r.approval.status;
}
