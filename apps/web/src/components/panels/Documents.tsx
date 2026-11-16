'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { time } from '../../lib/format';
import { Empty, Section } from '../common';

interface DocumentView {
  id: string;
  title: string;
  agentId: string;
  taskId: string | null;
  createdAt: string;
  size: number;
}

/** Documents RÉELS produits par les agents pour une tâche (bibliothèque), lisibles et téléchargeables. */
export function TaskDocuments({ taskId, version }: { taskId: string; version: unknown }) {
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [open, setOpen] = useState<(DocumentView & { content: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<DocumentView[]>(`/v1/documents?taskId=${taskId}`)
      .then((r) => !cancelled && setDocs(r.data))
      .catch(() => !cancelled && setDocs([]));
    return () => {
      cancelled = true;
    };
  }, [taskId, version]);
  if (!docs || docs.length === 0) return null;

  const load = async (id: string): Promise<(DocumentView & { content: string }) | null> => {
    try {
      return (await api<DocumentView & { content: string }>(`/v1/documents/${id}`)).data;
    } catch {
      setError('Document indisponible');
      return null;
    }
  };
  const download = async (d: DocumentView): Promise<void> => {
    const full = await load(d.id);
    if (!full) return;
    const url = URL.createObjectURL(
      new Blob([full.content], { type: 'text/markdown;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.title.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 80) || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section title={`Documents produits (${docs.length})`}>
      {docs.map((d) => (
        <div key={d.id} className="doc-row" data-testid="doc-row">
          <span>
            <strong>{d.title}</strong>
            <span className="muted small">
              {' '}
              · {time(d.createdAt)} · {Math.max(1, Math.round(d.size / 1000))} ko
            </span>
          </span>
          <span className="actions row">
            <button
              className="btn small-btn"
              data-testid="doc-open"
              onClick={() => void load(d.id).then((full) => full && setOpen(full))}
            >
              Lire
            </button>
            <button className="btn small-btn" onClick={() => void download(d)}>
              Télécharger
            </button>
          </span>
        </div>
      ))}
      {error && <Empty>{error}</Empty>}
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={open.title}>
          <div className="modal modal-wide doc-viewer" data-testid="doc-viewer">
            <h2>{open.title}</h2>
            <pre>{open.content}</pre>
            <div className="actions row">
              <button className="btn primary" onClick={() => void download(open)}>
                Télécharger (.md)
              </button>
              <button className="btn ghost" onClick={() => setOpen(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
