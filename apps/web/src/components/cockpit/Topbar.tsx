'use client';

import { useState, type ReactNode } from 'react';
import { DEMO_TASK_CATALOG, type TaskKind, type WorldSnapshot } from '@company-os/contracts';
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
}: {
  world: WorldSnapshot | null;
  connection: ConnectionState;
  metrics: MetricsSummary | null;
  metricsWindow: MetricsWindow;
  onMetricsWindow: (w: MetricsWindow) => void;
  onCreateTask: (kind: TaskKind) => Promise<void>;
  onSystem: (pause: boolean) => Promise<void>;
  alerts: ReactNode;
  onSearch: () => void;
}) {
  const { caps, readOnly } = useControls();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = world ? computeMetrics(world) : null;
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
          title="Simulation déterministe côté serveur : aucune action externe, aucun appel LLM."
        >
          <strong>{world.org.mode === 'demo' ? 'DEMO' : 'LIVE'}</strong>
          <span>
            {world.org.mode === 'demo'
              ? 'activité simulée · aucun effet réel'
              : 'exécutions réelles'}
          </span>
        </div>
      )}
      <div className="kpis" data-testid="kpis">
        <Kpi
          label="Agents actifs"
          value={m?.activeAgents}
          sub={m ? `${m.busyAgents} occupés` : ''}
        />
        <Kpi
          label="Tâches en cours"
          value={m ? m.tasksRunning + m.tasksQueued : undefined}
          sub={m ? `${m.tasksRunning} actives · ${m.tasksQueued} en file` : ''}
          testId="kpi-tasks"
        />
        <Kpi
          label="Outils actifs"
          value={m?.activeInvocations}
          sub={m ? `${m.activeToolIds.length} outil(s)` : ''}
          testId="kpi-tools"
        />
        <Kpi
          label="Approbations"
          value={m?.pendingApprovals}
          sub={m ? `en attente · ${m.activeMeetings} réunion(s)` : ''}
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
          testId="kpi-cost"
        />
        <Kpi
          label="Incidents"
          value={m?.incidents}
          sub="bloqués / échecs"
          tone={m && m.incidents > 0 ? 'danger' : undefined}
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
        {caps.createTask && (
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
                {(Object.keys(DEMO_TASK_CATALOG) as TaskKind[]).map((k) => (
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
}: {
  label: string;
  value: number | string | undefined;
  sub: string;
  tone?: string;
  testId?: string;
}) {
  return (
    <div className={`kpi ${tone ? `tone-${tone}` : ''}`} data-testid={testId}>
      <span className="kpi-value">{value ?? '—'}</span>
      <span className="kpi-label">{label}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}
