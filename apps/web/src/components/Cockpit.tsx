'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskKind } from '@company-os/contracts';
import { ApiFailure } from '../lib/api';
import { useHq } from '../lib/useHq';
import type { HqScene, Selection } from '../world/HqScene';
import { Timeline } from './cockpit/Timeline';
import { Topbar } from './cockpit/Topbar';
import { Inspector, TeamRows } from './panels/Inspector';
import { ToolWall } from './panels/ToolWall';

const WorldViewport = dynamic(
  () => import('./cockpit/WorldViewport').then((m) => m.WorldViewport),
  {
    ssr: false,
    loading: () => <div className="world-canvas world-loading">Chargement du QG…</div>,
  },
);

/** Écran unique (docs/01 §3) : carte dominante, KPI, outils, inspecteur, timeline. */
export function Cockpit() {
  const { world, connection, error, toasts, now, createTask, toast } = useHq();
  const [selection, setSelection] = useState<Selection | null>(null);
  const scene = useRef<HqScene | null>(null);

  const select = useCallback((s: Selection | null) => setSelection(s), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onCreateTask = useCallback(
    async (kind: TaskKind, agentId?: string) => {
      try {
        const task = await createTask(kind, agentId);
        toast({ text: `Tâche créée : ${task.title}`, tone: 'success' });
        setSelection({ kind: 'task', id: task.id });
      } catch (err) {
        const msg = err instanceof ApiFailure ? `${err.code} · ${err.message}` : 'Erreur inconnue';
        toast({ text: `Refusé : ${msg}`, tone: 'danger' });
      }
    },
    [createTask, toast],
  );

  return (
    <div className="cockpit">
      <Topbar world={world} connection={connection} onCreateTask={(k) => onCreateTask(k)} />
      <nav className="rail" aria-label="Contrôles de la carte">
        <button
          onClick={() => scene.current?.home()}
          title="Recentrer (double-clic sur la carte)"
          aria-label="Recentrer"
        >
          ⌂
        </button>
        <button
          onClick={() => scene.current?.zoomBy(1.2)}
          title="Zoom avant"
          aria-label="Zoom avant"
        >
          +
        </button>
        <button
          onClick={() => scene.current?.zoomBy(1 / 1.2)}
          title="Zoom arrière"
          aria-label="Zoom arrière"
        >
          −
        </button>
        <button
          onClick={() => setSelection(null)}
          title="Équipe (liste)"
          aria-label="Afficher l’équipe"
        >
          ☰
        </button>
      </nav>
      <main className="world-pane">
        {error && connection === 'error' && (
          <div className="error-banner" role="alert">
            API indisponible : {error}. Vérifiez <code>pnpm dev</code> et la base.
          </div>
        )}
        <WorldViewport
          world={world}
          selection={selection}
          now={now}
          onSelect={select}
          onReady={(s) => (scene.current = s)}
        />
        <div className="legend" aria-hidden>
          <span>Glisser : déplacer · Molette : zoom · Double-clic : recentrer</span>
        </div>
      </main>
      <aside className="side">
        <div className="side-top">
          {world && selection ? (
            <Inspector
              world={world}
              selection={selection}
              now={now}
              onSelect={select}
              onCreateTask={onCreateTask}
              onFocus={(id) => scene.current?.focusAgent(id)}
            />
          ) : (
            <section className="panel" aria-label="Équipe">
              <header className="panel-head">
                <h2>Équipe</h2>
                <span className="muted">
                  {world?.agents.length ?? 0} agents · cliquez pour inspecter
                </span>
              </header>
              {world && <TeamRows agents={world.agents} world={world} onSelect={select} />}
            </section>
          )}
        </div>
        <ToolWall world={world} now={now} onSelect={select} />
      </aside>
      <Timeline world={world} onSelect={select} />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast tone-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
