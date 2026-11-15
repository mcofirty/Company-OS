import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Server as IoServer } from 'socket.io';
import { z } from 'zod';
import {
  SubscribeRequestSchema,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
} from '@company-os/contracts';
import {
  listAgentEvents,
  listEventsAfter,
  loadWorldSnapshot,
  relayOutbox,
  type Db,
} from '@company-os/db';

export interface AppOptions {
  db: Db;
  webOrigin: string;
  logger?: boolean;
}

export type Io = IoServer<ClientToServerEvents, ServerToClientEvents>;

const CompanyParams = z.object({ companyId: z.string().min(1).max(64) });
const AgentParams = CompanyParams.extend({ agentId: z.string().min(1).max(64) });
const AfterQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

const room = (companyId: string): string => `company:${companyId}`;

export async function buildApp(
  opts: AppOptions,
): Promise<{ app: FastifyInstance; io: Io; relayOnce: () => Promise<number> }> {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(cors, { origin: opts.webOrigin });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'invalid_request', issues: err.issues });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'internal_error' });
  });

  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.get('/api/companies/:companyId/world', async (req, reply) => {
    const { companyId } = CompanyParams.parse(req.params);
    const snap = await loadWorldSnapshot(db, companyId);
    if (!snap) return reply.status(404).send({ error: 'company_not_found' });
    return snap;
  });

  app.get('/api/companies/:companyId/events', async (req) => {
    const { companyId } = CompanyParams.parse(req.params);
    const { after } = AfterQuery.parse(req.query);
    return { events: await listEventsAfter(db, companyId, after) };
  });

  // Inspecteur d'agent : état courant + historique d'événements (aucun raisonnement LLM).
  app.get('/api/companies/:companyId/agents/:agentId', async (req, reply) => {
    const { companyId, agentId } = AgentParams.parse(req.params);
    const snap = await loadWorldSnapshot(db, companyId);
    const agent = snap?.agents.find((a) => a.id === agentId);
    if (!agent) return reply.status(404).send({ error: 'agent_not_found' });
    return { agent, events: await listAgentEvents(db, companyId, agentId) };
  });

  const io: Io = new IoServer(app.server, { cors: { origin: opts.webOrigin } });

  io.on('connection', (socket) => {
    socket.on('world:subscribe', async (raw, ack) => {
      const parsed = SubscribeRequestSchema.safeParse(raw);
      if (!parsed.success || typeof ack !== 'function') {
        if (typeof ack === 'function') ack({ ok: false, error: 'invalid_request' });
        return;
      }
      const { companyId, afterSeq } = parsed.data;
      // On rejoint la room AVANT le rejeu : un événement publié entre-temps arrive
      // potentiellement deux fois, le client déduplique par seq. Rien n'est perdu.
      await socket.join(room(companyId));
      let replayed = 0;
      let cursor = afterSeq;
      for (;;) {
        const batch = await listEventsAfter(db, companyId, cursor);
        for (const e of batch) socket.emit('world:event', e);
        replayed += batch.length;
        const last = batch.at(-1);
        if (!last || batch.length < 500) break;
        cursor = last.seq;
      }
      ack({ ok: true, replayed });
    });
  });

  const publish = (events: DomainEvent[]): void => {
    for (const e of events) io.to(room(e.companyId)).emit('world:event', e);
  };
  const relayOnce = (): Promise<number> => relayOutbox(db, publish);

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => void io.close(() => resolve()));
  });

  return { app, io, relayOnce };
}
