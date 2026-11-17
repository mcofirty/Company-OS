'use client';

import { useMemo, useState } from 'react';
import type { DomainEvent, TaskView, WorldSnapshot } from '@company-os/contracts';
import { describe, eventTarget, TASK_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';

const HIDDEN = new Set(['agent.run.started', 'agent.run.completed', 'tool.invocation.requested']);
const TASK_TYPES = /^(task\.|tool\.invocation\.|approval\.|meeting\.)/;
type Filter = 'all' | 'missions' | 'org' | 'alerts';
const FILTER_LABEL: Record<Filter, string> = {
  all: 'Tout',
  missions: 'Missions',
  org: 'Organisation',
  alerts: 'À surveiller',
};
const STATUS_ICON: Record<string, string> = {
  succeeded: '✓',
  failed: '✕',
  blocked: '!',
  cancelled: '⊘',
  running: '▶',
  waiting_approval: '⏳',
  queued: '…',
  created: '…',
};
const STATUS_TONE: Record<string, string> = {
  succeeded: 'success',
  failed: 'danger',
  blocked: 'danger',
  cancelled: 'neutral',
  running: 'accent',
  waiting_approval: 'warning',
  queued: 'neutral',
  created: 'neutral',
};

const agentOf = (e: DomainEvent): string | undefined => (e.payload as { agentId?: string }).agentId;
const taskOf = (e: DomainEvent): string | undefined => (e.payload as { taskId?: string }).taskId;

type Row =
  | { kind: 'mission'; key: string; task: TaskView | null; events: DomainEvent[] }
  | { kind: 'event'; key: string; event: DomainEvent };

/**
 * Fil d'activité : les événements d'une même MISSION sont regroupés en une ligne lisible
 * (« Yanis — Présélection : terminée ✓ · 3 actions »), le détail technique se déplie. Les
 * événements d'organisation (agents, budgets, connecteurs…) restent des lignes simples.
 */
export function ActivityFeed({
  world,
  onSelect,
  dept,
}: {
  world: WorldSnapshot | null;
  onSelect: (s: Selection) => void;
  dept?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    if (!world) return [] as Row[];
    const deptAgents = dept
      ? new Set(world.agents.filter((a) => a.departmentId === dept).map((a) => a.id))
      : null;
    const tasks = new Map(world.tasks.map((t) => [t.id, t]));
    const byCorr = new Map<string, Row & { kind: 'mission' }>();
    const out: Row[] = [];
    const withTask = new Set(world.timeline.filter((e) => taskOf(e)).map((e) => e.correlationId));
    for (const e of world.timeline) {
      if (HIDDEN.has(e.type)) continue;
      const a = agentOf(e);
      if (deptAgents && (!a || !deptAgents.has(a))) continue;
      // Réunion convoquée par l'humain (sans mission) : ligne simple, pas un groupe « mission ».
      const standaloneMeeting = e.type.startsWith('meeting.') && !withTask.has(e.correlationId);
      if (TASK_TYPES.test(e.type) && !standaloneMeeting) {
        let g = byCorr.get(e.correlationId);
        if (!g) {
          g = { kind: 'mission', key: e.correlationId, task: null, events: [] };
          byCorr.set(e.correlationId, g);
          out.push(g);
        }
        g.events.push(e);
        const tid = taskOf(e);
        if (tid && !g.task && tasks.get(tid)) g.task = tasks.get(tid)!;
        if (tid && !g.task && e.type === 'task.created') {
          const p = e.payload as { title?: string };
          g.task = {
            id: tid,
            title: p.title ?? 'Mission',
            status: 'queued',
            agentId: a ?? '',
          } as TaskView;
        }
      } else {
        out.push({ kind: 'event', key: e.eventId, event: e });
      }
    }
    return out;
  }, [world, dept]);

  const shown = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'missions') return r.kind === 'mission';
    if (filter === 'org') return r.kind === 'event';
    // À surveiller : missions bloquées / échouées / en attente, et alertes d'organisation.
    if (r.kind === 'mission')
      return ['blocked', 'failed', 'waiting_approval'].includes(r.task?.status ?? '');
    return /blocked|failed|threshold|paused|skipped|error/.test(
      `${r.event.type} ${JSON.stringify(r.event.payload)}`,
    );
  });

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <section className="timeline feed" aria-label="Fil d’activité">
      <header>
        <h2>Fil d’activité</h2>
        <div className="seg small" role="tablist">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((k) => (
            <button
              key={k}
              className={filter === k ? 'on' : ''}
              onClick={() => setFilter(k)}
              data-testid={`feed-filter-${k}`}
            >
              {FILTER_LABEL[k]}
            </button>
          ))}
        </div>
        <span className="muted">journal serveur · seq #{world?.lastSeq ?? 0}</span>
      </header>
      <ol data-testid="timeline">
        {shown.length === 0 && <li className="empty">Rien pour l’instant.</li>}
        {shown.map((r) => {
          if (r.kind === 'event') {
            const e = r.event;
            const d = describe(e, world);
            return (
              <li key={r.key}>
                <button
                  className={`tl-item tone-${d.tone}`}
                  onClick={() => onSelect(eventTarget(e))}
                  title={`seq #${e.seq} · ${e.type}`}
                >
                  <span className="tl-icon" aria-hidden>
                    {d.icon}
                  </span>
                  <span className="tl-time">{time(e.occurredAt)}</span>
                  <span className="tl-text">{d.text}</span>
                </button>
              </li>
            );
          }
          const latest = r.events[0]!;
          const status = r.task?.status ?? 'running';
          const agent = world?.agents.find((a) => a.id === (r.task?.agentId ?? agentOf(latest)));
          const actions = r.events.filter((e) => e.type.startsWith('tool.invocation.')).length;
          const isOpen = open.has(r.key);
          const last = describe(latest, world);
          return (
            <li key={r.key} className={`feed-group ${isOpen ? 'open' : ''}`}>
              <div className={`feed-head tone-${STATUS_TONE[status] ?? 'neutral'}`}>
                <button
                  className="feed-toggle"
                  aria-expanded={isOpen}
                  aria-label="Détail technique"
                  onClick={() => toggle(r.key)}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                <button
                  className="feed-main"
                  onClick={() => r.task && onSelect({ kind: 'task', id: r.task.id })}
                >
                  <span className="tl-icon" aria-hidden>
                    {STATUS_ICON[status] ?? '•'}
                  </span>
                  <span className="tl-time">{time(latest.occurredAt)}</span>
                  <span className="feed-title">
                    <strong>{agent?.name ?? 'Agent'}</strong> — {r.task?.title ?? 'Mission'}
                  </span>
                  <span className={`feed-status st-${status}`}>
                    {TASK_STATUS_LABEL[status as TaskView['status']] ?? status}
                  </span>
                  {actions > 0 && <span className="muted small">{actions} action(s)</span>}
                  <span className="feed-last muted small">{last.text}</span>
                </button>
              </div>
              <ol className="feed-details" hidden={!isOpen}>
                {r.events.map((e) => {
                  const d = describe(e, world);
                  return (
                    <li key={e.eventId}>
                      <button
                        className={`tl-item tone-${d.tone}`}
                        onClick={() => onSelect(eventTarget(e))}
                        title={`seq #${e.seq} · ${e.type}`}
                      >
                        <span className="tl-icon" aria-hidden>
                          {d.icon}
                        </span>
                        <span className="tl-time">{time(e.occurredAt)}</span>
                        <span className="tl-text">{d.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
