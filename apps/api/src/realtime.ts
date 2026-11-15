import type { Server as HttpServer } from 'node:http';
import { Server as IoServer } from 'socket.io';
import {
  MAX_REPLAY_EVENTS,
  ResumeRequestSchema,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
} from '@company-os/contracts';
import { listEventsAfter, type Db } from '@company-os/db';
import { principalOfHandshake, type AuthConfig, type Principal } from './auth';

export type Io = IoServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  { principal: Principal }
>;
const room = (orgId: string): string => `org:${orgId}`;

/**
 * Protocole (docs/07 §4) : le client envoie `events:resume {afterSeq}` ; le serveur rejoint la
 * room de l'org PUIS rejoue depuis event_log (aucune perte, doublons dédupliqués côté client par
 * seq), acquitte `{accepted, lastSeq}`. Écart trop grand : `sync:required`.
 */
export function attachRealtime(
  server: HttpServer,
  db: Db,
  auth: AuthConfig,
  corsOrigin: string | string[],
): Io {
  const io: Io = new IoServer(server, { cors: { origin: corsOrigin } });

  io.use((socket, next) => {
    principalOfHandshake(auth, db, {
      address: socket.handshake.address,
      headers: socket.handshake.headers,
      auth: socket.handshake.auth as Record<string, unknown>,
    })
      .then((principal) => {
        socket.data.principal = principal;
        next();
      })
      .catch(() => next(new Error('UNAUTHORIZED')));
  });

  io.on('connection', (socket) => {
    const { orgId } = socket.data.principal;
    socket.on('events:resume', async (raw, ack) => {
      if (typeof ack !== 'function') return;
      const parsed = ResumeRequestSchema.safeParse(raw);
      if (!parsed.success) return ack({ accepted: false, error: 'VALIDATION_ERROR' });
      const org = await db.organization.findUnique({ where: { id: orgId } });
      if (!org) return ack({ accepted: false, error: 'NOT_FOUND' });
      const lastSeq = Number(org.lastSeq);
      if (lastSeq - parsed.data.afterSeq > MAX_REPLAY_EVENTS) {
        socket.emit('sync:required', { lastSeq });
        return ack({ accepted: false, error: 'EVENT_GAP' });
      }
      await socket.join(room(orgId));
      let cursor = parsed.data.afterSeq;
      let replayed = 0;
      for (;;) {
        const batch = await listEventsAfter(db, orgId, cursor, 200);
        for (const e of batch) socket.emit('domain:event', e);
        replayed += batch.length;
        const last = batch.at(-1);
        if (!last || batch.length < 200) break;
        cursor = last.seq;
      }
      ack({ accepted: true, lastSeq: Math.max(lastSeq, cursor), replayed });
    });
  });
  return io;
}

/** Diffusion vers la seule room de l'org de l'événement (isolation tenant). */
export function broadcast(io: Io, events: DomainEvent[]): void {
  for (const e of events) io.to(room(e.orgId)).emit('domain:event', e);
}
