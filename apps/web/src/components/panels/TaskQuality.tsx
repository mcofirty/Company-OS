'use client';

import { useState } from 'react';
import { apiPost, ApiFailure } from '../../lib/api';
import { useControls } from '../../lib/controls';
import type { Selection } from '../../world/types';

export interface TaskQuality {
  qualityCheck: boolean;
  reviewStatus: string | null;
  reviewNotes: string | null;
  reviewOf: string | null;
  objectiveId: string | null;
  chainId: string | null;
  chainStep: number | null;
  autoRetries: number;
}
const REVIEW: Record<string, [string, string]> = {
  pending: ['🔍 Relecture en cours par un second agent', 'warn'],
  ok: ['✓ Relu : conforme', 'ok'],
  issues: ['⚠ Relu : points à revoir', 'bad'],
  skipped: ['Relecture impossible (aucun autre agent disponible)', ''],
};

/** Contrôle qualité, objectif, chaîne et nouvel essai automatique d'une mission. */
export function TaskQualityBlock({
  q,
  onSelect,
}: {
  q: TaskQuality | undefined;
  onSelect: (s: Selection) => void;
}) {
  if (!q) return null;
  const review = q.reviewStatus ? REVIEW[q.reviewStatus] : null;
  if (!review && !q.reviewOf && !q.chainId && !q.objectiveId && !q.autoRetries) return null;
  return (
    <div className="task-quality" data-testid="task-quality">
      {review && (
        <p className={`quality-${review[1]}`}>
          <strong>{review[0]}</strong>
          {q.reviewNotes && <span className="muted small"> — {q.reviewNotes}</span>}
        </p>
      )}
      {q.reviewOf && (
        <p className="muted small">
          Relecture qualité de{' '}
          <a onClick={() => onSelect({ kind: 'task', id: q.reviewOf! })}>la mission relue</a>
        </p>
      )}
      {q.chainId && q.chainStep !== null && (
        <p className="muted small">⛓ Étape {q.chainStep + 1} d’une mission en chaîne</p>
      )}
      {q.objectiveId && <p className="muted small">🎯 Rattachée à un objectif de pôle</p>}
      {q.autoRetries > 0 && (
        <p className="muted small">
          ↻ {q.autoRetries} nouvel(s) essai(s) automatique(s) après une erreur technique
        </p>
      )}
    </div>
  );
}

/** Retour de l'humain sur un livrable : retenu pour les missions suivantes de l'agent. */
export function FeedbackBox({
  taskId,
  feedback,
  live,
  onDone,
}: {
  taskId: string;
  feedback: { kind: string; note: string; createdAt: string }[];
  live: boolean;
  onDone: (followUpId: string | null) => void;
}) {
  const { caps } = useControls();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [relaunch, setRelaunch] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const send = (kind: 'correction' | 'rejet') => {
    setError(null);
    apiPost<{ followUpTaskId: string | null }>(`/v1/tasks/${taskId}/feedback`, {
      kind,
      note,
      relaunch: live && relaunch,
    })
      .then((r) => {
        setOpen(false);
        setNote('');
        onDone(r.data.followUpTaskId);
      })
      .catch((e: unknown) => setError(e instanceof ApiFailure ? e.message : 'Erreur'));
  };
  return (
    <div className="feedback-box" data-testid="feedback-box">
      {feedback.map((f, i) => (
        <p key={i} className="muted small">
          ✎ {f.kind === 'rejet' ? 'Refusé' : 'Correction'} : {f.note}
        </p>
      ))}
      {caps.giveFeedback &&
        (!open ? (
          <button
            className="btn small-btn"
            onClick={() => setOpen(true)}
            data-testid="feedback-open"
          >
            ✎ Donner un retour à l’agent
          </button>
        ) : (
          <div className="confirm-box neutral">
            <p className="small">
              Ta remarque est retenue : l’agent en tiendra compte dans toutes ses prochaines
              missions.
            </p>
            <textarea
              rows={3}
              value={note}
              maxLength={600}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ex. Toujours citer les sources ; ton plus direct ; pas plus d’une page."
              data-testid="feedback-note"
            />
            {live && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={relaunch}
                  onChange={(e) => setRelaunch(e.target.checked)}
                />
                Relancer la mission avec cette remarque
              </label>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="actions row">
              <button
                className="btn primary small-btn"
                disabled={note.trim().length < 3}
                onClick={() => send('correction')}
                data-testid="feedback-correct"
              >
                Corriger
              </button>
              <button
                className="btn danger small-btn"
                disabled={note.trim().length < 3}
                onClick={() => send('rejet')}
                data-testid="feedback-reject"
              >
                Refuser le livrable
              </button>
              <button className="btn ghost small-btn" onClick={() => setOpen(false)}>
                Annuler
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
