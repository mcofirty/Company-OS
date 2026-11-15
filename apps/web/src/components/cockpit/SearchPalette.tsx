'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import type { Selection } from '../../world/HqScene';

interface Item {
  sel: Selection;
  label: string;
  sub: string;
  kind: string;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Recherche globale Ctrl/Cmd+K (docs/01 §9) : agents, tâches, outils, départements, validations. */
export function SearchPalette({
  world,
  onSelect,
  onClose,
}: {
  world: WorldSnapshot;
  onSelect: (s: Selection) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const dept = (id: string): string => world.departments.find((d) => d.id === id)?.name ?? id;
    return [
      ...world.agents.map((a) => ({
        sel: { kind: 'agent' as const, id: a.id },
        label: a.name,
        sub: `${a.title} · ${dept(a.departmentId)}`,
        kind: 'Agent',
      })),
      ...world.departments.map((d) => ({
        sel: { kind: 'department' as const, id: d.id },
        label: d.name,
        sub: 'Département',
        kind: 'Service',
      })),
      ...world.tools.map((t) => ({
        sel: { kind: 'tool' as const, id: t.id },
        label: t.name,
        sub: `${t.code} · ${t.category}`,
        kind: 'Outil',
      })),
      ...world.tasks.map((t) => ({
        sel: { kind: 'task' as const, id: t.id },
        label: t.title,
        sub: `${world.agents.find((a) => a.id === t.agentId)?.name ?? t.agentId} · ${t.status}`,
        kind: 'Tâche',
      })),
      ...world.approvals.map((a) => ({
        sel: { kind: 'approval' as const, id: a.id },
        label:
          a.kind === 'agent_hire'
            ? 'Validation : nouvel agent'
            : `Validation : ${a.toolId}.${a.action}`,
        sub: a.status,
        kind: 'Validation',
      })),
    ];
  }, [world]);

  const results = useMemo(() => {
    const n = norm(q.trim());
    const list = n
      ? items.filter((i) => norm(`${i.label} ${i.sub} ${i.kind}`).includes(n))
      : items.slice(0, 12);
    return list.slice(0, 30);
  }, [items, q]);

  const choose = (i: Item | undefined): void => {
    if (!i) return;
    onSelect(i.sel);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Recherche"
      onClick={onClose}
    >
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          placeholder="Rechercher un agent, une tâche, un outil… (Échap pour fermer)"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            else if (e.key === 'Enter') choose(results[cursor]);
            else if (e.key === 'Escape') onClose();
          }}
          data-testid="search-input"
          aria-label="Recherche globale"
        />
        <ul role="listbox">
          {results.length === 0 && <li className="empty">Aucun résultat.</li>}
          {results.map((r, i) => (
            <li key={`${r.sel.kind}:${r.sel.id}`}>
              <button
                role="option"
                aria-selected={i === cursor}
                className={i === cursor ? 'active' : ''}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(r)}
                data-testid="search-result"
              >
                <span className="kind">{r.kind}</span>
                <strong>{r.label}</strong>
                <span className="muted">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
