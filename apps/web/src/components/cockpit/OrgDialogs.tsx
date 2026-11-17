'use client';

import { useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { apiPost, ApiFailure } from '../../lib/api';

const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');
export const DEPT_COLORS = [
  '#E07A5F',
  '#3D8BD9',
  '#4CAF7A',
  '#C9A227',
  '#9B6BD3',
  '#D9577F',
  '#2BA6A6',
  '#7A8B99',
];
const ANNEX_TOTAL = 3;
type Toast = (t: { text: string; tone: 'success' | 'danger' }) => void;

/** Créer (ou renommer) un pôle : un local libre de l'aile d'extension lui est attribué. */
export function DepartmentDialog({
  world,
  edit,
  onClose,
  toast,
}: {
  world: WorldSnapshot;
  edit?: { id: string; name: string; color: string };
  onClose: () => void;
  toast: Toast;
}) {
  const [name, setName] = useState(edit?.name ?? '');
  const [color, setColor] = useState(edit?.color ?? DEPT_COLORS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freeRooms =
    ANNEX_TOTAL - world.departments.filter((d) => d.roomId.startsWith('annex-')).length;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (edit) await apiPost(`/v1/departments/${encodeURIComponent(edit.id)}`, { name, color });
      else await apiPost('/v1/departments', { name, color });
      toast({
        text: edit ? 'Pôle modifié' : `Pôle « ${name.trim()} » créé : ses bureaux sont prêts`,
        tone: 'success',
      });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Pôle">
      <div className="modal" data-testid="department-dialog">
        <h2>{edit ? 'Modifier le pôle' : 'Nouveau pôle'}</h2>
        {!edit && (
          <p className="muted small">
            L’entreprise s’agrandit : le pôle s’installe dans un local libre de l’aile d’extension
            (6 postes). Ensuite, recrutez-y des agents depuis « + Agent ». Locaux disponibles :{' '}
            <strong>{Math.max(0, freeRooms)}</strong>/{ANNEX_TOTAL}.
          </p>
        )}
        <label>
          Nom du pôle
          <input
            value={name}
            maxLength={40}
            placeholder="ex. Juridique, Produit, Achats…"
            onChange={(e) => setName(e.target.value)}
            data-testid="department-name"
            autoFocus
          />
        </label>
        <fieldset className="color-pick">
          <legend>Couleur</legend>
          {DEPT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === color ? 'on' : ''}
              style={{ background: c }}
              aria-label={`Couleur ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
            />
          ))}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions row">
          <button
            className="btn primary"
            disabled={busy || name.trim().length < 2 || (!edit && freeRooms <= 0)}
            onClick={() => void submit()}
            data-testid="department-submit"
          >
            {edit ? 'Enregistrer' : 'Créer le pôle'}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Convoquer une réunion : les agents choisis rejoignent la salle de réunion. Un agent en
 * mission n'est jamais interrompu (case grisée) ; il pourra être invité à la suivante.
 */
export function ConveneMeetingDialog({
  world,
  onClose,
  onStarted,
  toast,
}: {
  world: WorldSnapshot;
  onClose: () => void;
  onStarted: (meetingId: string) => void;
  toast: Toast;
}) {
  const agents = world.agents.filter((a) => a.status !== 'deactivated');
  const isFree = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return !!a && a.status === 'active' && a.activity !== 'in_meeting' && !a.currentTaskId;
  };
  const [topic, setTopic] = useState('');
  const [agenda, setAgenda] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [facilitator, setFacilitator] = useState('');
  const [duration, setDuration] = useState(15);
  const [minutes, setMinutes] = useState(world.org.mode === 'live');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomBusy = world.meetings.some((m) => m.status === 'in_progress');
  const depts = world.departments;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 8 ? [...p, id] : p));
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ meetingId: string; excluded: string[] }>('/v1/meetings', {
        topic,
        agenda,
        participantIds: picked,
        ...(facilitator && picked.includes(facilitator) ? { facilitatorId: facilitator } : {}),
        durationMin: duration,
        minutes,
      });
      const ex = r.data.excluded.length;
      toast({
        text: `Réunion convoquée${ex ? ` (${ex} absent·s : en mission)` : ''} — les agents rejoignent la salle`,
        tone: 'success',
      });
      onStarted(r.data.meetingId);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Convoquer">
      <div className="modal meeting-dialog" data-testid="convene-dialog">
        <h2>Convoquer une réunion</h2>
        {roomBusy && (
          <p className="form-error">La salle de réunion est occupée : attendez la fin.</p>
        )}
        <label>
          Sujet
          <input
            value={topic}
            maxLength={160}
            placeholder="ex. Point hebdo ventes, lancement produit…"
            onChange={(e) => setTopic(e.target.value)}
            data-testid="meeting-topic"
            autoFocus
          />
        </label>
        <label>
          Ordre du jour (facultatif)
          <textarea
            value={agenda}
            maxLength={2000}
            rows={3}
            onChange={(e) => setAgenda(e.target.value)}
          />
        </label>
        <fieldset className="grant-picker participants">
          <legend>
            Participants ({picked.length}/8) — les agents en mission ne sont pas interrompus
          </legend>
          {[...depts.map((d) => d.id), null].map((did) => {
            const list = agents.filter((a) =>
              did === null ? !depts.some((d) => d.id === a.departmentId) : a.departmentId === did,
            );
            if (list.length === 0) return null;
            const d = depts.find((x) => x.id === did);
            return (
              <div key={did ?? 'none'} className="pick-group">
                <span className="muted small">
                  <span className="dot" style={{ background: d?.color ?? '#999' }} />{' '}
                  {d?.name ?? 'Sans pôle'}
                </span>
                {list.map((a) => {
                  const free = isFree(a.id);
                  return (
                    <label key={a.id} className={`check ${free ? '' : 'disabled'}`}>
                      <input
                        type="checkbox"
                        disabled={!free}
                        checked={picked.includes(a.id)}
                        onChange={() => toggle(a.id)}
                        data-testid={`meeting-pick-${a.id}`}
                      />
                      {a.name} <span className="muted small">{a.title}</span>
                      {!free && <span className="muted small"> · occupé</span>}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </fieldset>
        <div className="row gap">
          <label>
            Animateur
            <select value={facilitator} onChange={(e) => setFacilitator(e.target.value)}>
              <option value="">(premier choisi)</option>
              {picked.map((id) => (
                <option key={id} value={id}>
                  {agents.find((a) => a.id === id)?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Durée
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[5, 15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>
        {world.org.mode === 'live' && (
          <label className="check">
            <input
              type="checkbox"
              checked={minutes}
              onChange={(e) => setMinutes(e.target.checked)}
            />
            À la fin, l’animateur rédige un compte rendu (mission IA, consomme du budget)
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions row">
          <button
            className="btn primary"
            disabled={busy || roomBusy || topic.trim().length < 3 || picked.length < 2}
            onClick={() => void submit()}
            data-testid="meeting-submit"
          >
            Convoquer ({picked.length})
          </button>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

/** Clôturer une réunion convoquée : notes de l'humain et décisions (facultatives). */
export function EndMeetingForm({
  meetingId,
  participants,
  onDone,
}: {
  meetingId: string;
  participants: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState('');
  const [owner, setOwner] = useState(participants[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/v1/meetings/${meetingId}/end`, {
        notes,
        decisions: decision.trim() ? [{ decision, ownerAgentId: owner }] : [],
      });
      onDone?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="end-meeting" data-testid="end-meeting">
      <label>
        Notes (facultatif)
        <textarea
          rows={2}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="row gap">
        <label className="grow">
          Décision (facultatif)
          <input value={decision} maxLength={200} onChange={(e) => setDecision(e.target.value)} />
        </label>
        <label>
          Responsable
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => void end()}
        data-testid="end-meeting-submit"
      >
        Terminer la réunion
      </button>
    </div>
  );
}
