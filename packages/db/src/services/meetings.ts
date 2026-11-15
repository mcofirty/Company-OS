import { randomUUID } from 'node:crypto';
import type { MeetingView, TaskKind } from '@company-os/contracts';
import { activityAtRest, anchorsOfKind, HQ_MAP } from '@company-os/world';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx } from '../events';
import { meetingView } from '../views';
import { createTaskInTx } from './tasks';

const base = { classification: 'internal' } as const;

/**
 * Démarre une réunion réelle (docs/04 §7) : salle libre, participants disponibles, un siège
 * réservé par participant (aucune superposition). Idempotent par invocation.
 */
export async function startMeeting(
  db: Db,
  input: {
    orgId: string;
    invocationId: string;
    taskId: string;
    initiatorAgentId: string;
    topic: string;
    participantIds: string[];
    correlationId: string;
    causationId: string | null;
    roomId?: string;
    now?: Date;
  },
): Promise<{ meeting: MeetingView; excluded: string[]; eventId: string | null }> {
  const now = input.now ?? new Date();
  const roomId = input.roomId ?? 'meeting';
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const prior = await tx.meeting.findUnique({
      where: { invocationId: input.invocationId },
      include: { participants: true },
    });
    if (prior) return { meeting: meetingView(prior), excluded: [], eventId: null };
    if (await tx.meeting.findFirst({ where: { orgId, roomId, status: 'in_progress' } })) {
      throw new DomainError('CONFLICT', 'ROOM_BUSY');
    }
    const wanted = [
      input.initiatorAgentId,
      ...input.participantIds.filter((p) => p !== input.initiatorAgentId),
    ];
    const agents = await tx.agent.findMany({
      where: { orgId, id: { in: wanted }, deletedAt: null },
    });
    const available = wanted.filter((id) => {
      const a = agents.find((x) => x.id === id);
      if (!a || a.status !== 'active' || a.activity === 'in_meeting') return false;
      // Un participant occupé par une autre tâche ne quitte pas son travail.
      return id === input.initiatorAgentId || a.currentTaskId === null;
    });
    const excluded = wanted.filter((id) => !available.includes(id));
    const seatsAvail = anchorsOfKind(HQ_MAP, 'meeting_seat', roomId);
    if (available.length < 2) throw new DomainError('CONFLICT', 'PARTICIPANTS_UNAVAILABLE');
    if (available.length > seatsAvail.length)
      throw new DomainError('CONFLICT', 'ROOM_CAPACITY_EXCEEDED');

    const meetingId = randomUUID();
    const seats: Record<string, string> = {};
    available.forEach((id, i) => (seats[id] = seatsAvail[i]!.id));
    await tx.meeting.create({
      data: {
        id: meetingId,
        orgId,
        topic: input.topic.slice(0, 160),
        status: 'in_progress',
        roomId,
        initiatorAgentId: input.initiatorAgentId,
        taskId: input.taskId,
        invocationId: input.invocationId,
        startedAt: now,
        taskIdsCreated: [],
        participants: {
          create: available.map((id, i) => ({
            agentId: id,
            seatAnchor: seats[id]!,
            role: id === input.initiatorAgentId ? 'initiator' : 'participant',
            joinedAt: new Date(now.getTime() + i),
          })),
        },
      },
    });
    await tx.agent.updateMany({
      where: { id: { in: available } },
      data: { activity: 'in_meeting' },
    });
    const eventId = ctx.emit({
      ...base,
      type: 'meeting.started',
      aggregateType: 'meeting',
      aggregateId: meetingId,
      aggregateVersion: 1,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actor: { kind: 'agent', id: input.initiatorAgentId },
      provenance: ctx.mode,
      payload: {
        meetingId,
        roomId,
        topic: input.topic.slice(0, 160),
        initiatorAgentId: input.initiatorAgentId,
        taskId: input.taskId,
        participantAgentIds: available,
        seats,
      },
    });
    const row = await tx.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { participants: true },
    });
    return { meeting: meetingView(row), excluded, eventId };
  });
  return result;
}

/**
 * Clôture : synthèse et décisions structurées persistées, sous-tâches déléguées (règles de
 * délégation appliquées), retour des participants à leur activité au repos.
 */
export async function completeMeeting(
  db: Db,
  input: {
    orgId: string;
    meetingId: string;
    summary: string;
    decisions: { decision: string; ownerAgentId: string }[];
    delegations: { kind: TaskKind; assigneeAgentId?: string }[];
    causationId: string | null;
    now?: Date;
  },
): Promise<{ meeting: MeetingView; eventId: string | null }> {
  const now = input.now ?? new Date();
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    const { tx, orgId } = ctx;
    const m = await tx.meeting.findFirst({
      where: { id: input.meetingId, orgId },
      include: { participants: true },
    });
    if (!m) throw new DomainError('NOT_FOUND', 'Réunion introuvable');
    if (m.status !== 'in_progress') return { meeting: meetingView(m), eventId: null };
    const created: string[] = [];
    for (const d of input.delegations) {
      const r = await createTaskInTx(ctx, {
        kind: d.kind,
        agentId: d.assigneeAgentId,
        requester: { kind: 'agent', id: m.initiatorAgentId },
        parentTaskId: m.taskId ?? undefined,
        idempotencyKey: `meeting:${m.id}:${d.kind}`,
        causationId: input.causationId,
      });
      created.push(r.task.id);
    }
    await tx.meeting.update({
      where: { id: m.id },
      data: {
        status: 'completed',
        endedAt: now,
        summary: input.summary.slice(0, 280),
        decisions: input.decisions,
        taskIdsCreated: created,
      },
    });
    await tx.meetingParticipant.updateMany({ where: { meetingId: m.id }, data: { leftAt: now } });
    // Même règle que le réducteur client (activityAtRest).
    const ids = m.participants.map((p) => p.agentId);
    const agents = await tx.agent.findMany({ where: { id: { in: ids } } });
    const queued = await tx.task.findMany({
      where: { orgId, agentId: { in: ids }, status: 'queued' },
      select: { agentId: true, status: true },
    });
    for (const a of agents) {
      await tx.agent.update({
        where: { id: a.id },
        data: {
          activity: activityAtRest(
            queued.map((q) => ({ agentId: q.agentId, status: 'queued' as const })),
            a,
          ),
        },
      });
    }
    const task = m.taskId ? await tx.task.findUnique({ where: { id: m.taskId } }) : null;
    const eventId = ctx.emit({
      ...base,
      type: 'meeting.completed',
      aggregateType: 'meeting',
      aggregateId: m.id,
      aggregateVersion: 2,
      correlationId: task?.correlationId ?? randomUUID(),
      causationId: input.causationId,
      actor: { kind: 'agent', id: m.initiatorAgentId },
      provenance: ctx.mode,
      payload: {
        meetingId: m.id,
        summary: input.summary.slice(0, 280),
        decisions: input.decisions,
        taskIdsCreated: created,
      },
    });
    const row = await tx.meeting.findUniqueOrThrow({
      where: { id: m.id },
      include: { participants: true },
    });
    return { meeting: meetingView(row), eventId };
  });
  return result;
}
