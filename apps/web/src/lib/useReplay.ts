'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DomainEventSchema, type DomainEvent, type WorldSnapshot } from '@company-os/contracts';
import { applyEvent } from '@company-os/world';
import { api } from './api';

/**
 * Replay historique (docs/10 §6, scénario G) : reconstruit l'état à l'instant T en rejouant le
 * journal du serveur dans le réducteur, depuis un état vide. Aucune écriture, aucun appel
 * d'outil ni de modèle : seule la lecture `GET /v1/events` est utilisée.
 */
const CHECKPOINT_EVERY = 200;

function emptyFrom(base: WorldSnapshot): WorldSnapshot {
  return {
    ...base,
    lastSeq: 0,
    agents: [],
    tasks: [],
    invocations: [],
    timeline: [],
    approvals: [],
    meetings: [],
    alerts: [],
    costs: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false },
    budgets: base.budgets.map((b) => ({ ...b, usedMicros: 0 })),
    system: { paused: false },
  };
}

export interface ReplayState {
  active: boolean;
  loading: boolean;
  /** Échec du chargement du journal (affiché, jamais remplacé par des données inventées). */
  loadError: string | null;
  events: DomainEvent[];
  index: number; // nombre d'événements appliqués
  world: WorldSnapshot | null;
  playing: boolean;
  speed: number;
  time: string | null;
  start: (base: WorldSnapshot) => Promise<void>;
  stop: () => void;
  seek: (index: number) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
}

export function useReplay(): ReplayState {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const base = useRef<WorldSnapshot | null>(null);
  const checkpoints = useRef<WorldSnapshot[]>([]);

  const start = useCallback(async (snapshot: WorldSnapshot) => {
    setLoading(true);
    setActive(true);
    setLoadError(null);
    const all: DomainEvent[] = [];
    let after = 0;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const { data, meta } = await api<unknown[]>(`/v1/events?afterSeq=${after}&limit=500`);
        for (const raw of data) all.push(DomainEventSchema.parse(raw));
        after = all.at(-1)?.seq ?? after;
        if (!meta['hasMore']) break;
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'journal indisponible');
      setLoading(false);
      return;
    }
    // Points de reprise réguliers : déplacement instantané dans la frise.
    const empty = emptyFrom(snapshot);
    const cps: WorldSnapshot[] = [empty];
    let w = empty;
    all.forEach((e, i) => {
      w = applyEvent(w, e).world;
      if ((i + 1) % CHECKPOINT_EVERY === 0) cps.push(w);
    });
    base.current = empty;
    checkpoints.current = cps;
    setEvents(all);
    setIndex(Math.min(all.length, 1));
    setPlaying(false);
    setLoading(false);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setPlaying(false);
    setEvents([]);
    setIndex(0);
  }, []);

  const world = useMemo<WorldSnapshot | null>(() => {
    if (!active || !base.current) return null;
    const cpIdx = Math.floor(index / CHECKPOINT_EVERY);
    let w = checkpoints.current[Math.min(cpIdx, checkpoints.current.length - 1)] ?? base.current;
    for (
      let i = Math.min(cpIdx, checkpoints.current.length - 1) * CHECKPOINT_EVERY;
      i < index;
      i++
    ) {
      const e = events[i];
      if (e) w = applyEvent(w, e).world;
    }
    return w;
  }, [active, index, events]);

  // Lecture : avance au rythme réel des événements (accéléré, écarts plafonnés).
  useEffect(() => {
    if (!active || !playing) return;
    if (index >= events.length) {
      setPlaying(false);
      return;
    }
    const cur = events[index - 1];
    const next = events[index];
    const gap = cur && next ? Date.parse(next.occurredAt) - Date.parse(cur.occurredAt) : 300;
    const delay = Math.min(1500, Math.max(60, gap / speed));
    const t = setTimeout(() => setIndex((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [active, playing, index, events, speed]);

  const time = events[index - 1]?.occurredAt ?? null;
  return {
    active,
    loading,
    loadError,
    events,
    index,
    world,
    playing,
    speed,
    time,
    start,
    stop,
    seek: (i) => setIndex(Math.max(0, Math.min(events.length, i))),
    togglePlay: () => setPlaying((p) => !p),
    setSpeed,
  };
}
