'use client';

import { useState } from 'react';
import {
  ACTIVE_INVOCATION_STATUSES,
  type InvocationView,
  type WorldSnapshot,
} from '@company-os/contracts';
import { duration, INVOCATION_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { Empty, ToolIcon } from '../common';

const RISK_RANK: Record<string, number> = { failed: 0, rejected: 0, waiting_approval: 1 };

/**
 * Mur des outils (docs/01 §7, docs/14 §4) : toujours visible. « Actifs » liste les vraies
 * invocations en cours (jamais inventées) ; la durée est calculée depuis l'horodatage persisté.
 */
export function ToolWall({
  world,
  now,
  onSelect,
  dept,
}: {
  world: WorldSnapshot | null;
  now: number;
  onSelect: (s: Selection) => void;
  dept?: string | null;
}) {
  const [tab, setTab] = useState<'active' | 'recent'>('active');
  const deptAgents = dept
    ? new Set(world?.agents.filter((a) => a.departmentId === dept).map((a) => a.id))
    : null;
  const invs = (world?.invocations ?? []).filter((i) => !deptAgents || deptAgents.has(i.agentId));
  const active = invs
    .filter((i) => ACTIVE_INVOCATION_STATUSES.includes(i.status))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const recent = invs
    .filter((i) => !ACTIVE_INVOCATION_STATUSES.includes(i.status))
    .sort(
      (a, b) =>
        (RISK_RANK[a.status] ?? 9) - (RISK_RANK[b.status] ?? 9) ||
        (b.endedAt ?? '').localeCompare(a.endedAt ?? ''),
    )
    .slice(0, 20);
  const list = tab === 'active' ? active : recent;
  // Rien en cours : le panneau se replie à une ligne et rend la place à l'équipe.
  const collapsed = tab === 'active' && active.length === 0;

  return (
    <section
      className={`toolwall ${collapsed ? 'collapsed' : ''}`}
      aria-label="Outils utilisés"
      data-testid="toolwall"
    >
      <header className="toolwall-head">
        <h2>Outils</h2>
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'active'}
            onClick={() => setTab('active')}
            data-testid="tab-active"
          >
            Actifs <span className="count">{active.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'recent'}
            onClick={() => setTab('recent')}
            data-testid="tab-recent"
          >
            Récents <span className="count">{recent.length}</span>
          </button>
        </div>
      </header>
      <div className="toolwall-list">
        {list.length === 0 &&
          (tab === 'active' ? (
            <Empty>
              Aucun outil utilisé actuellement.
              {recent[0] && (
                <>
                  {' '}
                  Dernière action vérifiée :{' '}
                  {world?.tools.find((t) => t.id === recent[0]!.toolId)?.name} ·{' '}
                  {time(recent[0].endedAt ?? recent[0].requestedAt)}
                </>
              )}
            </Empty>
          ) : (
            <Empty>Aucune action terminée.</Empty>
          ))}
        {list.map((i) => (
          <ToolRow key={i.id} inv={i} world={world!} now={now} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

function ToolRow({
  inv,
  world,
  now,
  onSelect,
}: {
  inv: InvocationView;
  world: WorldSnapshot;
  now: number;
  onSelect: (s: Selection) => void;
}) {
  const tool = world.tools.find((t) => t.id === inv.toolId);
  const agent = world.agents.find((a) => a.id === inv.agentId);
  const task = world.tasks.find((t) => t.id === inv.taskId);
  const running = ACTIVE_INVOCATION_STATUSES.includes(inv.status);
  const ms = running ? now - Date.parse(inv.startedAt ?? inv.requestedAt) : (inv.durationMs ?? 0);
  const tone =
    inv.status === 'failed' || inv.status === 'rejected' || inv.status === 'timed_out'
      ? 'danger'
      : inv.status === 'waiting_approval'
        ? 'warning'
        : inv.status === 'succeeded'
          ? 'success'
          : 'accent';
  return (
    <button
      className={`tool-row tone-${tone}`}
      onClick={() => onSelect({ kind: 'invocation', id: inv.id })}
      data-testid="tool-row"
      data-status={inv.status}
    >
      <ToolIcon tool={tool} />
      <span className="tr-main">
        <span className="tr-line1">
          <strong>{tool?.name ?? inv.toolId}</strong>
          <span className={`status-pill tone-${tone}`}>{INVOCATION_STATUS_LABEL[inv.status]}</span>
        </span>
        <span className="tr-line2">
          {agent?.name ?? inv.agentId} · {inv.action}
          <span className="tr-dur">{duration(ms)}</span>
        </span>
        <span className="tr-line3">
          {task?.title ?? 'Tâche'} · {inv.actionKind} · {inv.provenance}
          {inv.errorCode ? ` · ${inv.errorCode}` : ''}
        </span>
      </span>
    </button>
  );
}
