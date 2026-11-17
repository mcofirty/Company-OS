import { CreateAgentRequestSchema, choiceOfPolicy } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { createAgentByAdmin } from './live';

const DAY = 86_400_000;

export interface AgentInsights {
  /** Missions terminées sur 7 jours glissants (réussies / bloquées ou échouées). */
  last7d: { succeeded: number; blocked: number };
  /** Durée moyenne des 20 dernières missions réussies (ms), ou null. */
  avgDurationMs: number | null;
  /** Exécution en cours : étapes réalisées sur le plafond de la version active. */
  run: {
    steps: number;
    maxSteps: number;
    startedAt: string;
    /** Modèle retenu et pourquoi (optimisation automatique ou niveau fixé). */
    model: string | null;
    modelReason: string | null;
  } | null;
  /** Collègues avec qui l'agent travaille le plus (délégations, réunions), 60 jours. */
  collaborators: { agentId: string; count: number }[];
  /** Dernier livrable enregistré par l'agent. */
  lastDocument: { id: string; title: string; createdAt: string } | null;
}

/** Indicateurs réels d'un agent, calculés depuis la base (aucune estimation). */
export async function agentInsights(
  db: Db,
  orgId: string,
  agentId: string,
  now = new Date(),
): Promise<AgentInsights> {
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since60 = new Date(now.getTime() - 60 * DAY);
  const agent = await db.agent.findFirst({ where: { id: agentId, orgId } });
  if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
  const [ended, done, run, version, doc, mine, meetings] = await Promise.all([
    db.task.groupBy({
      by: ['status'],
      where: {
        orgId,
        agentId,
        endedAt: { gte: since7 },
        status: { in: ['succeeded', 'blocked', 'failed'] },
      },
      _count: { _all: true },
    }),
    db.task.findMany({
      where: {
        orgId,
        agentId,
        status: 'succeeded',
        startedAt: { not: null },
        endedAt: { not: null },
      },
      orderBy: { endedAt: 'desc' },
      take: 20,
      select: { startedAt: true, endedAt: true },
    }),
    agent.currentTaskId
      ? db.agentRun.findFirst({
          where: { orgId, agentId, taskId: agent.currentTaskId, status: 'running' },
          orderBy: { startedAt: 'desc' },
        })
      : null,
    db.agentVersion.findFirst({ where: { agentId, version: agent.activeVersion } }),
    db.document.findFirst({
      where: { orgId, agentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, createdAt: true },
    }),
    db.task.findMany({
      where: { orgId, agentId, createdAt: { gte: since60 } },
      select: { id: true, parentTaskId: true },
      take: 500,
    }),
    db.meetingParticipant.findMany({
      where: { agentId, joinedAt: { gte: since60 }, meeting: { orgId } },
      select: { meeting: { select: { participants: { select: { agentId: true } } } } },
      take: 100,
    }),
  ]);
  const count = (s: string): number => ended.find((g) => g.status === s)?._count._all ?? 0;
  const durations = done
    .map((t) => (t.endedAt && t.startedAt ? t.endedAt.getTime() - t.startedAt.getTime() : 0))
    .filter((d) => d > 0);
  const limits = (version?.limits ?? {}) as { maxSteps?: number };
  // Collaborations : qui lui délègue, à qui il délègue, avec qui il se réunit.
  const score = new Map<string, number>();
  const bump = (id: string | null | undefined): void => {
    if (id && id !== agentId) score.set(id, (score.get(id) ?? 0) + 1);
  };
  const parentIds = mine.map((t) => t.parentTaskId).filter((x): x is string => !!x);
  const [parents, children] = await Promise.all([
    parentIds.length
      ? db.task.findMany({ where: { orgId, id: { in: parentIds } }, select: { agentId: true } })
      : [],
    mine.length
      ? db.task.findMany({
          where: { orgId, parentTaskId: { in: mine.map((t) => t.id) } },
          select: { agentId: true },
          take: 500,
        })
      : [],
  ]);
  parents.forEach((t) => bump(t.agentId));
  children.forEach((t) => bump(t.agentId));
  meetings.forEach((m) => m.meeting.participants.forEach((x) => bump(x.agentId)));
  const alive = new Set(
    (
      await db.agent.findMany({
        where: { orgId, id: { in: [...score.keys()] }, deletedAt: null },
        select: { id: true },
      })
    ).map((a) => a.id),
  );
  return {
    last7d: { succeeded: count('succeeded'), blocked: count('blocked') + count('failed') },
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    run: run
      ? {
          steps: run.stepCount,
          maxSteps: Math.max(1, limits.maxSteps ?? 8),
          startedAt: run.startedAt.toISOString(),
          model: run.model,
          modelReason: run.modelReason,
        }
      : null,
    collaborators: [...score.entries()]
      .filter(([id]) => alive.has(id))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([id, n]) => ({ agentId: id, count: n })),
    lastDocument: doc ? { ...doc, createdAt: doc.createdAt.toISOString() } : null,
  };
}

const ADMIN_MARK = 'Consignes de l’administrateur :\n';

/**
 * Duplique un agent (organisation live, administrateur) : même pôle, rôle, droits, objectif,
 * consignes, modèle, budget et fiche ; nouveau nom « … 2 » et poste libre. Passe par la création
 * standard (validation des droits, budget à plafond dur, événements).
 */
export async function duplicateAgent(
  db: Db,
  input: {
    orgId: string;
    actor: { kind: 'user'; id: string };
    agentId: string;
    idempotencyKey?: string;
  },
): Promise<{ agentId: string; created: boolean }> {
  const src = await db.agent.findFirst({
    where: { id: input.agentId, orgId: input.orgId, deletedAt: null },
    include: { grants: true },
  });
  if (!src) throw new DomainError('NOT_FOUND', 'Agent introuvable');
  const [version, budget] = await Promise.all([
    db.agentVersion.findFirst({ where: { agentId: src.id, version: src.activeVersion } }),
    db.budget.findFirst({ where: { orgId: input.orgId, scopeType: 'agent', scopeId: src.id } }),
  ]);
  const raw = version?.instructions ?? '';
  const i = raw.indexOf(ADMIN_MARK);
  const own = (i >= 0 ? raw.slice(i + ADMIN_MARK.length) : raw).trim();
  const req = CreateAgentRequestSchema.parse({
    name: `${src.name.slice(0, 37)} 2`,
    title: src.title,
    departmentId: src.departmentId,
    role: src.role === 'manager' ? 'manager' : 'specialist',
    grants: Object.fromEntries(src.grants.map((g) => [g.toolId, g.actions])),
    goal: (version?.goal ?? `Assister le pôle comme ${src.name}`).slice(0, 300).padEnd(5, '.'),
    instructions: (own.length >= 20
      ? own
      : `${own} Même rôle et mêmes consignes que ${src.name}.`
    ).slice(0, 4000),
    monthlyBudgetUsd: Math.min(500, Math.max(0.5, budget ? budget.limitMicros / 1e6 : 5)),
    modelTier: choiceOfPolicy(version?.modelPolicy as { model?: string; auto?: boolean } | null),
    avatarId: /^avatar-\d{2}$/.test(src.avatarId) ? src.avatarId : 'avatar-01',
    skills: src.skills,
    routines: src.routines,
  });
  return createAgentByAdmin(db, {
    orgId: input.orgId,
    actor: input.actor,
    req,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });
}
