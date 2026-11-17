'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import { time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import {
  DocViewer,
  downloadDocument,
  type DocumentView,
  type FullDocument,
} from '../panels/Documents';

/** Page « Livrables » : tous les documents produits par les agents (recherche, lecture, export). */
export function DeliverablesPage({
  world,
  onSelect,
}: {
  world: WorldSnapshot;
  onSelect: (s: Selection) => void;
}) {
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [query, setQuery] = useState('');
  const [agent, setAgent] = useState('');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<FullDocument | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api<DocumentView[]>(
        `/v1/documents?limit=200${query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ''}`,
      )
        .then((r) => !cancelled && setDocs(r.data))
        .catch(() => !cancelled && setDocs([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, world.lastSeq]);
  const agents = new Map(world.agents.map((a) => [a.id, a]));
  const shown = (docs ?? []).filter(
    (d) =>
      (!agent || d.agentId === agent) && (!dept || agents.get(d.agentId)?.departmentId === dept),
  );
  return (
    <section className="page" aria-label="Livrables" data-testid="deliverables-page">
      <header className="page-head">
        <h2>Livrables</h2>
        <span className="muted small">documents produits par vos agents</span>
        <span className="grow" />
        <input
          className="search-input"
          placeholder="Rechercher un titre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="deliverables-search"
        />
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Pôle">
          <option value="">Tous les pôles</option>
          {world.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">
          <option value="">Tous les agents</option>
          {world.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </header>
      {docs === null ? (
        <p className="muted">Chargement…</p>
      ) : shown.length === 0 ? (
        <div className="page-empty">
          <p>
            Aucun document pour l’instant. Les agents qui ont l’outil « Bibliothèque » enregistrent
            ici leurs rapports, synthèses et brouillons.
          </p>
        </div>
      ) : (
        <table className="data-table" data-testid="deliverables-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Agent</th>
              <th>Pôle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => {
              const a = agents.get(d.agentId);
              const dp = world.departments.find((x) => x.id === a?.departmentId);
              return (
                <tr key={d.id}>
                  <td className="muted small">{time(d.createdAt)}</td>
                  <td>
                    <strong>{d.title}</strong>
                    <span className="muted small">
                      {' '}
                      · {Math.max(1, Math.round(d.size / 1000))} ko
                    </span>
                  </td>
                  <td>{a?.name ?? d.agentId}</td>
                  <td>
                    {dp && (
                      <span className="dept-tag" style={{ borderColor: dp.color, color: dp.color }}>
                        {dp.name}
                      </span>
                    )}
                  </td>
                  <td className="actions row">
                    <button
                      className="btn small-btn"
                      onClick={() =>
                        void api<FullDocument>(`/v1/documents/${d.id}`).then((r) => setOpen(r.data))
                      }
                      data-testid="deliverable-open"
                    >
                      Lire
                    </button>
                    <button className="btn small-btn" onClick={() => void downloadDocument(d)}>
                      ⤓ .md
                    </button>
                    {d.taskId && (
                      <button
                        className="btn small-btn ghost"
                        onClick={() => onSelect({ kind: 'task', id: d.taskId! })}
                      >
                        Mission
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && <DocViewer doc={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
