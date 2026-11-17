'use client';

import { useMemo, useState } from 'react';
import {
  ACTIVE_INVOCATION_STATUSES,
  type InvocationView,
  type ToolView,
  type WorldSnapshot,
} from '@company-os/contracts';
import { appItems, isAppActive, matches, type AppItem } from '../../lib/appItems';
import { duration, INVOCATION_STATUS_LABEL } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { AppIcon } from './AppIcon';

/**
 * Barre d'applications : chaque application connectée, son logo s'illumine quand un agent
 * l'utilise (invocation réelle en cours ; pour Claude : un agent réfléchit). Un clic montre les
 * tâches en cours et récentes sur cette application.
 */
export function AppBar({
  world,
  now,
  onSelect,
  onConnect,
  canConnect,
  max = 9,
}: {
  world: WorldSnapshot;
  now: number;
  onSelect: (s: Selection) => void;
  onConnect: () => void;
  canConnect: boolean;
  max?: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const items = useMemo(() => appItems(world), [world]);
  const active = world.invocations.filter((i) => ACTIVE_INVOCATION_STATUSES.includes(i.status));
  const thinking = world.agents.filter((a) => a.activity === 'working');
  const isOn = (it: AppItem) => isAppActive(it, active, world.agents);
  // Les applications actives passent devant.
  const sorted = [...items].sort((a, b) => Number(isOn(b)) - Number(isOn(a)));
  const shown = sorted.slice(0, max);
  const hidden = sorted.length - shown.length;
  const current = items.find((i) => i.key === open);
  const agentName = (id: string) => world.agents.find((a) => a.id === id)?.name ?? id;
  const taskTitle = (id: string) => world.tasks.find((t) => t.id === id)?.title ?? 'mission';

  return (
    <div
      className="app-bar"
      role="toolbar"
      aria-label="Applications connectées"
      data-testid="app-bar"
    >
      {shown.map((it) => {
        const on = isOn(it);
        return (
          <button
            key={it.key}
            className={`app-btn ${on ? 'on' : ''} ${open === it.key ? 'open' : ''}`}
            style={{ ['--glow' as string]: it.preset?.color ?? it.color }}
            title={`${it.name}${on ? ' — en cours d’utilisation' : ''}`}
            aria-pressed={open === it.key}
            onClick={() => setOpen(open === it.key ? null : it.key)}
            data-testid={`app-${it.key}`}
            data-active={on ? 'true' : 'false'}
          >
            <AppIcon app={it.preset} name={it.name} color={it.color} size={30} />
          </button>
        );
      })}
      {hidden > 0 && (
        <button className="app-more" onClick={onConnect} title="Toutes les applications">
          +{hidden}
        </button>
      )}
      {canConnect && (
        <button
          className="app-more add"
          onClick={onConnect}
          title="Connecter une application"
          data-testid="app-connect"
        >
          ＋
        </button>
      )}
      {current && (
        <AppPopover
          item={current}
          world={world}
          now={now}
          thinking={thinking.map((a) => a.id)}
          agentName={agentName}
          taskTitle={taskTitle}
          onSelect={(s) => {
            onSelect(s);
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function AppPopover({
  item,
  world,
  now,
  thinking,
  agentName,
  taskTitle,
  onSelect,
  onClose,
}: {
  item: AppItem;
  world: WorldSnapshot;
  now: number;
  thinking: string[];
  agentName: (id: string) => string;
  taskTitle: (id: string) => string;
  onSelect: (s: Selection) => void;
  onClose: () => void;
}) {
  const invs = world.invocations.filter((i) => matches(item, i));
  const active = invs.filter((i) => ACTIVE_INVOCATION_STATUSES.includes(i.status));
  const recent = invs
    .filter((i) => !ACTIVE_INVOCATION_STATUSES.includes(i.status))
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''))
    .slice(0, 5);
  const tool: ToolView | undefined = world.tools.find((t) => t.id === item.toolId);
  const row = (i: InvocationView) => (
    <li key={i.id}>
      <button className="link-row" onClick={() => onSelect({ kind: 'task', id: i.taskId })}>
        <span
          className={`status-dot st-${i.status === 'succeeded' ? 'succeeded' : ACTIVE_INVOCATION_STATUSES.includes(i.status) ? 'running' : 'failed'}`}
        />
        <span className="grow">
          <strong>{agentName(i.agentId)}</strong> · {i.action}
          <span className="muted small"> — {taskTitle(i.taskId)}</span>
        </span>
        <span className="muted small">
          {ACTIVE_INVOCATION_STATUSES.includes(i.status)
            ? duration(now - Date.parse(i.startedAt ?? i.requestedAt))
            : INVOCATION_STATUS_LABEL[i.status]}
        </span>
      </button>
    </li>
  );
  return (
    <div className="app-pop" role="dialog" aria-label={item.name} data-testid="app-popover">
      <header>
        <AppIcon app={item.preset} name={item.name} color={item.color} size={26} />
        <strong>{item.name}</strong>
        <span className="muted small">{item.preset?.description ?? tool?.name ?? ''}</span>
        <button className="linklike" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </header>
      {item.toolId === null ? (
        <>
          <h4>Agents en train de réfléchir</h4>
          {thinking.length === 0 ? (
            <p className="muted small">Aucun en ce moment.</p>
          ) : (
            <ul className="plain-list">
              {thinking.map((id) => (
                <li key={id}>
                  <button className="link-row" onClick={() => onSelect({ kind: 'agent', id })}>
                    <span className="status-dot st-running" />
                    <span className="grow">{agentName(id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h4>En cours ({active.length})</h4>
          {active.length === 0 ? (
            <p className="muted small">Aucune tâche n’utilise {item.name} en ce moment.</p>
          ) : (
            <ul className="plain-list">{active.map(row)}</ul>
          )}
          {recent.length > 0 && (
            <>
              <h4>Récemment</h4>
              <ul className="plain-list">{recent.map(row)}</ul>
            </>
          )}
          {tool && (
            <button
              className="btn small-btn"
              onClick={() => onSelect({ kind: 'tool', id: tool.id })}
            >
              Fiche de l’outil
            </button>
          )}
        </>
      )}
    </div>
  );
}
