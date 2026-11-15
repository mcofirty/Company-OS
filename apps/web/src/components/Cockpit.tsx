'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskKind } from '@company-os/contracts';
import { ApiFailure, getBackend, setOrg } from '../lib/api';
import { ControlsContext, controlsFrom } from '../lib/controls';
import { useHq } from '../lib/useHq';
import { useMetrics, type MetricsWindow } from '../lib/useMetrics';
import { useReplay } from '../lib/useReplay';
import type { HqScene, Selection } from '../world/HqScene';
import { AlertCenter } from './cockpit/AlertCenter';
import { BackendSettings } from './cockpit/BackendSettings';
import { LoginPanel } from './cockpit/LoginPanel';
import { ReplayBar } from './cockpit/ReplayBar';
import { SearchPalette } from './cockpit/SearchPalette';
import { Timeline } from './cockpit/Timeline';
import { OrgSwitcher, Topbar } from './cockpit/Topbar';
import { AgentForm, MissionForm } from './cockpit/LiveForms';
import { ApprovalsInbox } from './panels/Governance';
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
  const hq = useHq();
  const { connection, error, toasts, toast } = hq;
  const replay = useReplay();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dept, setDept] = useState<string | null>(null);
  const [links, setLinks] = useState(false);
  const [metricsWindow, setMetricsWindow] = useState<MetricsWindow>('24h');
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  /** undefined = fermé ; '' = mission sans agent présélectionné. */
  const [missionFor, setMissionFor] = useState<string | undefined>(undefined);
  const scene = useRef<HqScene | null>(null);

  // En replay, tout l'écran montre l'état reconstruit et rien n'est déclenchable.
  const world = replay.active ? replay.world : hq.world;
  const now = replay.active && replay.time ? Date.parse(replay.time) : hq.now;
  const controls = useMemo(() => controlsFrom(hq.me, replay.active), [hq.me, replay.active]);
  const liveMetrics = useMetrics(metricsWindow, hq.world?.lastSeq, !!hq.world && !replay.active);
  // Les KPI serveur décrivent le présent : masqués pendant un replay pour ne pas mélanger les époques.
  const metrics = replay.active ? null : liveMetrics;

  const select = useCallback((s: Selection | null) => setSelection(s), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setSelection(null);
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => scene.current?.setHighlight(dept), [dept]);
  useEffect(() => scene.current?.setLinksMode(links), [links]);

  const fail = useCallback(
    (err: unknown) =>
      toast({
        text: `Refusé : ${err instanceof ApiFailure ? `${err.code} · ${err.message}` : 'erreur'}`,
        tone: 'danger',
      }),
    [toast],
  );
  const onCreateTask = useCallback(
    async (kind: TaskKind, agentId?: string) => {
      try {
        const task = await hq.createTask(kind, agentId);
        toast({ text: `Tâche créée : ${task.title}`, tone: 'success' });
        setSelection({ kind: 'task', id: task.id });
      } catch (err) {
        fail(err);
      }
    },
    [hq, toast, fail],
  );
  const onDecide = useCallback(
    async (approvalId: string, decision: 'approve' | 'reject', reason: string) => {
      try {
        await hq.decideApproval(approvalId, decision, reason);
        toast({
          text: decision === 'approve' ? 'Validation accordée' : 'Validation refusée',
          tone: 'success',
        });
      } catch (err) {
        fail(err);
      }
    },
    [hq, toast, fail],
  );
  const onLifecycle = useCallback(
    async (agentId: string, action: 'pause' | 'resume' | 'deactivate', reason: string) => {
      try {
        await hq.agentLifecycle(agentId, action, reason);
      } catch (err) {
        fail(err);
      }
    },
    [hq, fail],
  );

  return (
    <ControlsContext.Provider value={controls}>
      <div className={`cockpit ${replay.active ? 'is-replay' : ''}`}>
        <Topbar
          world={world}
          connection={connection}
          metrics={metrics}
          metricsWindow={metricsWindow}
          onMetricsWindow={setMetricsWindow}
          onCreateTask={(k) => onCreateTask(k)}
          onMission={() => setMissionFor('')}
          orgSwitcher={
            hq.me && !replay.active ? (
              <OrgSwitcher
                orgs={hq.me.orgs}
                current={hq.me.orgId}
                onChange={(id) => {
                  setOrg(id);
                  window.location.reload();
                }}
              />
            ) : null
          }
          onSystem={async (pause) => {
            try {
              await hq.setSystemPaused(pause);
            } catch (err) {
              fail(err);
            }
          }}
          alerts={
            <AlertCenter
              world={world}
              onSelect={select}
              onAck={async (id) => {
                try {
                  await hq.ackAlert(id);
                } catch (err) {
                  fail(err);
                }
              }}
            />
          }
          onSearch={() => setSearchOpen(true)}
        />
        <nav className="rail" aria-label="Contrôles de la carte">
          <button
            onClick={() => scene.current?.home()}
            title="Recentrer (double-clic)"
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
            onClick={() => setSearchOpen(true)}
            title="Rechercher (Ctrl/Cmd+K)"
            aria-label="Rechercher"
          >
            ⌕
          </button>
          <button
            onClick={() => setLinks((l) => !l)}
            title="Liens agent → outil"
            aria-label="Afficher les liens agent vers outil"
            aria-pressed={links}
            className={links ? 'on' : ''}
            data-testid="toggle-links"
          >
            ⇢
          </button>
          <button
            onClick={() =>
              replay.active ? replay.stop() : hq.world && void replay.start(hq.world)
            }
            title="Replay de l'historique"
            aria-label="Replay"
            aria-pressed={replay.active}
            className={replay.active ? 'on' : ''}
            disabled={!hq.world}
            data-testid="toggle-replay"
          >
            ⏮
          </button>
          <button
            onClick={() => setSelection(null)}
            title="Équipe (liste)"
            aria-label="Afficher l’équipe"
          >
            ☰
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Connexion au backend"
            aria-label="Connexion au backend"
          >
            ⚙
          </button>
        </nav>
        <main className="world-pane">
          {replay.active && <ReplayBar replay={replay} />}
          {!replay.active && world?.system.paused && (
            <div className="pause-banner" role="alert" data-testid="pause-banner">
              ■ SYSTÈME EN PAUSE — aucune nouvelle exécution ni invocation d’outil. Les traces
              restent consultables.
            </div>
          )}
          {hq.authNeeded && (
            <LoginPanel
              config={hq.authNeeded.config}
              reason={hq.authNeeded.reason}
              onSettings={() => setSettingsOpen(true)}
            />
          )}
          {error && connection === 'error' && !hq.authNeeded && (
            <div className="error-banner" role="alert" data-testid="backend-offline">
              <strong>Backend non joignable</strong> ({getBackend().url}) : aucune donnée n’est
              affichée, rien n’est simulé dans le navigateur. En local :{' '}
              <code>docker compose up -d</code> puis <code>pnpm dev</code>. À distance : indiquez
              l’URL de votre API et son jeton.{' '}
              <button
                className="btn"
                onClick={() => setSettingsOpen(true)}
                data-testid="open-backend-settings"
              >
                Connexion au backend
              </button>
              <span className="muted"> Détail : {error}</span>
            </div>
          )}
          {world && (
            <div
              className="filter-bar"
              role="toolbar"
              aria-label="Filtrer par département"
              data-testid="filter-bar"
            >
              <button className={dept === null ? 'on' : ''} onClick={() => setDept(null)}>
                Tous
              </button>
              {world.departments.map((d) => (
                <button
                  key={d.id}
                  className={dept === d.id ? 'on' : ''}
                  onClick={() => setDept(dept === d.id ? null : d.id)}
                  data-testid={`filter-${d.id}`}
                >
                  <span className="dot" style={{ background: d.color }} /> {d.name}
                </button>
              ))}
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
            <span>
              Glisser : déplacer · Molette : zoom · Double-clic : recentrer · Ctrl/Cmd+K :
              rechercher
            </span>
          </div>
        </main>
        <aside className="side">
          {world && !selection && <ApprovalsInbox world={world} now={now} onSelect={select} />}
          <div className="side-top">
            {world && selection ? (
              <Inspector
                world={world}
                selection={selection}
                now={now}
                metrics={metrics}
                onSelect={select}
                onCreateTask={onCreateTask}
                onFocus={(id) => scene.current?.focusAgent(id)}
                onDecide={onDecide}
                onLifecycle={onLifecycle}
                onMission={(agentId) => setMissionFor(agentId)}
                onCancelTask={async (taskId, reason) => {
                  try {
                    await hq.cancelTask(taskId, reason);
                    toast({ text: 'Tâche annulée', tone: 'success' });
                  } catch (err) {
                    fail(err);
                  }
                }}
                onRetryTask={async (taskId) => {
                  try {
                    const task = await hq.retryTask(taskId);
                    toast({ text: `Relancée : ${task.title}`, tone: 'success' });
                    setSelection({ kind: 'task', id: task.id });
                  } catch (err) {
                    fail(err);
                  }
                }}
              />
            ) : (
              <section className="panel" aria-label="Équipe">
                <header className="panel-head">
                  <h2>Équipe</h2>
                  <span className="muted">
                    {world?.agents.length ?? 0} agents · cliquez pour inspecter
                  </span>
                  {controls.caps.createAgent && (
                    <button
                      className="btn small-btn"
                      onClick={() => setAgentFormOpen(true)}
                      data-testid="new-agent"
                    >
                      + Agent
                    </button>
                  )}
                </header>
                {world?.org.mode === 'live' && world.agents.length === 0 && (
                  <p className="empty-live" data-testid="live-empty">
                    Organisation LIVE sans agent.{' '}
                    {controls.caps.createAgent
                      ? 'Créez le premier avec « + Agent » : vous choisissez ses outils, ses consignes et son budget.'
                      : 'Un administrateur doit créer les agents.'}
                  </p>
                )}
                {world && (
                  <TeamRows
                    agents={
                      dept ? world.agents.filter((a) => a.departmentId === dept) : world.agents
                    }
                    world={world}
                    onSelect={select}
                  />
                )}
              </section>
            )}
          </div>
          <ToolWall world={world} now={now} onSelect={select} dept={dept} />
        </aside>
        <Timeline world={world} onSelect={select} dept={dept} />
        {searchOpen && world && (
          <SearchPalette world={world} onSelect={select} onClose={() => setSearchOpen(false)} />
        )}
        {settingsOpen && <BackendSettings onClose={() => setSettingsOpen(false)} />}
        {agentFormOpen && world && (
          <AgentForm
            world={world}
            onClose={() => setAgentFormOpen(false)}
            onCreate={async (body, key) => {
              const agentId = await hq.createAgent(body, key);
              toast({ text: `${body.name} rejoint l’équipe (LIVE)`, tone: 'success' });
              setSelection({ kind: 'agent', id: agentId });
            }}
          />
        )}
        {missionFor !== undefined && world && (
          <MissionForm
            world={world}
            {...(missionFor ? { agentId: missionFor } : {})}
            onClose={() => setMissionFor(undefined)}
            onCreate={async (agentId, mission) => {
              const task = await hq.createMission(agentId, mission);
              toast({ text: `Mission lancée : ${task.title}`, tone: 'success' });
              setSelection({ kind: 'task', id: task.id });
            }}
          />
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast tone-${t.tone}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </ControlsContext.Provider>
  );
}
