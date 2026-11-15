'use client';

import { useState } from 'react';
import { DEMO_TASK_CATALOG, type TaskKind, type WorldSnapshot } from '@company-os/contracts';
import { computeMetrics } from '@company-os/world';
import type { ConnectionState } from '../../lib/useHq';
import { usd } from '../../lib/format';

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
  onCreateTask,
  onSystem,
}: {
  world: WorldSnapshot | null;
  connection: ConnectionState;
  onCreateTask: (kind: TaskKind) => Promise<void>;
  onSystem: (pause: boolean) => Promise<void>;
}) {
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
      </div>
      <div className="topbar-actions">
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
        {world && (
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
        <span className={`conn conn-${connection}`} data-testid="connection">
          <span className="dot" /> {CONN[connection]}
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
