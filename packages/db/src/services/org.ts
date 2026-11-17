import { randomUUID } from 'node:crypto';
import { ANNEX_ROOM_IDS, anchorsOfKind, HQ_MAP } from '@company-os/world';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { completeMeeting } from './meetings';
import { createTask } from './tasks';

/* =========================================================================
 * Pôles : l'entreprise s'agrandit (locaux de l'aile d'extension du QG)
 * ========================================================================= */

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'pole';

function emitDepartment(
  ctx: OrgTxContext,
  actorId: string,
  d: { id: string; roomId: string; name: string; color: string; capacity: number },
  change: 'created' | 'updated',
): void {
  ctx.emit({
    classification: 'internal',
    aggregateType: 'department',
    aggregateId: d.id,
    aggregateVersion: 1,
    correlationId: randomUUID(),
    causationId: null,
    actor: { kind: 'user', id: actorId },
    provenance: ctx.mode,
    type: 'department.updated',
    payload: {
      departmentId: d.id,
      roomId: d.roomId,
      name: d.name,
      color: d.color,
      capacity: d.capacity,
      change,
    },
  });
}

/** Nouveau pôle : premier local libre de l'aile d'extension (6 postes). Décision humaine. */
export async function createDepartment(
  db: Db,
  input: { orgId: string; actorId: string; name: string; color: string },
): Promise<{ departmentId: string; roomId: string }> {
  const { result } = await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const used = new Set(
      (
        await ctx.tx.department.findMany({ where: { orgId: ctx.orgId }, select: { roomId: true } })
      ).map((d) => d.roomId),
    );
    const roomId = ANNEX_ROOM_IDS.find((r) => !used.has(r));
    if (!roomId) {
      throw new DomainError('CONFLICT', 'Tous les locaux de l’aile d’extension sont occupés');
    }
    const name = input.name.trim().slice(0, 40);
    if (name.length < 2) throw new DomainError('VALIDATION_ERROR', 'Nom du pôle requis');
    const id = `${ctx.orgId.slice(0, 8)}-${slug(name)}-${randomUUID().slice(0, 4)}`;
    const capacity = anchorsOfKind(HQ_MAP, 'desk', roomId).length;
    await ctx.tx.department.create({
      data: { id, orgId: ctx.orgId, name, color: input.color, roomId, capacity },
    });
    emitDepartment(
      ctx,
      input.actorId,
      { id, roomId, name, color: input.color, capacity },
      'created',
    );
    return { departmentId: id, roomId };
  });
  return result;
}

/** Renommer / recolorer un pôle (administrateur). */
export async function updateDepartment(
  db: Db,
  input: { orgId: string; actorId: string; departmentId: string; name: string; color: string },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const d = await ctx.tx.department.findFirst({
      where: { id: input.departmentId, orgId: ctx.orgId },
    });
    if (!d) throw new DomainError('NOT_FOUND', 'Pôle introuvable');
    const name = input.name.trim().slice(0, 40);
    if (name.length < 2) throw new DomainError('VALIDATION_ERROR', 'Nom du pôle requis');
    await ctx.tx.department.update({ where: { id: d.id }, data: { name, color: input.color } });
    emitDepartment(ctx, input.actorId, { ...d, name, color: input.color }, 'updated');
  });
}

/* =========================================================================
 * Réunions convoquées par un humain
 * ========================================================================= */

/**
 * Convoque une réunion : les participants DISPONIBLES rejoignent la salle (sièges réservés).
 * Un agent en pleine mission n'est jamais interrompu : il est signalé comme absent.
 */
export async function conveneMeeting(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    topic: string;
    agenda: string;
    participantIds: string[];
    facilitatorId?: string;
    durationMin: number;
    minutes: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const roomId = 'meeting';
    if (await tx.meeting.findFirst({ where: { orgId, roomId, status: 'in_progress' } })) {
      throw new DomainError('CONFLICT', 'La salle de réunion est déjà occupée');
    }
    const wanted = [...new Set(input.participantIds)];
    const agents = await tx.agent.findMany({
      where: { orgId, id: { in: wanted }, deletedAt: null },
    });
    const available = wanted.filter((id) => {
      const a = agents.find((x) => x.id === id);
      return (
        !!a && a.status === 'active' && a.activity !== 'in_meeting' && a.currentTaskId === null
      );
    });
    const excluded = wanted.filter((id) => !available.includes(id));
    const seatsAvail = anchorsOfKind(HQ_MAP, 'meeting_seat', roomId);
    if (available.length < 2) {
      throw new DomainError(
        'CONFLICT',
        'Il faut au moins 2 participants disponibles (les agents en mission ne sont pas interrompus)',
      );
    }
    if (available.length > seatsAvail.length) {
      throw new DomainError('CONFLICT', `La salle compte ${seatsAvail.length} places`);
    }
    const facilitator =
      input.facilitatorId && available.includes(input.facilitatorId)
        ? input.facilitatorId
        : available[0]!;
    const ordered = [facilitator, ...available.filter((x) => x !== facilitator)];
    const meetingId = randomUUID();
    const seats: Record<string, string> = {};
    ordered.forEach((id, i) => (seats[id] = seatsAvail[i]!.id));
    const endsAt = new Date(now.getTime() + input.durationMin * 60_000);
    await tx.meeting.create({
      data: {
        id: meetingId,
        orgId,
        topic: input.topic.slice(0, 160),
        status: 'in_progress',
        roomId,
        initiatorAgentId: facilitator,
        startedAt: now,
        taskIdsCreated: [],
        agenda: input.agenda.slice(0, 2000),
        endsAt,
        convenedBy: `user:${input.actorId}`,
        minutesWanted: input.minutes,
        participants: {
          create: ordered.map((id, i) => ({
            agentId: id,
            seatAnchor: seats[id]!,
            role: id === facilitator ? 'initiator' : 'participant',
            joinedAt: new Date(now.getTime() + i),
          })),
        },
      },
    });
    await tx.agent.updateMany({ where: { id: { in: ordered } }, data: { activity: 'in_meeting' } });
    ctx.emit({
      classification: 'internal',
      type: 'meeting.started',
      aggregateType: 'meeting',
      aggregateId: meetingId,
      aggregateVersion: 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: { kind: 'user', id: input.actorId },
      provenance: ctx.mode,
      payload: {
        meetingId,
        roomId,
        topic: input.topic.slice(0, 160),
        initiatorAgentId: facilitator,
        taskId: null,
        participantAgentIds: ordered,
        seats,
        endsAt: endsAt.toISOString(),
      },
    });
    return { meetingId, participants: ordered, excluded, endsAt: endsAt.toISOString() };
  });
  return result;
}

/**
 * Clôture d'une réunion convoquée (par l'humain ou à l'heure prévue). Les participants
 * retournent à leur poste. Organisation live et compte rendu souhaité : l'animateur reçoit une
 * mission « Compte rendu » (ordre du jour, participants, notes de l'humain).
 */
export async function endMeeting(
  db: Db,
  input: {
    orgId: string;
    meetingId: string;
    actor: { kind: 'user' | 'system'; id: string };
    notes?: string;
    decisions?: { decision: string; ownerAgentId: string }[];
  },
): Promise<{ minutesTaskId: string | null }> {
  const m = await db.meeting.findFirst({
    where: { id: input.meetingId, orgId: input.orgId },
    include: { participants: true },
  });
  if (!m) throw new DomainError('NOT_FOUND', 'Réunion introuvable');
  if (m.status !== 'in_progress') return { minutesTaskId: null };
  const ids = m.participants.map((p) => p.agentId);
  const decisions = (input.decisions ?? [])
    .filter((d) => d.decision.trim() && ids.includes(d.ownerAgentId))
    .slice(0, 10)
    .map((d) => ({ decision: d.decision.trim().slice(0, 200), ownerAgentId: d.ownerAgentId }));
  const notes = (input.notes ?? '').trim();
  await completeMeeting(db, {
    orgId: input.orgId,
    meetingId: m.id,
    summary: (
      notes ||
      (input.actor.kind === 'system' ? 'Réunion terminée (heure prévue)' : 'Réunion terminée')
    ).slice(0, 280),
    decisions,
    delegations: [],
    causationId: null,
  });
  if (!m.minutesWanted) return { minutesTaskId: null };
  const org = await db.organization.findUniqueOrThrow({ where: { id: input.orgId } });
  if (org.mode !== 'live') return { minutesTaskId: null };
  const agents = await db.agent.findMany({
    where: { id: { in: ids } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  const who = agents
    .map((a) => `- ${a.name} (${a.title}) : ${a.versions[0]?.goal ?? ''}`.slice(0, 240))
    .join('\n');
  const { task } = await createTask(db, {
    orgId: input.orgId,
    kind: 'custom',
    agentId: m.initiatorAgentId,
    mission: {
      title: `Compte rendu — ${m.topic}`.slice(0, 120),
      instructions: [
        `Tu as animé la réunion « ${m.topic} ».`,
        `Ordre du jour :\n${m.agenda ?? '(non précisé)'}`,
        `Participants :\n${who}`,
        notes ? `Notes de l’administrateur :\n${notes}` : '',
        decisions.length
          ? `Décisions notées :\n${decisions.map((d) => `- ${d.decision}`).join('\n')}`
          : '',
        'Rédige le compte rendu : contexte, points abordés, décisions, responsables et prochaines étapes. Enregistre-le dans la bibliothèque si tu en as l’outil.',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 4000),
    },
    requester:
      input.actor.kind === 'user'
        ? { kind: 'user', id: input.actor.id }
        : { kind: 'system', id: 'meeting' },
    idempotencyKey: `meeting-minutes:${m.id}`,
  });
  return { minutesTaskId: task.id };
}

/** Réunions convoquées arrivées à l'heure de fin : clôture automatique (horloge du worker). */
export async function endDueMeetings(db: Db, now = new Date()): Promise<number> {
  const due = await db.meeting.findMany({
    where: { status: 'in_progress', endsAt: { lte: now } },
    select: { id: true, orgId: true },
  });
  for (const m of due) {
    await endMeeting(db, {
      orgId: m.orgId,
      meetingId: m.id,
      actor: { kind: 'system', id: 'meeting-clock' },
    });
  }
  return due.length;
}
