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
  type CreateAgentRequest,
  type TaskView,
  type WorldSnapshot,
  type AlertView,
} from '@company-os/contracts';
import { applyEvent } from '@company-os/world';
import { api, ApiFailure, authToken, getBackend, getOrg, setOrg } from './api';
import { completeLogin, fetchAuthConfig, type AuthPublicConfig } from './oidc';

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

  const [me, setMe] = useState<Me | null>(null);
  /** Renseigné quand l'API exige une connexion (401) ou refuse ce compte (403). */
  const [authNeeded, setAuthNeeded] = useState<{
    config: AuthPublicConfig;
    reason: 'login' | 'forbidden';
  } | null>(null);

  const loadSnapshot = useCallback(async () => {
    const { data } = await api<unknown>('/v1/bootstrap');
    commit(WorldSnapshotSchema.parse(data));
    api<Me>('/v1/me')
      .then((r) => setMe(r.data))
      .catch(() => setMe(null));
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
          if (r.outcome === 'applied' && live.current && e.type === 'approval.requested') {
            toast({ text: 'Nouvelle demande de validation', tone: 'info' });
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
        await completeLogin().catch((err: unknown) => {
          // Retour OIDC invalide (état, PKCE) : on repart d'une page sans session.
          setError(`Connexion refusée : ${err instanceof Error ? err.message : 'erreur'}`);
        });
        try {
          await loadSnapshot();
        } catch (err) {
          // Organisation mémorisée devenue inaccessible : retour à l'organisation par défaut.
          if (err instanceof ApiFailure && err.status === 403 && getOrg()) {
            setOrg(null);
            window.location.reload();
            return;
          }
          if (err instanceof ApiFailure && (err.status === 401 || err.status === 403)) {
            const config = await fetchAuthConfig(getBackend().url).catch((): AuthPublicConfig => ({
              mode: 'token',
            }));
            if (!cancelled) {
              setAuthNeeded({ config, reason: err.status === 401 ? 'login' : 'forbidden' });
              setConnection('error');
            }
            return;
          }
          throw err;
        }
        if (cancelled) return;
        const backend = getBackend();
        // Jeton relu à chaque (re)connexion : une session expirée ne se reconnecte pas.
        socket = io(backend.url, {
          transports: ['websocket'],
          auth: (cb) => {
            const token = authToken(backend);
            const org = getOrg();
            cb({ ...(token ? { token } : {}), ...(org ? { orgId: org } : {}) });
          },
        });
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

  const decideApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'reject', reason: string): Promise<void> => {
      await api(`/v1/approvals/${approvalId}/decide`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ decision, reason }),
      });
    },
    [],
  );

  /** Acquittement : appel API puis mise à jour locale (l'acquittement n'est pas un événement). */
  const ackAlert = useCallback(async (alertId: string): Promise<void> => {
    const { data } = await api<AlertView>(`/v1/alerts/${alertId}/ack`, {
      method: 'POST',
      body: '{}',
    });
    const w = worldRef.current;
    if (w) commit({ ...w, alerts: w.alerts.map((a) => (a.id === alertId ? data : a)) });
  }, []);

  const ackAllAlerts = useCallback(async (): Promise<void> => {
    const { data } = await api<{ ackedAt: string }>('/v1/alerts/ack-all', {
      method: 'POST',
      body: '{}',
    });
    const w = worldRef.current;
    if (w)
      commit({
        ...w,
        alerts: w.alerts.map((a) =>
          a.ackedAt ? a : { ...a, ackedAt: data.ackedAt, ackedBy: 'moi' },
        ),
      });
  }, []);

  const cancelTask = useCallback(async (taskId: string, reason: string): Promise<void> => {
    await api(`/v1/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ reason }),
    });
  }, []);
  const retryTask = useCallback(async (taskId: string): Promise<TaskView> => {
    const { data } = await api<{ task: TaskView }>(`/v1/tasks/${taskId}/retry`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: '{}',
    });
    return data.task;
  }, []);

  /** Mission libre confiée à un agent (organisation live). */
  const createMission = useCallback(
    async (
      agentId: string,
      mission: { title: string; instructions: string; modelTier?: string },
    ): Promise<TaskView> => {
      const { data } = await api<TaskView>('/v1/tasks', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ kind: 'custom', agentId, mission }),
      });
      return data;
    },
    [],
  );

  /** Création d'un agent par l'administrateur (organisation live). */
  const createAgent = useCallback(
    async (body: CreateAgentRequest, idempotencyKey: string): Promise<string> => {
      const { data } = await api<{ agentId: string }>('/v1/agents', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify(body),
      });
      return data.agentId;
    },
    [],
  );

  const agentLifecycle = useCallback(
    async (
      agentId: string,
      action: 'pause' | 'resume' | 'deactivate',
      reason: string,
    ): Promise<void> => {
      await api(`/v1/agents/${agentId}/${action}`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ reason }),
      });
    },
    [],
  );

  return {
    world,
    connection,
    error,
    toasts,
    now,
    me,
    authNeeded,
    createTask,
    toast,
    setSystemPaused,
    decideApproval,
    ackAlert,
    ackAllAlerts,
    agentLifecycle,
    createMission,
    createAgent,
    cancelTask,
    retryTask,
  };
}

export interface OrgChoice {
  id: string;
  name: string;
  mode: 'demo' | 'live';
  role: 'admin' | 'operator' | 'viewer';
}
export interface Me {
  userId: string;
  orgId: string;
  orgs: OrgChoice[];
  role: 'admin' | 'operator' | 'viewer';
  displayName: string;
  capabilities: {
    createAgent: boolean;
    createMission: boolean;
    createTask: boolean;
    pauseAgent: boolean;
    deactivateAgent: boolean;
    decideApproval: boolean;
    systemControl: boolean;
    ackAlert: boolean;
    manageConnectors?: boolean;
    editProfile?: boolean;
    manageHierarchy?: boolean;
    deleteAgent?: boolean;
    editAgent?: boolean;
    editBudget?: boolean;
    manageSchedules?: boolean;
    manageNotifications?: boolean;
    manageDepartments?: boolean;
    conveneMeeting?: boolean;
  };
}
