'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DomainEventSchema,
  WorldSnapshotSchema,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
  type WorldSnapshot,
} from '@company-os/contracts';
import { applyEvent } from '@company-os/world';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'error';

export interface WorldState {
  world: WorldSnapshot | null;
  feed: DomainEvent[];
  connection: ConnectionState;
  error: string | null;
}

const FEED_SIZE = 40;

declare global {
  interface Window {
    __hqSocket?: Socket;
  }
}

/**
 * Snapshot HTTP + flux Socket.IO. À chaque (re)connexion on se réabonne à partir du
 * dernier `seq` appliqué : le serveur rejoue ce qui a été manqué, la projection
 * idempotente ignore les doublons. Le backend reste la source de vérité.
 */
export function useWorld(companyId: string): WorldState {
  const [state, setState] = useState<WorldState>({
    world: null,
    feed: [],
    connection: 'connecting',
    error: null,
  });
  const worldRef = useRef<WorldSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

    const apply = (events: DomainEvent[]): void => {
      let w = worldRef.current;
      if (!w) return;
      const applied: DomainEvent[] = [];
      for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
        const next = applyEvent(w, e);
        if (next !== w) applied.push(e);
        w = next;
      }
      worldRef.current = w;
      if (applied.length === 0) return;
      setState((s) => ({
        ...s,
        world: w,
        feed: [...applied.reverse(), ...s.feed].slice(0, FEED_SIZE),
      }));
    };

    (async () => {
      try {
        const worldRes = await fetch(`${API_URL}/api/companies/${companyId}/world`);
        if (!worldRes.ok) throw new Error(`API ${worldRes.status}`);
        const snap = WorldSnapshotSchema.parse(await worldRes.json());
        if (cancelled) return;
        worldRef.current = snap;
        setState((s) => ({ ...s, world: snap }));

        socket = io(API_URL, { transports: ['websocket'] });
        // Hook de test (hors production) : permet aux e2e de couper le transport.
        if (process.env.NODE_ENV !== 'production') window.__hqSocket = socket;
        let buffering = true;
        let buffer: DomainEvent[] = [];

        socket.on('world:event', (raw) => {
          const parsed = DomainEventSchema.safeParse(raw);
          if (!parsed.success) return;
          if (buffering) buffer.push(parsed.data);
          else apply([parsed.data]);
        });
        socket.on('connect', () => {
          buffering = true;
          buffer = [];
          socket
            ?.emitWithAck('world:subscribe', {
              companyId,
              afterSeq: worldRef.current?.lastSeq ?? 0,
            })
            .then((ack) => {
              buffering = false;
              apply(buffer);
              buffer = [];
              setState((s) => ({
                ...s,
                connection: ack.ok ? 'live' : 'error',
                error: ack.ok ? null : ack.error,
              }));
            })
            .catch(() => setState((s) => ({ ...s, connection: 'error' })));
        });
        socket.on('disconnect', () => setState((s) => ({ ...s, connection: 'reconnecting' })));
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            connection: 'error',
            error: err instanceof Error ? err.message : 'Erreur inconnue',
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [companyId]);

  return state;
}
