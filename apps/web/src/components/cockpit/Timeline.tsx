'use client';

import type { WorldSnapshot } from '@company-os/contracts';
import { describe, eventTarget, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';

const HIDDEN = new Set(['agent.run.started', 'agent.run.completed', 'tool.invocation.requested']);

export function Timeline({
  world,
  onSelect,
}: {
  world: WorldSnapshot | null;
  onSelect: (s: Selection) => void;
}) {
  const events = (world?.timeline ?? []).filter((e) => !HIDDEN.has(e.type));
  return (
    <section className="timeline" aria-label="Timeline des événements">
      <header>
        <h2>Timeline live</h2>
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
