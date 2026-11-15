import type { AgentRole, Provenance } from '@company-os/contracts';
import { HQ_MAP } from '@company-os/world';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';

export interface CreateAgentInput {
  orgId: string;
  id: string;
  name: string;
  title: string;
  role: AgentRole;
  departmentId: string;
  managerId: string | null;
  avatarId: string;
  deskAnchor: string;
  grants: Record<string, string[]>;
  createdBy: { kind: 'user' | 'system'; id: string };
  provenance: Provenance;
  activate: boolean;
  now?: Date;
}

/**
 * Crée un agent (draft) avec ses autorisations explicites, puis l'active si demandé.
 * Émet agent.created (+ agent.activated). Un poste ne peut être attribué qu'une fois.
 * En M1 seul le seed l'utilise ; le flux RH -> approbation admin arrive en M3.
 */
export async function createAgent(db: Db, input: CreateAgentInput): Promise<{ created: boolean }> {
  const now = input.now ?? new Date();
  const anchor = HQ_MAP.anchors[input.deskAnchor];
  if (!anchor || anchor.kind !== 'desk' || anchor.roomId !== input.departmentId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      `Poste ${input.deskAnchor} invalide pour ${input.departmentId}`,
    );
  }
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    if (await tx.agent.findUnique({ where: { id: input.id } })) return { created: false };
    await tx.agent.create({
      data: {
        id: input.id,
        orgId,
        name: input.name,
        title: input.title,
        role: input.role,
        departmentId: input.departmentId,
        managerId: input.managerId,
        avatarId: input.avatarId,
        deskAnchor: input.deskAnchor,
        status: input.activate ? 'active' : 'draft',
        provenance: input.provenance,
        createdBy: `${input.createdBy.kind}:${input.createdBy.id}`,
        createdAt: now,
        grants: {
          create: Object.entries(input.grants).map(([toolId, actions]) => ({
            toolId,
            actions,
            grantedBy: `${input.createdBy.kind}:${input.createdBy.id}`,
          })),
        },
      },
    });
    const common = {
      classification: 'internal',
      aggregateType: 'agent',
      aggregateId: input.id,
      correlationId: crypto.randomUUID(),
      actor: input.createdBy,
      provenance: input.provenance,
    } as const;
    const created = ctx.emit({
      ...common,
      type: 'agent.created',
      aggregateVersion: 1,
      causationId: null,
      payload: {
        agentId: input.id,
        name: input.name,
        title: input.title,
        role: input.role,
        departmentId: input.departmentId,
        managerId: input.managerId,
        avatarId: input.avatarId,
        deskAnchor: input.deskAnchor,
      },
    });
    if (input.activate) {
      ctx.emit({
        ...common,
        type: 'agent.activated',
        aggregateVersion: 2,
        causationId: created,
        payload: { agentId: input.id, assignedAnchor: input.deskAnchor },
      });
    }
    return { created: true };
  });
  return result;
}

/** Vérifie l'autorisation explicite agent -> outil -> action (à chaque invocation). */
export async function hasGrant(
  db: Db,
  agentId: string,
  toolId: string,
  action: string,
): Promise<boolean> {
  const g = await db.agentToolGrant.findUnique({ where: { agentId_toolId: { agentId, toolId } } });
  return g?.actions.includes(action) ?? false;
}
