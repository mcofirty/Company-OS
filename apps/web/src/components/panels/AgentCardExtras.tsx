'use client';

import { useState } from 'react';
import type { AgentView, WorldSnapshot } from '@company-os/contracts';
import { api, ApiFailure } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { duration, usd } from '../../lib/format';
import type { Selection } from '../../world/types';
import { ScheduleForm } from '../pages/Schedules';
import { ToolIcon } from '../common';
import { DocViewer, type FullDocument } from './Documents';
import { FollowUp } from './Inspector';

/** Indicateurs réels calculés par le serveur (`GET /v1/agents/:id`, champ `insights`). */
export interface AgentInsights {
  last7d: { succeeded: number; blocked: number };
  avgDurationMs: number | null;
  run: {
    steps: number;
    maxSteps: number;
    startedAt: string;
    model?: string | null;
    modelReason?: string | null;
  } | null;
  collaborators: { agentId: string; count: number }[];
  lastDocument: { id: string; title: string; createdAt: string } | null;
}

const ACTIVE = ['requested', 'authorized', 'running', 'waiting_approval'];

/** Indicateurs : 7 jours, coût IA du mois face au budget, durée moyenne par mission. */
export function AgentStats({
  insights,
  budget,
}: {
  insights: AgentInsights | null;
  budget: { limitMicros: number; usedMicros: number } | null;
}) {
  const pct =
    budget && budget.limitMicros > 0 ? Math.min(1, budget.usedMicros / budget.limitMicros) : 0;
  return (
    <div className="agent-stats" data-testid="agent-stats">
      <div className="stat">
        <span className="stat-label">7 derniers jours</span>
        <span className="stat-value">
          <b className="ok">{insights?.last7d.succeeded ?? '…'}</b> réussie(s)
        </span>
        <span className="stat-sub">
          <b className={insights && insights.last7d.blocked > 0 ? 'bad' : ''}>
            {insights?.last7d.blocked ?? '…'}
          </b>{' '}
          bloquée(s)
        </span>
      </div>
      <div className="stat">
        <span className="stat-label">Coût IA du mois</span>
        {budget ? (
          <>
            <span className="stat-value">
              <b>{usd(budget.usedMicros)}</b> / {usd(budget.limitMicros)}
            </span>
            <span className="stat-bar" aria-label={`${Math.round(pct * 100)} % du budget`}>
              <span style={{ width: `${pct * 100}%` }} className={pct > 0.85 ? 'hot' : ''} />
            </span>
          </>
        ) : (
          <span className="stat-sub">Pas de budget dédié</span>
        )}
      </div>
      <div className="stat">
        <span className="stat-label">Temps moyen / mission</span>
        <span className="stat-value">
          <b>{insights?.avgDurationMs != null ? duration(insights.avgDurationMs) : '—'}</b>
        </span>
        <span className="stat-sub">20 dernières réussies</span>
      </div>
    </div>
  );
}

/** Activité en direct : mission, outil utilisé à l'instant, progression, dernier livrable. */
export function AgentLive({
  world,
  agent,
  insights,
  now,
  onSelect,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  insights: AgentInsights | null;
  now: number;
  onSelect: (s: Selection) => void;
}) {
  const [doc, setDoc] = useState<FullDocument | null>(null);
  const task = world.tasks.find((t) => t.id === agent.currentTaskId);
  const inv = world.invocations.find((i) => i.agentId === agent.id && ACTIVE.includes(i.status));
  const tool = inv ? world.tools.find((t) => t.id === inv.toolId) : undefined;
  const run = insights?.run ?? null;
  const pct = run ? Math.min(1, run.steps / run.maxSteps) : 0;
  const last = insights?.lastDocument ?? null;
  if (!task && !last) return null;
  return (
    <section className="agent-live" data-testid="agent-live">
      {task && (
        <>
          <button className="live-task" onClick={() => onSelect({ kind: 'task', id: task.id })}>
            <span className="live-dot" aria-hidden /> {task.title}
          </button>
          {tool && inv && (
            <button
              className="live-tool"
              onClick={() => onSelect({ kind: 'invocation', id: inv.id })}
              data-testid="agent-live-tool"
            >
              <ToolIcon tool={tool} size={18} /> {tool.name} · {inv.action}
              {inv.status === 'waiting_approval' && <em> — attend ta validation</em>}
            </button>
          )}
          {run && (
            <div className="live-progress" data-testid="agent-live-progress">
              <span className="stat-bar">
                <span style={{ width: `${Math.max(4, pct * 100)}%` }} />
              </span>
              {run.modelReason && (
                <span className="live-model" data-testid="agent-live-model" title={run.model ?? ''}>
                  🧠 {run.modelReason}
                </span>
              )}
              <span className="muted small">
                Étape {run.steps} sur {run.maxSteps} max · depuis{' '}
                {duration(Math.max(0, now - Date.parse(run.startedAt)))}
              </span>
            </div>
          )}
        </>
      )}
      {last && (
        <div className="live-doc">
          <span className="muted small">Dernier livrable</span>
          <button
            className="linklike"
            data-testid="agent-last-doc"
            onClick={() =>
              void api<FullDocument>(`/v1/documents/${last.id}`).then((r) => setDoc(r.data))
            }
          >
            📄 {last.title}
          </button>
        </div>
      )}
      {doc && <DocViewer doc={doc} onClose={() => setDoc(null)} />}
    </section>
  );
}

/** Relations : responsable, équipe directe, collègues avec qui il travaille le plus. */
export function AgentRelations({
  world,
  agent,
  insights,
  onSelect,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  insights: AgentInsights | null;
  onSelect: (s: Selection) => void;
}) {
  const byId = (id: string) => world.agents.find((a) => a.id === id);
  const color = (a: AgentView) => world.departments.find((d) => d.id === a.departmentId)?.color;
  const manager = agent.managerId ? byId(agent.managerId) : undefined;
  const team = world.agents.filter((a) => a.managerId === agent.id && a.status !== 'deactivated');
  const collab = (insights?.collaborators ?? [])
    .map((c) => ({ a: byId(c.agentId), n: c.count }))
    .filter((x): x is { a: AgentView; n: number } => !!x.a);
  const pill = (a: AgentView, extra?: string) => (
    <button
      key={a.id}
      className="rel-pill"
      onClick={() => onSelect({ kind: 'agent', id: a.id })}
      title={`${a.name} · ${a.title}`}
    >
      <i style={{ background: color(a) }} aria-hidden />
      {a.name}
      {extra && <small>{extra}</small>}
    </button>
  );
  if (!manager && team.length === 0 && collab.length === 0) return null;
  return (
    <section className="agent-relations" data-testid="agent-relations">
      {manager && (
        <div className="rel-row">
          <span className="rel-label">Responsable</span>
          {pill(manager)}
        </div>
      )}
      {team.length > 0 && (
        <div className="rel-row">
          <span className="rel-label">Son équipe</span>
          <div className="rel-pills">{team.slice(0, 8).map((a) => pill(a))}</div>
        </div>
      )}
      {collab.length > 0 && (
        <div className="rel-row">
          <span className="rel-label">Travaille avec</span>
          <div className="rel-pills">{collab.map(({ a, n }) => pill(a, `×${n}`))}</div>
        </div>
      )}
    </section>
  );
}

/** Actions rapides : suite, pause / reprise, mission récurrente, duplication. */
export function AgentQuickActions({
  world,
  agent,
  onSelect,
  onLifecycle,
  toast,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  onSelect: (s: Selection) => void;
  onLifecycle: (agentId: string, action: 'pause' | 'resume', reason: string) => Promise<void>;
  toast: (t: { text: string; tone: 'info' | 'danger' | 'success' }) => void;
}) {
  const { caps, readOnly } = useControls();
  const [panel, setPanel] = useState<'none' | 'follow' | 'schedule'>('none');
  const [busy, setBusy] = useState(false);
  const lastDone = world.tasks
    .filter(
      (t) =>
        t.agentId === agent.id &&
        t.endedAt &&
        ['succeeded', 'blocked', 'failed'].includes(t.status),
    )
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))[0];
  const live = world.org.mode === 'live';
  if (readOnly || agent.status === 'deactivated') return null;
  return (
    <section className="agent-quick" data-testid="agent-quick">
      <div className="quick-row">
        {live && lastDone && caps.createMission && (
          <button
            className="quick-btn"
            aria-pressed={panel === 'follow'}
            onClick={() => setPanel(panel === 'follow' ? 'none' : 'follow')}
            data-testid="quick-follow-up"
          >
            ↪ Suite
          </button>
        )}
        {caps.pauseAgent && (
          <button
            className="quick-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              const action = agent.status === 'paused' ? 'resume' : 'pause';
              void onLifecycle(agent.id, action, 'Depuis la fiche de l’agent').finally(() =>
                setBusy(false),
              );
            }}
            data-testid="quick-pause"
          >
            {agent.status === 'paused' ? '▶ Reprendre' : '⏸ Pause'}
          </button>
        )}
        {live && caps.manageSchedules && (
          <button
            className="quick-btn"
            aria-pressed={panel === 'schedule'}
            onClick={() => setPanel(panel === 'schedule' ? 'none' : 'schedule')}
            data-testid="quick-schedule"
          >
            🔁 Récurrente
          </button>
        )}
        {live && caps.createAgent && (
          <button
            className="quick-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              api<{ agentId: string }>(`/v1/agents/${agent.id}/duplicate`, {
                method: 'POST',
                headers: { 'idempotency-key': crypto.randomUUID() },
                body: '{}',
              })
                .then((r) => {
                  toast({ text: `Agent dupliqué : ${agent.name} 2`, tone: 'success' });
                  onSelect({ kind: 'agent', id: r.data.agentId });
                })
                .catch((e: unknown) =>
                  toast({
                    text: `Duplication refusée : ${e instanceof ApiFailure ? e.message : 'erreur'}`,
                    tone: 'danger',
                  }),
                )
                .finally(() => setBusy(false));
            }}
            data-testid="quick-duplicate"
          >
            ⧉ Dupliquer
          </button>
        )}
      </div>
      {panel === 'follow' && lastDone && (
        <div className="quick-panel">
          <p className="muted small">Suite de « {lastDone.title} »</p>
          <FollowUp
            taskId={lastDone.id}
            onCreated={(id) => {
              setPanel('none');
              toast({ text: 'Suite lancée', tone: 'success' });
              onSelect({ kind: 'task', id });
            }}
          />
        </div>
      )}
      {panel === 'schedule' && (
        <div className="quick-panel">
          <ScheduleForm
            world={world}
            agentId={agent.id}
            initial={null}
            onClose={() => setPanel('none')}
            onSaved={() => {
              setPanel('none');
              toast({ text: 'Mission récurrente enregistrée', tone: 'success' });
            }}
          />
        </div>
      )}
    </section>
  );
}
