'use client';

import { useState, type ReactNode } from 'react';
import {
  DEMO_TASK_CATALOG,
  type DemoTaskKind,
  type TaskKind,
  type WorldSnapshot,
} from '@company-os/contracts';
import { computeMetrics } from '@company-os/world';
import type { ConnectionState } from '../../lib/useHq';
import { usd } from '../../lib/format';
import { useControls } from '../../lib/controls';
import type { MetricsSummary, MetricsWindow } from '../../lib/useMetrics';

const CONN: Record<ConnectionState, string> = {
  connecting: 'Connexion…',
  live: 'Temps réel',
  reconnecting: 'Reconnexion…',
  resyncing: 'Resynchronisation…',
  error: 'Hors ligne',
};

export function Topbar({
  world,
  connection,
  metrics,
  metricsWindow,
  onMetricsWindow,
  onCreateTask,
  onSystem,
  alerts,
  onSearch,
  orgSwitcher,
  onMission,
  onKpi,
}: {
  /** Clic sur un indicateur : ouvre la liste correspondante. */
  onKpi?: (
    k: 'agents' | 'tasks' | 'tools' | 'approvals' | 'cost' | 'incidents' | 'success',
  ) => void;
  world: WorldSnapshot | null;
  connection: ConnectionState;
  metrics: MetricsSummary | null;
  metricsWindow: MetricsWindow;
  onMetricsWindow: (w: MetricsWindow) => void;
  onCreateTask: (kind: TaskKind) => Promise<void>;
  onSystem: (pause: boolean) => Promise<void>;
  alerts: ReactNode;
  onSearch: () => void;
  /** Sélecteur d'organisation (démo / live), absent s'il n'y en a qu'une. */
  orgSwitcher?: ReactNode;
  /** Organisation live : ouvre le formulaire de mission libre. */
  onMission?: () => void;
}) {
  const { caps, readOnly } = useControls();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = world ? computeMetrics(world, Date.now()) : null;
  const run = async (kind: TaskKind): Promise<void> => {
    setBusy(true);
    try {
      await onCreateTask(kind);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ▚
        </span>
        Living HQ
      </div>
      {world && (
        <div
          className={`mode-banner mode-${world.org.mode}`}
          data-testid="mode-badge"
          title={
            world.org.mode === 'demo'
              ? 'Simulation déterministe côté serveur : aucune action externe, aucun appel LLM.'
              : 'Missions exécutées par un vrai modèle Claude (coûts réels plafonnés). Outils réels : web, état de l’entreprise, bibliothèque, équipe et vos connecteurs ; toute action externe sensible exige votre validation.'
          }
        >
          <strong>{world.org.mode === 'demo' ? 'DEMO' : 'LIVE'}</strong>
          <span>
            {world.org.mode === 'demo'
              ? 'activité simulée · aucun effet réel'
              : 'modèle réel · outils réels sous vos règles'}
          </span>
        </div>
      )}
      {orgSwitcher}
      <div className="kpis" data-testid="kpis">
        <Kpi
          label="Agents actifs"
          value={m?.activeAgents}
          sub={m ? `${m.busyAgents} occupés` : ''}
          onClick={() => onKpi?.('agents')}
          testId="kpi-agents"
        />
        <Kpi
          label="Missions"
          value={m ? m.tasksRunning + m.tasksQueued : undefined}
          sub={m ? `${m.tasksRunning} actives · ${m.tasksQueued} en file` : ''}
          onClick={() => onKpi?.('tasks')}
          testId="kpi-tasks"
        />
        <Kpi
          label="Outils actifs"
          value={m?.activeInvocations}
          sub={m ? `${m.activeToolIds.length} outil(s)` : ''}
          onClick={() => onKpi?.('tools')}
          testId="kpi-tools"
        />
        <Kpi
          label="Validations"
          value={m?.pendingApprovals}
          sub={m ? 'en attente' : ''}
          onClick={() => onKpi?.('approvals')}
          tone={m && m.pendingApprovals > 0 ? 'warning' : undefined}
          testId="kpi-approvals"
        />
        <Kpi
          label="Coût IA"
          value={m ? usd(m.llmCostMicros) : undefined}
          sub={
            m
              ? m.llmCalls === 0
                ? 'aucun appel LLM'
                : `${m.costEstimated ? 'estimé' : 'mesuré'} · ${m.llmCalls} appel(s)`
              : ''
          }
          onClick={() => onKpi?.('cost')}
          testId="kpi-cost"
        />
        <Kpi
          label="Incidents"
          value={m?.incidents}
          sub="24 h · bloqués / échecs"
          tone={m && m.incidents > 0 ? 'danger' : undefined}
          onClick={() => onKpi?.('incidents')}
          testId="kpi-incidents"
        />
        <div className="kpi kpi-window" data-testid="kpi-success">
          <span className="kpi-value">
            {metrics?.tasks.successRate == null
              ? '—'
              : `${Math.round(metrics.tasks.successRate * 100)} %`}
          </span>
          <span className="kpi-label">
            Succès{' '}
            <select
              value={metricsWindow}
              onChange={(e) => onMetricsWindow(e.target.value as MetricsWindow)}
              aria-label="Fenêtre des indicateurs"
              data-testid="kpi-window"
            >
              <option value="1h">1 h</option>
              <option value="24h">24 h</option>
              <option value="7d">7 j</option>
            </select>
          </span>
          <span className="kpi-sub">
            {metrics
              ? metrics.tasks.sample === 0
                ? 'aucune tâche terminée'
                : `${metrics.tasks.sample} terminée(s)`
              : readOnly
                ? 'replay'
                : ''}
          </span>
        </div>
      </div>
      <div className="topbar-actions">
        <button
          className="btn ghost"
          onClick={onSearch}
          title="Rechercher (Ctrl/Cmd+K)"
          data-testid="open-search"
        >
          ⌕ <kbd>Ctrl K</kbd>
        </button>
        {alerts}
        {world?.org.mode === 'live' && caps.createMission && onMission && (
          <button className="btn primary" onClick={onMission} data-testid="new-mission">
            + Nouvelle mission
          </button>
        )}
        {caps.createTask && world?.org.mode !== 'live' && (
          <div className="menu">
            <button
              className="btn primary"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              data-testid="new-task"
            >
              + Nouvelle tâche
            </button>
            {open && (
              <div className="menu-pop" role="menu">
                {(Object.keys(DEMO_TASK_CATALOG) as DemoTaskKind[]).map((k) => (
                  <button
                    key={k}
                    role="menuitem"
                    disabled={busy}
                    onClick={() => void run(k)}
                    data-testid={`task-${k}`}
                  >
                    <strong>{DEMO_TASK_CATALOG[k].title}</strong>
                    <span>{DEMO_TASK_CATALOG[k].description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {world && caps.systemControl && (
          <button
            className={`btn ${world.system.paused ? 'primary' : 'danger'}`}
            data-testid="kill-switch"
            onClick={() => {
              const pause = !world.system.paused;
              const ok = window.confirm(
                pause
                  ? 'Mettre le système en pause ? Aucune nouvelle exécution ni invocation d’outil ne sera lancée. Les traces sont conservées.'
                  : 'Reprendre l’exécution des agents ?',
              );
              if (ok) void onSystem(pause);
            }}
          >
            {world.system.paused ? '▶ Reprendre' : '■ Pause système'}
          </button>
        )}
        <span
          className={`conn conn-${connection}`}
          data-testid="connection"
          title={CONN[connection]}
        >
          <span className="dot" /> <span className="conn-label">{CONN[connection]}</span>
        </span>
      </div>
    </header>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  testId,
  onClick,
}: {
  label: string;
  value: number | string | undefined;
  sub: string;
  tone?: string;
  testId?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`kpi kpi-btn ${tone ? `tone-${tone}` : ''}`}
      data-testid={testId}
      onClick={onClick}
      title={`${label} — ${sub} (cliquer pour voir le détail)`}
    >
      <span className="kpi-value">{value ?? '—'}</span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-sub">{sub}</span>
    </button>
  );
}

/** Bascule entre organisations accessibles ; recharge le cockpit pour repartir d'un état propre. */
export function OrgSwitcher({
  orgs,
  current,
  onChange,
}: {
  orgs: { id: string; name: string; mode: 'demo' | 'live' }[];
  current: string;
  onChange: (orgId: string) => void;
}) {
  if (orgs.length < 2) return null;
  return (
    <select
      className="org-switcher"
      value={current}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Organisation"
      data-testid="org-switcher"
    >
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.mode === 'live' ? 'LIVE' : 'DEMO'} · {o.name}
        </option>
      ))}
    </select>
  );
}
