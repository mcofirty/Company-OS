import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AgentRoleSchema,
  AgentStatusSchema,
  DomainEventSchema,
  type DomainEvent,
  type Mode,
  type NewDomainEvent,
  type WorldSnapshot,
} from '@company-os/contracts';
import { Prisma, PrismaClient } from './generated/prisma/client';

export { PrismaClient };
export * from './demo';
export type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export class DomainError extends Error {
  constructor(
    readonly code: 'company_not_found' | 'agent_not_found' | 'agent_exists' | 'mode_mismatch',
    message: string,
  ) {
    super(message);
  }
}

type EventRow = Prisma.EventGetPayload<object>;

export function rowToEvent(row: EventRow): DomainEvent {
  return DomainEventSchema.parse({
    id: row.id,
    seq: Number(row.seq),
    companyId: row.companyId,
    mode: row.mode,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    actor: { kind: row.actorKind, id: row.actorId },
    payload: row.payload,
  });
}

/**
 * Seul point d'écriture du domaine : dans UNE transaction, on
 *  1. sérialise les écritures de l'entreprise (advisory lock) pour que l'ordre des `seq`
 *     corresponde à l'ordre de commit (un lecteur « après seq N » ne saute jamais d'événement) ;
 *  2. valide et applique l'effet métier sur l'état courant ;
 *  3. ajoute l'événement au journal et un message dans l'outbox.
 * Une `idempotencyKey` déjà vue renvoie les événements existants sans rien réécrire.
 */
export async function appendEvents(
  db: Db,
  events: readonly NewDomainEvent[],
  opts: { idempotencyKey?: string } = {},
): Promise<DomainEvent[]> {
  const first = events[0];
  if (!first) return [];
  const companyId = first.companyId;
  if (events.some((e) => e.companyId !== companyId)) {
    throw new Error('appendEvents: tous les événements doivent cibler la même entreprise');
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;

    if (opts.idempotencyKey) {
      const existing = await tx.event.findUnique({
        where: { idempotencyKey: `${opts.idempotencyKey}#0` },
      });
      if (existing) {
        const rows = await tx.event.findMany({
          where: { idempotencyKey: { startsWith: `${opts.idempotencyKey}#` } },
          orderBy: { seq: 'asc' },
        });
        return rows.map(rowToEvent);
      }
    }

    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) throw new DomainError('company_not_found', `Entreprise ${companyId} inconnue`);

    const out: DomainEvent[] = [];
    for (const [i, e] of events.entries()) {
      if (e.mode !== company.mode) {
        throw new DomainError(
          'mode_mismatch',
          `Événement ${e.mode} refusé pour une entreprise ${company.mode}`,
        );
      }
      await applyToState(tx, e);
      const row = await tx.event.create({
        data: {
          id: randomUUID(),
          companyId,
          type: e.type,
          mode: e.mode,
          actorKind: e.actor.kind,
          actorId: e.actor.id,
          payload: e.payload,
          idempotencyKey: opts.idempotencyKey ? `${opts.idempotencyKey}#${i}` : null,
        },
      });
      await tx.outboxMessage.create({ data: { eventSeq: row.seq } });
      out.push(rowToEvent(row));
    }
    return out;
  });
}

async function applyToState(tx: Tx, e: NewDomainEvent): Promise<void> {
  // Validation stricte du payload avant toute écriture.
  DomainEventSchema.parse({
    ...e,
    id: '00000000-0000-4000-8000-000000000000',
    seq: 1,
    occurredAt: new Date().toISOString(),
  });
  switch (e.type) {
    case 'agent.spawned': {
      const exists = await tx.agent.findUnique({ where: { id: e.payload.agentId } });
      if (exists) throw new DomainError('agent_exists', `Agent ${e.payload.agentId} existe déjà`);
      await tx.agent.create({
        data: {
          id: e.payload.agentId,
          companyId: e.companyId,
          name: e.payload.name,
          role: e.payload.role,
          posX: e.payload.position.x,
          posY: e.payload.position.y,
          mode: e.mode,
        },
      });
      return;
    }
    case 'agent.moved':
      await updateAgent(tx, e.companyId, e.payload.agentId, {
        posX: e.payload.to.x,
        posY: e.payload.to.y,
      });
      return;
    case 'agent.status_changed':
      await updateAgent(tx, e.companyId, e.payload.agentId, {
        status: e.payload.status,
        activity: e.payload.activity,
      });
      return;
  }
}

async function updateAgent(
  tx: Tx,
  companyId: string,
  agentId: string,
  data: Prisma.AgentUpdateManyMutationInput,
): Promise<void> {
  const res = await tx.agent.updateMany({ where: { id: agentId, companyId }, data });
  if (res.count === 0) throw new DomainError('agent_not_found', `Agent ${agentId} introuvable`);
}

/** Snapshot cohérent (état + dernier seq) lu dans une transaction REPEATABLE READ. */
export async function loadWorldSnapshot(db: Db, companyId: string): Promise<WorldSnapshot | null> {
  return db.$transaction(
    async (tx) => {
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) return null;
      const [agents, last] = await Promise.all([
        tx.agent.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } }),
        tx.event.aggregate({ where: { companyId }, _max: { seq: true } }),
      ]);
      // seq de création / dernière mise à jour de chaque agent
      const seqs = await tx.$queryRaw<{ agentId: string; first: bigint; last: bigint }[]>`
        SELECT payload->>'agentId' AS "agentId", MIN(seq) AS first, MAX(seq) AS last
        FROM "Event" WHERE "companyId" = ${companyId} GROUP BY 1`;
      const bySeq = new Map(seqs.map((s) => [s.agentId, s]));
      return {
        companyId,
        mode: company.mode,
        lastSeq: Number(last._max.seq ?? 0n),
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          role: AgentRoleSchema.parse(a.role),
          status: AgentStatusSchema.parse(a.status),
          activity: a.activity,
          position: { x: a.posX, y: a.posY },
          mode: a.mode,
          spawnedAtSeq: Number(bySeq.get(a.id)?.first ?? 0n),
          updatedAtSeq: Number(bySeq.get(a.id)?.last ?? 0n),
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export async function listEventsAfter(
  db: Db,
  companyId: string,
  afterSeq: number,
  limit = 500,
): Promise<DomainEvent[]> {
  const rows = await db.event.findMany({
    where: { companyId, seq: { gt: BigInt(afterSeq) } },
    orderBy: { seq: 'asc' },
    take: limit,
  });
  return rows.map(rowToEvent);
}

export async function listAgentEvents(
  db: Db,
  companyId: string,
  agentId: string,
  limit = 50,
): Promise<DomainEvent[]> {
  const rows = await db.event.findMany({
    where: { companyId, payload: { path: ['agentId'], equals: agentId } },
    orderBy: { seq: 'desc' },
    take: limit,
  });
  return rows.map(rowToEvent);
}

/**
 * Récupère un lot de messages d'outbox non publiés, les verrouille (SKIP LOCKED, donc
 * plusieurs relais possibles), appelle `publish`, puis les marque publiés. Si `publish`
 * échoue, la transaction est annulée et le lot sera retenté (livraison au moins une fois ;
 * les clients dédupliquent par `seq`).
 */
export async function relayOutbox(
  db: Db,
  publish: (events: DomainEvent[]) => Promise<void> | void,
  batchSize = 100,
): Promise<number> {
  return db.$transaction(async (tx) => {
    const batch = await tx.$queryRaw<{ id: bigint; eventSeq: bigint }[]>`
      SELECT id, "eventSeq" FROM "OutboxMessage"
      WHERE "publishedAt" IS NULL ORDER BY id LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (batch.length === 0) return 0;
    const rows = await tx.event.findMany({
      where: { seq: { in: batch.map((b) => b.eventSeq) } },
      orderBy: { seq: 'asc' },
    });
    await publish(rows.map(rowToEvent));
    await tx.outboxMessage.updateMany({
      where: { id: { in: batch.map((b) => b.id) } },
      data: { publishedAt: new Date(), attempts: { increment: 1 } },
    });
    return batch.length;
  });
}

export async function ensureCompany(
  db: Db,
  company: { id: string; name: string; mode: Mode },
): Promise<void> {
  await db.company.upsert({ where: { id: company.id }, create: company, update: {} });
}
