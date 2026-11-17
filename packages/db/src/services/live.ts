import { randomUUID } from 'node:crypto';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import {
  policyForChoice,
  TOOL_CATALOG,
  toolAvailableIn,
  type CreateAgentRequest,
} from '@company-os/contracts';
import { anchorsOfKind, HQ_MAP } from '@company-os/world';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';
import { DEMO_DEPARTMENTS } from '../seed-data';
import { ensureCatalogTools } from '../seed';
import { createAgentInTx } from './agents';
import { isConnectorToolId, validateConnectorGrants } from './connectors';

/** Modèle par défaut des agents live (tarif présent dans config/llm-pricing.json). */
export const LIVE_DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Crée une organisation LIVE (séparée de la démo) : départements calqués sur les pièces du plan,
 * budget mensuel à plafond dur, administrateurs explicites. Aucun agent : un humain les crée.
 */
export async function initLiveOrg(
  db: Db,
  input: { name: string; adminUserIds: string[]; monthlyBudgetUsd: number },
): Promise<{ orgId: string; created: boolean }> {
  const existing = await db.organization.findFirst({ where: { name: input.name, mode: 'live' } });
  if (existing) {
    for (const userId of input.adminUserIds) {
      await db.membership.upsert({
        where: { orgId_userId: { orgId: existing.id, userId } },
        create: { orgId: existing.id, userId, role: 'admin' },
        update: {},
      });
    }
    return { orgId: existing.id, created: false };
  }
  await ensureCatalogTools(db, { liveOnly: true });
  const orgId = randomUUID();
  const prefix = orgId.slice(0, 8);
  await db.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: orgId, name: input.name, mode: 'live' } });
    for (const d of DEMO_DEPARTMENTS) {
      // Identifiants de département globaux : préfixés par l'org ; le lien au plan passe par roomId.
      await tx.department.create({
        data: {
          id: `${prefix}-${d.id}`,
          orgId,
          name: d.name,
          color: d.color,
          roomId: d.id,
          capacity: d.capacity,
        },
      });
    }
    await tx.budget.create({
      data: {
        id: randomUUID(),
        orgId,
        scopeType: 'org',
        scopeId: orgId,
        limitMicros: Math.round(input.monthlyBudgetUsd * 1_000_000),
        hardStop: true,
        alertThreshold: 0.8,
      },
    });
    for (const userId of input.adminUserIds) {
      await tx.membership.create({ data: { orgId, userId, role: 'admin' } });
    }
  });
  return { orgId, created: true };
}

/** Droits demandés validés contre le catalogue : `high_impact` et actions de plateforme refusés. */
export function validateGrants(
  grants: Record<string, string[]>,
  opts: { allowDemoTools?: boolean; role?: string } = {},
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [toolId, actions] of Object.entries(grants)) {
    const tool = TOOL_CATALOG.find((t) => t.id === toolId);
    if (!tool) throw new DomainError('VALIDATION_ERROR', `Outil inconnu : ${toolId}`);
    // Organisation live : uniquement des outils réels (aucune donnée fictive).
    if (!toolAvailableIn(tool, 'live', opts.allowDemoTools)) {
      throw new DomainError(
        'POLICY_DENIED',
        `${tool.name} : outil de démonstration (données fictives), indisponible en LIVE`,
      );
    }
    if (toolId === 'team' && opts.role !== 'manager') {
      throw new DomainError('POLICY_DENIED', 'Outil Équipe réservé aux agents managers');
    }
    if (toolId === 'platform') {
      throw new DomainError(
        'POLICY_DENIED',
        'Actions de plateforme (recruter, réunir, déléguer) non attribuables ici',
      );
    }
    for (const a of actions) {
      const spec = tool.actions.find((x) => x.action === a);
      if (!spec) throw new DomainError('VALIDATION_ERROR', `Action inconnue : ${toolId}.${a}`);
      if (spec.risk === 'high_impact') {
        throw new DomainError('POLICY_DENIED', `${toolId}.${a} : action à fort impact interdite`);
      }
    }
    if (actions.length > 0) out[toolId] = [...new Set(actions)];
  }
  return out;
}

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'agent';

/**
 * Création d'un agent par un administrateur humain (organisation live) : décision humaine directe,
 * droits exactement ceux listés, budget à plafond dur, poste libre du département (sinon salle
 * d'attente). Les consignes de l'humain s'ajoutent aux règles de la plateforme, sans les remplacer.
 */
export async function createAgentByAdmin(
  db: Db,
  input: {
    orgId: string;
    actor: { kind: 'user'; id: string };
    req: CreateAgentRequest;
    idempotencyKey?: string;
  },
): Promise<{ agentId: string; created: boolean }> {
  const { req } = input;
  const agentId = `${slug(req.name)}-${randomUUID().slice(0, 6)}`;
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const { tx, orgId, now } = ctx;
    if (input.idempotencyKey) {
      const prior = await tx.idempotencyKey.findUnique({
        where: {
          orgId_key_operation: { orgId, key: input.idempotencyKey, operation: 'create_agent' },
        },
      });
      // Double clic / nouvel essai réseau : même réponse, aucun second agent.
      if (prior) return { agentId: prior.responseRef, created: false };
    }
    if (ctx.mode !== 'live') {
      throw new DomainError(
        'POLICY_DENIED',
        'Organisation démo : agents fixes (seed) ou recrutés via validation',
      );
    }
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
    const pick = (connector: boolean) =>
      Object.fromEntries(
        Object.entries(req.grants).filter(([id]) => isConnectorToolId(id) === connector),
      );
    const grants = {
      ...validateGrants(pick(false), { allowDemoTools: org.allowDemoTools, role: req.role }),
      // Outils de connecteurs MCP de CETTE organisation (actifs, non désactivés).
      ...(await validateConnectorGrants(tx, orgId, pick(true))),
    };
    const dept = await tx.department.findFirst({ where: { id: req.departmentId, orgId } });
    if (!dept) throw new DomainError('NOT_FOUND', 'Département introuvable');
    const taken = new Set(
      (await tx.agent.findMany({ where: { orgId }, select: { deskAnchor: true } })).map(
        (a) => a.deskAnchor,
      ),
    );
    // Postes utilisables : la capacité du pôle, dans la limite des postes de la zone.
    const desk =
      anchorsOfKind(HQ_MAP, 'desk', dept.roomId)
        .slice(0, dept.capacity)
        .find((d) => !taken.has(d.id)) ??
      anchorsOfKind(HQ_MAP, 'waiting').find((d) => !taken.has(d.id));
    if (!desk) throw new DomainError('CONFLICT', 'Aucun poste ni place d’attente disponible');
    const role = req.role;
    await createAgentInTx(ctx, {
      id: agentId,
      name: req.name,
      title: req.title,
      role,
      departmentId: dept.id,
      managerId: null,
      avatarId: req.avatarId,
      deskAnchor: desk.id,
      grants,
      createdBy: input.actor,
      provenance: 'live',
      activate: true,
      causationId: null,
      correlationId: randomUUID(),
      initialVersion: {
        promptVersion: PROMPT_VERSION,
        instructions: `${instructionsFor(dept.roomId, role)}\n\nConsignes de l’administrateur :\n${req.instructions}`,
        goal: req.goal,
        modelPolicy: { ...policyForChoice(req.modelTier), maxTokens: 8000 },
        limits: { maxSteps: 8, maxDurationMs: 5 * 60_000, maxCostMicros: 500_000 },
      },
    });
    // Fiche (affichage) : compétences et tâches habituelles saisies par l'administrateur.
    await tx.agent.update({
      where: { id: agentId },
      data: { skills: req.skills, routines: req.routines },
    });
    await tx.budget.create({
      data: {
        id: randomUUID(),
        orgId,
        scopeType: 'agent',
        scopeId: agentId,
        limitMicros: Math.round(req.monthlyBudgetUsd * 1_000_000),
        hardStop: true,
        alertThreshold: 0.8,
      },
    });
    if (input.idempotencyKey) {
      await tx.idempotencyKey.create({
        data: {
          orgId,
          key: input.idempotencyKey,
          operation: 'create_agent',
          responseRef: agentId,
          expiresAt: new Date(now.getTime() + 24 * 3600_000),
        },
      });
    }
    return { agentId, created: true };
  });
  return result;
}

/**
 * Organisations accessibles à un utilisateur (sélecteur du cockpit). `hideDemo` : sur un
 * serveur de production, les organisations de démonstration n'apparaissent pas.
 */
export async function orgsOfUser(db: Db, userId: string, opts: { hideDemo?: boolean } = {}) {
  const rows = await db.membership.findMany({
    where: { userId, ...(opts.hideDemo ? { org: { mode: 'live' as const } } : {}) },
    include: { org: true },
    orderBy: { org: { createdAt: 'asc' } },
  });
  return rows.map((m) => ({ id: m.org.id, name: m.org.name, mode: m.org.mode, role: m.role }));
}
