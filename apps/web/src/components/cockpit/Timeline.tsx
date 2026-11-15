'use client';

import { useState } from 'react';
import type { DomainEvent, WorldSnapshot } from '@company-os/contracts';
import { describe, eventTarget, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';

const HIDDEN = new Set(['agent.run.started', 'agent.run.completed', 'tool.invocation.requested']);
const FILTERS: Record<string, (t: string) => boolean> = {
  all: () => true,
  task: (t) => t.startsWith('task.'),
  tool: (t) => t.startsWith('tool.'),
  governance: (t) =>
    t.startsWith('approval.') || t.startsWith('system.') || t.startsWith('budget.'),
  agent: (t) => t.startsWith('agent.') || t.startsWith('meeting.'),
};
const FILTER_LABEL: Record<string, string> = {
  all: 'Tout',
  task: 'Tâches',
  tool: 'Outils',
  governance: 'Gouvernance',
  agent: 'Agents & réunions',
};

const agentOf = (e: DomainEvent): string | undefined => (e.payload as { agentId?: string }).agentId;

export function Timeline({
  world,
  onSelect,
  dept,
}: {
  world: WorldSnapshot | null;
  onSelect: (s: Selection) => void;
  dept?: string | null;
}) {
  const [filter, setFilter] = useState('all');
  const deptAgents = dept
    ? new Set(world?.agents.filter((a) => a.departmentId === dept).map((a) => a.id))
    : null;
  const match = FILTERS[filter] ?? FILTERS.all!;
  const events = (world?.timeline ?? []).filter(
    (e) =>
      !HIDDEN.has(e.type) &&
      match(e.type) &&
      (!deptAgents || (agentOf(e) !== undefined && deptAgents.has(agentOf(e)!))),
  );
  return (
    <section className="timeline" aria-label="Timeline des événements">
      <header>
        <h2>Timeline live</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrer la timeline par type"
          data-testid="timeline-filter"
        >
          {Object.keys(FILTERS).map((k) => (
            <option key={k} value={k}>
              {FILTER_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="muted">journal serveur · seq #{world?.lastSeq ?? 0}</span>
      </header>
      <ol data-testid="timeline">
        {events.length === 0 && <li className="empty">Aucun événement pour l’instant.</li>}
        {events.map((e) => {
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
    </section>
  );
}
