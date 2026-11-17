'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { time } from '../../lib/format';
import { Empty, Section } from '../common';

export interface DocumentView {
  id: string;
  title: string;
  agentId: string;
  taskId: string | null;
  createdAt: string;
  size: number;
}
export type FullDocument = DocumentView & { content: string };

/** Téléchargement en .md (contenu lu à la demande, jamais mis en cache). */
export async function downloadDocument(d: Pick<DocumentView, 'id' | 'title'>): Promise<void> {
  const full = (await api<FullDocument>(`/v1/documents/${d.id}`)).data;
  const url = URL.createObjectURL(
    new Blob([full.content], { type: 'text/markdown;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${d.title.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 80) || 'document'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lecture d'un document (texte brut, échappé par React). */
export function DocViewer({ doc, onClose }: { doc: FullDocument; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="modal modal-wide doc-viewer" data-testid="doc-viewer">
        <h2>{doc.title}</h2>
        <p className="muted small">{time(doc.createdAt)}</p>
        <pre>{doc.content}</pre>
        <div className="actions row">
          <button className="btn primary" onClick={() => void downloadDocument(doc)}>
            Télécharger (.md)
          </button>
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/** Documents RÉELS produits par les agents pour une tâche (bibliothèque), lisibles et téléchargeables. */
export function TaskDocuments({ taskId, version }: { taskId: string; version: unknown }) {
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [open, setOpen] = useState<FullDocument | null>(null);
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
              onClick={() =>
                void api<FullDocument>(`/v1/documents/${d.id}`)
                  .then((r) => setOpen(r.data))
                  .catch(() => setError('Document indisponible'))
              }
            >
              Lire
            </button>
            <button className="btn small-btn" onClick={() => void downloadDocument(d)}>
              Télécharger
            </button>
          </span>
        </div>
      ))}
      {error && <Empty>{error}</Empty>}
      {open && <DocViewer doc={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}
