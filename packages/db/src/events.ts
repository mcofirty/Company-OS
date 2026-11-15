import { randomUUID } from 'node:crypto';
import { DomainEventSchema, type DomainEvent, type NewEvent } from '@company-os/contracts';
import { alertFromEvent } from '@company-os/world';
import type { Db, Tx } from './client';
import type { Prisma } from './generated/prisma/client';
import { DomainError } from './errors';

type EventRow = Prisma.EventLogGetPayload<object>;

export function rowToEvent(row: EventRow): DomainEvent {
  return DomainEventSchema.parse({
    schemaVersion: row.schemaVersion,
    eventId: row.id,
    orgId: row.orgId,
    seq: Number(row.seq),
    type: row.type,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    aggregateVersion: row.aggregateVersion,
    correlationId: row.correlationId,
    causationId: row.causationId,
    actor: { kind: row.actorKind, id: row.actorId },
    provenance: row.provenance,
    occurredAt: row.occurredAt.toISOString(),
    classification: row.classification,
    payload: row.payload,
  });
}

export interface OrgTxContext {
  tx: Tx;
  orgId: string;
  mode: 'demo' | 'live';
  now: Date;
  /** Prépare un événement (validé au commit) et retourne son eventId pour chaîner la causalité. */
  emit: (e: NewEvent) => string;
}

/**
 * Unique chemin d'écriture du domaine. Dans UNE transaction :
 *  1. verrouille la ligne de l'organisation (sérialise les mutations de l'org, ce qui rend
 *     `seq` contigu et ordonné comme les commits) ;
 *  2. exécute la mutation métier (`fn`) qui prépare ses événements via `ctx.emit` ;
 *  3. attribue les seq, insère event_log + outbox, met à jour organizations.last_seq.
 * Toute erreur annule l'ensemble : pas d'état sans événement, ni d'événement sans état.
 */
export async function withOrgTx<T>(
  db: Db,
  orgId: string,
  now: Date,
  fn: (ctx: OrgTxContext) => Promise<T>,
): Promise<{ result: T; events: DomainEvent[] }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ last_seq: bigint; mode: 'demo' | 'live' }[]>`
      SELECT last_seq, mode FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`;
    const org = rows[0];
    if (!org) throw new DomainError('NOT_FOUND', `Organisation ${orgId} introuvable`);

    const pending: { id: string; e: NewEvent }[] = [];
    const ctx: OrgTxContext = {
      tx,
      orgId,
      mode: org.mode,
      now,
      emit: (e) => {
        const id = randomUUID();
        pending.push({ id, e });
        return id;
      },
    };
    const result = await fn(ctx);

    const out: DomainEvent[] = [];
    let seq = Number(org.last_seq);
    for (const { id, e } of pending) {
      seq += 1;
      const event = DomainEventSchema.parse({
        ...e,
        schemaVersion: 1,
        eventId: id,
        orgId,
        seq,
        occurredAt: now.toISOString(),
      });
      if (event.provenance === 'demo' && org.mode !== 'demo') {
        throw new DomainError('POLICY_DENIED', 'Événement démo refusé dans une organisation live');
      }
      if (event.provenance === 'live' && org.mode !== 'live') {
        throw new DomainError('POLICY_DENIED', 'Événement live refusé dans une organisation démo');
      }
      await tx.eventLog.create({
        data: {
          id,
          orgId,
          seq: BigInt(seq),
          type: event.type,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          correlationId: event.correlationId,
          causationId: event.causationId,
          actorKind: event.actor.kind,
          actorId: event.actor.id,
          provenance: event.provenance,
          classification: event.classification,
          payload: event.payload,
          schemaVersion: 1,
          occurredAt: now,
        },
      });
      await tx.outbox.create({ data: { orgId, eventId: id } });
      // Alerte dérivée, écrite dans la même transaction (même règle que le client).
      const alert = alertFromEvent(event);
      if (alert) {
        await tx.alert.create({
          data: {
            id: alert.id,
            orgId,
            level: alert.level,
            title: alert.title.slice(0, 200),
            resourceType: alert.resourceType,
            resourceId: alert.resourceId,
            eventSeq: BigInt(alert.eventSeq),
            createdAt: now,
          },
        });
      }
      out.push(event);
    }
    if (pending.length > 0) {
      await tx.organization.update({ where: { id: orgId }, data: { lastSeq: BigInt(seq) } });
    }
    return { result, events: out };
  });
}

export async function listEventsAfter(
  db: Db,
  orgId: string,
  afterSeq: number,
  limit = 200,
): Promise<DomainEvent[]> {
  const rows = await db.eventLog.findMany({
    where: { orgId, seq: { gt: BigInt(afterSeq) } },
    orderBy: { seq: 'asc' },
    take: limit,
  });
  return rows.map(rowToEvent);
}

export async function listEventsByCorrelation(
  db: Db,
  orgId: string,
  correlationId: string,
): Promise<DomainEvent[]> {
  const rows = await db.eventLog.findMany({
    where: { orgId, correlationId },
    orderBy: { seq: 'asc' },
    take: 200,
  });
  return rows.map(rowToEvent);
}

/**
 * Relais outbox -> diffusion temps réel (au moins une fois). Verrouille un lot avec
 * SKIP LOCKED, appelle `publish`, puis marque publié. En cas d'échec, rien n'est marqué.
 */
export async function relayOutbox(
  db: Db,
  publish: (events: DomainEvent[]) => Promise<void> | void,
  batchSize = 200,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const batch = await tx.$queryRaw<{ id: bigint; event_id: string }[]>`
      SELECT id, event_id FROM outbox
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY id LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (batch.length === 0) return 0;
    const rows = await tx.eventLog.findMany({
      where: { id: { in: batch.map((b) => b.event_id) } },
      orderBy: [{ orgId: 'asc' }, { seq: 'asc' }],
    });
    await publish(rows.map(rowToEvent));
    await tx.outbox.updateMany({
      where: { id: { in: batch.map((b) => b.id) } },
      data: { status: 'published', publishedAt: new Date(), attempts: { increment: 1 } },
    });
    return batch.length;
  });
}
