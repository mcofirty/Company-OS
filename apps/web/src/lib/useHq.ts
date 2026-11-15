'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  DomainEventSchema,
  WorldSnapshotSchema,
  type ClientToServerEvents,
  type DomainEvent,
  type ServerToClientEvents,
  type TaskKind,
  type TaskView,
  type WorldSnapshot,
} from '@company-os/contracts';
import { applyEvent } from '@company-os/world';
import { api, SOCKET_URL } from './api';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'resyncing' | 'error';
export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'danger' | 'success';
}

declare global {
  interface Window {
    __hqSocket?: Socket;
  }
}

/**
 * Store temps réel du cockpit. Le backend fait foi :
 *  - snapshot `GET /v1/bootstrap` (cohérent avec lastSeq) ;
 *  - Socket.IO `events:resume {afterSeq}` -> rejeu des manqués + live ;
 *  - réducteur idempotent ; trou de séquence -> rattrapage `GET /v1/events` ;
 *  - `sync:required` -> rechargement complet du snapshot.
 */
export function useHq() {
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const worldRef = useRef<WorldSnapshot | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const live = useRef(false);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((s) => [...s, { ...t, id }].slice(-4));
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 5000);
  }, []);

  const commit = (w: WorldSnapshot): void => {
    worldRef.current = w;
    setWorld(w);
  };

  const loadSnapshot = useCallback(async () => {
    const { data } = await api<unknown>('/v1/bootstrap');
    commit(WorldSnapshotSchema.parse(data));
  }, []);

  const catchUp = useCallback(async () => {
    for (let guard = 0; guard < 50; guard++) {
      const w = worldRef.current;
      if (!w) return;
      const { data, meta } = await api<unknown[]>(`/v1/events?afterSeq=${w.lastSeq}&limit=500`);
      let cur = w;
      for (const raw of data) cur = applyEvent(cur, DomainEventSchema.parse(raw)).world;
      commit(cur);
      if (!meta['hasMore']) return;
    }
  }, []);

  const ingest = useCallback(
    (events: DomainEvent[]) => {
      chain.current = chain.current.then(async () => {
        let w = worldRef.current;
        if (!w) return;
        for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
          const r = applyEvent(w, e);
          if (r.outcome === 'gap') {
            commit(w);
            await catchUp();
            w = worldRef.current!;
            w = applyEvent(w, e).world;
            continue;
          }
          if (r.outcome === 'applied' && live.current && e.type === 'agent.created') {
            toast({ text: `Nouvel agent : ${e.payload.name} rejoint l'équipe`, tone: 'info' });
          }
          if (r.outcome === 'applied' && live.current && e.type === 'task.blocked') {
            toast({ text: `Tâche bloquée : ${e.payload.reasonCode}`, tone: 'danger' });
          }
          w = r.world;
        }
        commit(w);
      });
    },
    [catchUp, toast],
  );

  useEffect(() => {
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    let cancelled = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);

    (async () => {
      try {
        await loadSnapshot();
        if (cancelled) return;
        socket = io(SOCKET_URL, { transports: ['websocket'] });
        if (process.env.NODE_ENV !== 'production') window.__hqSocket = socket as unknown as Socket;
        let buffering = true;
        let buffer: DomainEvent[] = [];
        socket.on('domain:event', (raw) => {
          const parsed = DomainEventSchema.safeParse(raw);
          if (!parsed.success) return;
          if (buffering) buffer.push(parsed.data);
          else ingest([parsed.data]);
        });
        socket.on('sync:required', () => {
          setConnection('resyncing');
          chain.current = chain.current.then(loadSnapshot);
        });
        socket.on('connect', () => {
          buffering = true;
          buffer = [];
          live.current = false;
          void chain.current.then(async () => {
            const ack = await socket!.emitWithAck('events:resume', {
              afterSeq: worldRef.current?.lastSeq ?? 0,
            });
            if (!ack.accepted) {
              if (ack.error === 'EVENT_GAP') await loadSnapshot();
              else setError(ack.error);
            }
            buffering = false;
            ingest(buffer);
            buffer = [];
            chain.current = chain.current.then(() => {
              live.current = true;
              setConnection('live');
              setError(null);
            });
          });
        });
        socket.on('disconnect', () => setConnection('reconnecting'));
        socket.on('connect_error', (e) => {
          setConnection('error');
          setError(e.message);
        });
      } catch (err) {
        if (!cancelled) {
          setConnection('error');
          setError(err instanceof Error ? err.message : 'API indisponible');
        }
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(tick);
      socket?.close();
    };
  }, [ingest, loadSnapshot]);

  const createTask = useCallback(async (kind: TaskKind, agentId?: string): Promise<TaskView> => {
    const { data } = await api<TaskView>('/v1/tasks', {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(agentId ? { kind, agentId } : { kind }),
    });
    return data;
  }, []);

  const setSystemPaused = useCallback(async (pause: boolean): Promise<void> => {
    await api(`/v1/system/${pause ? 'pause' : 'resume'}`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        reason: pause ? 'Pause manuelle depuis le cockpit' : 'Reprise manuelle depuis le cockpit',
      }),
    });
  }, []);

  return { world, connection, error, toasts, now, createTask, toast, setSystemPaused };
}
