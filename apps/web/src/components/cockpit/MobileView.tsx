'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { duration, TASK_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/types';
import type { DocumentView, FullDocument } from '../panels/Documents';
import { ActivityFeed } from './ActivityFeed';

type Tab = 'approvals' | 'running' | 'docs' | 'feed';

/**
 * Vue téléphone : valider, suivre une mission, lire un livrable — en deux gestes. Affichée seulement
 * sur petit écran (CSS) ; le QG 3D reste sur ordinateur.
 */
export function MobileView({
  world,
  onDecide,
  onSelect,
}: {
  world: WorldSnapshot | null;
  onDecide: (id: string, d: 'approve' | 'reject', reason: string) => Promise<void>;
  onSelect: (s: Selection) => void;
}) {
  const { caps } = useControls();
  const [tab, setTab] = useState<Tab>('approvals');
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [reading, setReading] = useState<FullDocument | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const pending = (world?.approvals ?? []).filter((a) => a.status === 'pending');
  const running = (world?.tasks ?? []).filter((t) =>
    ['queued', 'running', 'waiting_approval'].includes(t.status),
  );
  const agent = (id: string) => world?.agents.find((a) => a.id === id);
  const lastSeq = world?.lastSeq ?? 0;
  useEffect(() => {
    if (tab !== 'docs') return;
    api<DocumentView[]>('/v1/documents?limit=20')
      .then((r) => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [tab, lastSeq]);
  const now = Date.now();
  const TABS: [Tab, string, number][] = [
    ['approvals', 'À valider', pending.length],
    ['running', 'En cours', running.length],
    ['docs', 'Livrables', 0],
    ['feed', 'Activité', 0],
  ];
  if (reading)
    return (
      <div className="mobile-view mobile-reader" data-testid="mobile-reader">
        <button className="btn" onClick={() => setReading(null)}>
          ← Retour
        </button>
        <h2>{reading.title}</h2>
        <p className="muted small">{time(reading.createdAt)}</p>
        <article className="mobile-doc">{reading.content}</article>
      </div>
    );
  return (
    <div className="mobile-view" data-testid="mobile-view">
      <nav className="mobile-tabs">
        {TABS.map(([k, label, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {n > 0 && <span className={`count ${k === 'approvals' ? 'warn' : ''}`}>{n}</span>}
          </button>
        ))}
      </nav>
      {tab === 'approvals' &&
        (pending.length === 0 ? (
          <p className="muted mobile-empty">Rien à valider. 👍</p>
        ) : (
          <ul className="mobile-cards">
            {pending.map((a) => (
              <li key={a.id}>
                <strong>{agent(a.agentId)?.name ?? a.agentId}</strong>
                <span className="muted small"> · {time(a.requestedAt)}</span>
                <p>{a.riskReason}</p>
                {caps.decideApproval && (
                  <div className="mobile-actions">
                    <button
                      className="btn primary"
                      onClick={() => void onDecide(a.id, 'approve', 'Validé depuis le téléphone')}
                      data-testid="mobile-approve"
                    >
                      ✓ Valider
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => void onDecide(a.id, 'reject', 'Refusé depuis le téléphone')}
                    >
                      ✕ Refuser
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}
      {tab === 'running' &&
        (running.length === 0 ? (
          <p className="muted mobile-empty">Aucune mission en cours.</p>
        ) : (
          <ul className="mobile-cards">
            {running.map((t) => {
              const a = agent(t.agentId);
              const inv = world?.invocations.find(
                (i) =>
                  i.taskId === t.id && ['requested', 'authorized', 'running'].includes(i.status),
              );
              const tool = inv ? world?.tools.find((x) => x.id === inv.toolId) : undefined;
              return (
                <li key={t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <div className="mobile-row">
                    <strong>{t.title}</strong>
                    <span className={`status-pill-sm st-${t.status}`}>
                      {TASK_STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <p className="muted small">
                    {a?.name ?? t.agentId}
                    {t.startedAt ? ` · depuis ${duration(now - Date.parse(t.startedAt))}` : ''}
                    {tool ? ` · 🛠 ${tool.name}` : ''}
                  </p>
                  {open === t.id && (
                    <button className="btn" onClick={() => onSelect({ kind: 'task', id: t.id })}>
                      Voir le détail
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
      {tab === 'docs' &&
        (!docs ? (
          <p className="muted">Chargement…</p>
        ) : docs.length === 0 ? (
          <p className="muted mobile-empty">Aucun livrable pour l’instant.</p>
        ) : (
          <ul className="mobile-cards">
            {docs.map((d) => (
              <li
                key={d.id}
                onClick={() =>
                  void api<FullDocument>(`/v1/documents/${d.id}`).then((r) => setReading(r.data))
                }
              >
                <strong>📄 {d.title}</strong>
                <p className="muted small">
                  {agent(d.agentId)?.name ?? d.agentId} · {time(d.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ))}
      {tab === 'feed' && <ActivityFeed world={world} onSelect={onSelect} />}
    </div>
  );
}
