'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskKind } from '@company-os/contracts';
import { ApiFailure, getBackend, setOrg } from '../lib/api';
import { ControlsContext, controlsFrom } from '../lib/controls';
import { useHq } from '../lib/useHq';
import { useMetrics, type MetricsWindow } from '../lib/useMetrics';
import { useReplay } from '../lib/useReplay';
import type { CameraView, HqWorldView, Selection } from '../world/types';
import { useDisplay } from '../lib/display';
import { WorldControls } from './cockpit/WorldControls';
import { AlertCenter } from './cockpit/AlertCenter';
import { BackendSettings } from './cockpit/BackendSettings';
import { LoginPanel } from './cockpit/LoginPanel';
import { ReplayBar } from './cockpit/ReplayBar';
import { SearchPalette } from './cockpit/SearchPalette';
import { ActivityFeed } from './cockpit/ActivityFeed';
import { MobileView } from './cockpit/MobileView';
import { AppBar } from './cockpit/AppBar';
import { Onboarding, WelcomeBanner } from './cockpit/Welcome';
import { DeliverablesPage } from './pages/Deliverables';
import { MissionsPage, type MissionsTab } from './pages/Missions';
import { SettingsPage, type SettingsSection } from './pages/Settings';
import { applyTheme } from '../lib/theme';
import { OrgSwitcher, Topbar } from './cockpit/Topbar';
import { computeMetrics as metricsFor } from '@company-os/world';
import { AgentForm, MissionForm } from './cockpit/LiveForms';
import { AgentPopover } from './cockpit/AgentPopover';
import { OrgChart } from './cockpit/OrgChart';
import { ConveneMeetingDialog, DepartmentDialog } from './cockpit/OrgDialogs';
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

type View = 'office' | 'org' | 'missions' | 'deliverables' | 'settings';
const VIEWS: [View, string, string, string][] = [
  ['office', 'Bureau', '⌂', 'tab-office'],
  ['org', 'Organigramme', '⑂', 'open-orgchart'],
  ['missions', 'Missions', '☑', 'tab-missions'],
  ['deliverables', 'Livrables', '📄', 'tab-deliverables'],
  ['settings', 'Réglages', '⚙', 'tab-settings'],
];

/** Petit écran (téléphone) : vue simplifiée validations + activité. */
function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 760px)');
    const on = () => setM(q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}

/** Écran unique (docs/01 §3) : carte dominante, KPI, outils, inspecteur, fil d'activité. */
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
  const [deptDialog, setDeptDialog] = useState(false);
  const [conveneOpen, setConveneOpen] = useState(false);
  /** Vue principale : bureau (QG) ou une page. Le QG reste monté (Phaser) sous les pages. */
  const [view, setView] = useState<View>('office');
  const [missionsTab, setMissionsTab] = useState<MissionsTab>('open');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('connectors');
  const [showFormer, setShowFormer] = useState(false);
  const isMobile = useIsMobile();
  useEffect(() => applyTheme(), []);
  // Retour d'une connexion « Se connecter avec … » : message, puis Réglages > Connecteurs.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const status = q.get('connector');
    if (!status) return;
    toast({
      text: q.get('detail') ?? (status === 'ok' ? 'Application connectée' : 'Connexion refusée'),
      tone: status === 'ok' ? 'success' : 'danger',
    });
    setSettingsSection('connectors');
    setView('settings');
    window.history.replaceState(null, '', window.location.pathname);
  }, [toast]);
  /** undefined = fermé ; '' = mission sans agent présélectionné. */
  const [missionFor, setMissionFor] = useState<string | undefined>(undefined);
  const scene = useRef<HqWorldView | null>(null);
  const [display, setDisplay] = useDisplay();
  const [camView, setCamView] = useState<CameraView>('top');
  const [uiHidden, setUiHidden] = useState(false);
  /** Fiches d'agents épinglées (restent ouvertes pour suivre leur travail), 2 au plus. */
  const [pinned, setPinned] = useState<string[]>([]);
  const [sceneReady, setSceneReady] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // En replay, tout l'écran montre l'état reconstruit et rien n'est déclenchable.
  const world = replay.active ? replay.world : hq.world;
  const now = replay.active && replay.time ? Date.parse(replay.time) : hq.now;
  const controls = useMemo(() => controlsFrom(hq.me, replay.active), [hq.me, replay.active]);
  const liveMetrics = useMetrics(metricsWindow, hq.world?.lastSeq, !!hq.world && !replay.active);
  // Les KPI serveur décrivent le présent : masqués pendant un replay pour ne pas mélanger les époques.
  const metrics = replay.active ? null : liveMetrics;

  // La fiche d'un agent s'ouvre toujours à côté de son avatar, dans le bureau.
  const select = useCallback((s: Selection | null) => {
    setSelection(s);
    if (s?.kind === 'agent') setView('office');
  }, []);
  // Équipe : agents en activité ; les anciens (désactivés) sont masqués par défaut.
  const activeAgents = (world?.agents ?? []).filter((a) => a.status !== 'deactivated');
  const formerAgents = (world?.agents ?? []).filter((a) => a.status === 'deactivated');
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setSelection(null);
        setSearchOpen(false);
      } else if (
        (e.key === 'h' || e.key === 'H') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest('input, textarea, select, [contenteditable]')
        )
      ) {
        setUiHidden((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => scene.current?.setHighlight(dept), [dept, sceneReady]);
  useEffect(() => scene.current?.setLinksMode(links), [links, sceneReady]);
  useEffect(() => scene.current?.setNight?.(display.night), [display.night, sceneReady]);
  useEffect(() => scene.current?.setView?.(camView), [camView, sceneReady]);
  useEffect(() => scene.current?.setMotion?.(display.motion), [display.motion, sceneReady]);
  // Une page (Missions, Livrables…) recouvre le bureau : rendu 3D suspendu.
  useEffect(() => scene.current?.setPaused?.(view !== 'office'), [view, sceneReady]);
  const hasWorld = world !== null;
  // Zone libre entre les panneaux flottants : le cadrage du QG l'utilise.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = (): void => {
      if (uiHidden) {
        // Interface masquée : seul la barre de contrôle (en bas) reste.
        const ctrl = el.querySelector('.world-controls')?.getBoundingClientRect();
        scene.current?.setInsets?.({
          top: 12,
          right: 12,
          left: 12,
          bottom: (ctrl?.height ?? 40) + 24,
        });
        return;
      }
      const pane = el.querySelector('.world-pane')?.getBoundingClientRect();
      if (!pane) return;
      const r = (sel: string): DOMRect | null => {
        const n = el.querySelector(sel);
        if (
          !n ||
          getComputedStyle(n).visibility === 'hidden' ||
          getComputedStyle(n).opacity === '0'
        )
          return null;
        return n.getBoundingClientRect();
      };
      const topEls = ['.topbar', '.view-bar .view-tabs', '.filter-bar']
        .map(r)
        .filter(Boolean) as DOMRect[];
      const side = r('.side');
      const feed = r('.feed');
      const rail = r('.rail');
      const ctrl = r('.world-controls');
      const top = Math.max(0, ...topEls.map((b) => b.bottom - pane.top)) + 8;
      const bottom =
        Math.max(0, feed ? pane.bottom - feed.top : 0, ctrl ? pane.bottom - ctrl.top : 0) + 8;
      const right = side ? pane.right - side.left + 8 : 8;
      const left = rail ? rail.right - pane.left + 8 : 8;
      scene.current?.setInsets?.({ top, right, bottom, left });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = window.setTimeout(measure, 450);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [uiHidden, view, sceneReady, display.renderer, hasWorld]);

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

  /** Inspecteur d'un élément ; pour un agent, il est rendu dans la fiche flottante. */
  const inspectorFor = (sel: Selection): ReactNode =>
    world ? (
      <Inspector
        world={world}
        selection={sel}
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
    ) : null;

  return (
    <ControlsContext.Provider value={controls}>
      <div
        ref={root}
        className={`cockpit immersive ${replay.active ? 'is-replay' : ''} ${display.night && display.renderer === '3d' ? 'night' : ''} ${uiHidden ? 'ui-hidden' : ''}`}
        style={{ ['--ga' as string]: display.glass }}
      >
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
              onAckAll={async () => {
                try {
                  await hq.ackAllAlerts();
                } catch (err) {
                  fail(err);
                }
              }}
              now={now}
            />
          }
          onSearch={() => setSearchOpen(true)}
          onKpi={(k) => {
            if (k === 'agents') {
              setView('office');
              setSelection(null);
            } else if (k === 'tasks' || k === 'success') {
              setMissionsTab(k === 'tasks' ? 'open' : 'done');
              setView('missions');
            } else if (k === 'incidents') {
              setMissionsTab('incidents');
              setView('missions');
            } else if (k === 'cost') {
              setSettingsSection('budgets');
              setView('settings');
            } else if (k === 'approvals' || k === 'tools') {
              setView('office');
              setSelection(null);
            }
          }}
        />
        <nav className="rail" aria-label="Contrôles de la carte">
          <span className="rail-title">Carte</span>
          <button
            onClick={() => scene.current?.home()}
            title="Recentrer (double-clic)"
            data-tip="Recentrer (double-clic)"
            aria-label="Recentrer"
          >
            ⌂
          </button>
          <button
            onClick={() => scene.current?.zoomBy(1.2)}
            title="Zoom avant"
            data-tip="Zoom avant"
            aria-label="Zoom avant"
          >
            +
          </button>
          <button
            onClick={() => scene.current?.zoomBy(1 / 1.2)}
            title="Zoom arrière"
            data-tip="Zoom arrière"
            aria-label="Zoom arrière"
          >
            −
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            title="Rechercher (Ctrl/Cmd+K)"
            data-tip="Rechercher (Ctrl/Cmd+K)"
            aria-label="Rechercher"
          >
            ⌕
          </button>
          <button
            onClick={() => setLinks((l) => !l)}
            title="Liens agent → outil"
            data-tip="Liens agent → outil"
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
            title="Historique (replay)"
            data-tip="Historique (replay)"
            aria-label="Replay"
            aria-pressed={replay.active}
            className={replay.active ? 'on' : ''}
            disabled={!hq.world}
            data-testid="toggle-replay"
          >
            ⏮
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
          <div className="view-bar">
            <nav className="view-tabs" aria-label="Navigation">
              {VIEWS.map(([k, label, icon, testId]) => (
                <button
                  key={k}
                  className={view === k ? 'on' : ''}
                  aria-current={view === k ? 'page' : undefined}
                  onClick={() => setView(k)}
                  disabled={!world}
                  data-testid={testId}
                >
                  <span aria-hidden>{icon}</span> {label}
                  {k === 'missions' && world && metricsFor(world, now).incidents > 0 && (
                    <span className="count danger">{metricsFor(world, now).incidents}</span>
                  )}
                </button>
              ))}
            </nav>
            {world && (
              <AppBar
                world={world}
                now={now}
                onSelect={select}
                canConnect={(controls.caps.manageConnectors ?? false) && world.org.mode === 'live'}
                onConnect={() => {
                  setSettingsSection('connectors');
                  setView('settings');
                }}
              />
            )}
          </div>
          {world && view === 'office' && (
            <div
              className="filter-bar"
              role="toolbar"
              aria-label="Filtrer par département"
              data-testid="filter-bar"
            >
              <div className="chips">
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
              {controls.caps.manageDepartments && !replay.active && (
                <button onClick={() => setDeptDialog(true)} data-testid="new-department">
                  ＋ Pôle
                </button>
              )}
              {controls.caps.conveneMeeting && !replay.active && (
                <button
                  className="accent"
                  onClick={() => setConveneOpen(true)}
                  data-testid="convene-meeting"
                  title="Convoquer une réunion avec les agents de votre choix"
                >
                  ◎ Réunion
                </button>
              )}
            </div>
          )}
          <WorldViewport
            world={world}
            selection={selection}
            now={now}
            onSelect={select}
            onEmptyRoom={() => controls.caps.manageDepartments && setDeptDialog(true)}
            renderer={display.renderer}
            onFallback={() => {
              setDisplay({ renderer: '2d' });
              toast({ text: '3D indisponible sur cet appareil : affichage 2D', tone: 'info' });
            }}
            onReady={(s) => {
              scene.current = s;
              setSceneReady((n) => n + 1);
            }}
          />
          {view === 'office' && (
            <WorldControls
              prefs={display}
              onPrefs={setDisplay}
              view={camView}
              onView={setCamView}
              uiHidden={uiHidden}
              onToggleUi={() => setUiHidden((v) => !v)}
            />
          )}
          {world && view === 'office' && !replay.active && (
            <div className="office-overlays">
              <WelcomeBanner
                world={world}
                onMissions={() => {
                  setMissionsTab('done');
                  setView('missions');
                }}
                onDeliverables={() => setView('deliverables')}
                onApprovals={() => setSelection(null)}
              />
              <Onboarding
                world={world}
                canCreate={controls.caps.createAgent}
                onCreateAgent={() => setAgentFormOpen(true)}
                onMission={() => setMissionFor('')}
                onDeliverables={() => setView('deliverables')}
              />
            </div>
          )}
          {world && view === 'org' && (
            <OrgChart
              asPage
              world={world}
              canEdit={(controls.caps.manageHierarchy ?? false) && !replay.active}
              onClose={() => setView('office')}
              onSelect={(sel) => {
                select(sel);
                setView('office');
              }}
            />
          )}
          {world && view === 'missions' && (
            <MissionsPage
              world={world}
              now={now}
              tab={missionsTab}
              onTab={setMissionsTab}
              onSelect={select}
              onNewMission={() => setMissionFor('')}
              toast={toast}
            />
          )}
          {world && view === 'deliverables' && <DeliverablesPage world={world} onSelect={select} />}
          {world && view === 'settings' && (
            <SettingsPage
              world={world}
              section={settingsSection}
              onSection={setSettingsSection}
              onClose={() => setView('office')}
              onBackend={() => setSettingsOpen(true)}
              toast={toast}
            />
          )}
          {world &&
            view === 'office' &&
            !uiHidden &&
            // Fiches épinglées (2 max) + fiche de l'agent sélectionné, chacune à côté de son avatar.
            [
              ...pinned,
              ...(selection?.kind === 'agent' && !pinned.includes(selection.id)
                ? [selection.id]
                : []),
            ]
              .filter((id) => world.agents.some((a) => a.id === id))
              .map((id) => (
                <AgentPopover
                  key={id}
                  world={world}
                  agentId={id}
                  scene={scene}
                  now={now}
                  canEdit={controls.caps.editProfile ?? false}
                  canMission={controls.caps.createMission}
                  onMission={(agentId) => setMissionFor(agentId)}
                  onSelect={select}
                  pinned={pinned.includes(id)}
                  onPin={() =>
                    setPinned((p) =>
                      p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2),
                    )
                  }
                  onClose={() => {
                    setPinned((p) => p.filter((x) => x !== id));
                    if (selection?.kind === 'agent' && selection.id === id) setSelection(null);
                  }}
                  onLifecycle={onLifecycle}
                  toast={toast}
                  details={inspectorFor({ kind: 'agent', id })}
                />
              ))}
          <div className="legend" aria-hidden>
            <span>
              Glisser : déplacer · Molette : zoom · Double-clic : recentrer · Ctrl/Cmd+K :
              rechercher
            </span>
          </div>
        </main>
        <aside className="side">
          {world && (!selection || selection.kind === 'agent') && (
            <ApprovalsInbox world={world} now={now} onSelect={select} />
          )}
          <div className="side-top">
            {world && selection && selection.kind !== 'agent' ? (
              inspectorFor(selection)
            ) : (
              <section className="panel" aria-label="Équipe">
                <header className="panel-head">
                  <h2>Équipe</h2>
                  <span className="muted">
                    {activeAgents.length} actif(s)
                    {formerAgents.length > 0 && (
                      <>
                        {' · '}
                        <button
                          className="linklike"
                          onClick={() => setShowFormer((v) => !v)}
                          data-testid="team-show-former"
                        >
                          {showFormer ? 'masquer les anciens' : `anciens (${formerAgents.length})`}
                        </button>
                      </>
                    )}
                  </span>
                  <button
                    className="btn small-btn"
                    onClick={() => setView('org')}
                    disabled={!world}
                    data-testid="team-orgchart"
                  >
                    ⑂ Organigramme
                  </button>
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
                    agents={(showFormer ? world.agents : activeAgents).filter(
                      (a) => !dept || a.departmentId === dept,
                    )}
                    world={world}
                    onSelect={select}
                  />
                )}
              </section>
            )}
          </div>
          <ToolWall world={world} now={now} onSelect={select} dept={dept} />
        </aside>
        <ActivityFeed world={world} onSelect={select} dept={dept} />
        {isMobile && <MobileView world={world} onDecide={onDecide} onSelect={select} />}
        {searchOpen && world && (
          <SearchPalette world={world} onSelect={select} onClose={() => setSearchOpen(false)} />
        )}
        {settingsOpen && <BackendSettings onClose={() => setSettingsOpen(false)} />}
        {deptDialog && world && (
          <DepartmentDialog world={world} onClose={() => setDeptDialog(false)} toast={toast} />
        )}
        {conveneOpen && world && (
          <ConveneMeetingDialog
            world={world}
            toast={toast}
            onClose={() => setConveneOpen(false)}
            onStarted={(id) => {
              setConveneOpen(false);
              setView('office');
              select({ kind: 'meeting', id });
            }}
          />
        )}
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
