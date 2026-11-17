'use client';

import { useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { apiPost, ApiFailure } from '../../lib/api';

export interface ScheduleView {
  id: string;
  agentId: string;
  title: string;
  instructions: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  weekday: number | null;
  monthDay: number | null;
  timezone: string;
  maxCostUsd: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastTaskId: string | null;
  runCount: number;
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
const money = (n: number) => `${n.toFixed(2).replace('.', ',')} $`;
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const hhmm = (h: number, m: number) => `${h}h${String(m).padStart(2, '0')}`;

/** « Chaque lundi à 9h00 » … */
export function scheduleLabel(
  s: Pick<ScheduleView, 'frequency' | 'hour' | 'minute' | 'weekday' | 'monthDay'>,
): string {
  if (s.frequency === 'daily') return `chaque jour à ${hhmm(s.hour, s.minute)}`;
  if (s.frequency === 'weekly')
    return `chaque ${DAYS[(s.weekday ?? 1) - 1]} à ${hhmm(s.hour, s.minute)}`;
  return `le ${s.monthDay} de chaque mois à ${hhmm(s.hour, s.minute)}`;
}

/** Création / modification d'une mission récurrente (administrateur). */
export function ScheduleForm({
  world,
  agentId,
  initial,
  onClose,
  onSaved,
}: {
  world: WorldSnapshot;
  agentId?: string;
  initial: ScheduleView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const agents = world.agents.filter((a) => a.status !== 'deactivated');
  const [agent, setAgent] = useState(initial?.agentId ?? agentId ?? agents[0]?.id ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [frequency, setFrequency] = useState<ScheduleView['frequency']>(
    initial?.frequency ?? 'weekly',
  );
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1);
  const [monthDay, setMonthDay] = useState(initial?.monthDay ?? 1);
  const [time_, setTime] = useState(
    initial
      ? `${String(initial.hour).padStart(2, '0')}:${String(initial.minute).padStart(2, '0')}`
      : '09:00',
  );
  const [maxCost, setMaxCost] = useState(initial?.maxCostUsd ?? 1);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz =
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Paris';

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const [h, m] = time_.split(':').map(Number);
    try {
      await apiPost(initial ? `/v1/schedules/${initial.id}` : '/v1/schedules', {
        agentId: agent,
        title,
        instructions,
        frequency,
        hour: h ?? 9,
        minute: m ?? 0,
        ...(frequency === 'weekly' ? { weekday } : {}),
        ...(frequency === 'monthly' ? { monthDay } : {}),
        timezone: tz,
        maxCostUsd: maxCost,
        enabled,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Erreur inattendue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Mission récurrente">
      <form
        className="modal form"
        data-testid="schedule-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2>{initial ? 'Modifier la mission récurrente' : 'Nouvelle mission récurrente'}</h2>
        <label>
          Agent
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            data-testid="schedule-agent"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Titre
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
            maxLength={120}
            placeholder="ex. Rapport d’activité hebdomadaire"
            data-testid="schedule-title"
          />
        </label>
        <label>
          Consignes de chaque exécution
          <textarea
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            placeholder="ex. Fais le point de la semaine : missions terminées, coûts, risques, 3 priorités."
            data-testid="schedule-instructions"
          />
        </label>
        <div className="row3">
          <label>
            Fréquence
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ScheduleView['frequency'])}
              data-testid="schedule-frequency"
            >
              <option value="daily">Chaque jour</option>
              <option value="weekly">Chaque semaine</option>
              <option value="monthly">Chaque mois</option>
            </select>
          </label>
          {frequency === 'weekly' && (
            <label>
              Jour
              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {frequency === 'monthly' && (
            <label>
              Jour du mois
              <input
                type="number"
                min={1}
                max={28}
                value={monthDay}
                onChange={(e) => setMonthDay(Number(e.target.value))}
              />
            </label>
          )}
          <label>
            Heure
            <input type="time" value={time_} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        <div className="row3">
          <label>
            Plafond par exécution ($)
            <input
              type="number"
              min={0.05}
              max={20}
              step={0.05}
              value={maxCost}
              onChange={(e) => setMaxCost(Number(e.target.value))}
              data-testid="schedule-cost"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Active
          </label>
        </div>
        <p className="muted small">
          {scheduleLabel({
            frequency,
            hour: Number(time_.split(':')[0]),
            minute: Number(time_.split(':')[1]),
            weekday,
            monthDay,
          })}{' '}
          ({tz}). Chaque exécution est une mission normale : budgets, validations et journal
          s’appliquent.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="actions row">
          <button type="submit" className="btn primary" disabled={busy} data-testid="schedule-save">
            Enregistrer
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

/** Ligne d'une mission récurrente avec ses actions (lancer, suspendre, modifier, supprimer). */
export function ScheduleRow({
  s,
  agentName,
  canManage,
  onEdit,
  onChanged,
  onError,
}: {
  s: ScheduleView;
  agentName: string;
  canManage: boolean;
  onEdit: () => void;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const act = async (path: string, body: object | undefined, msg: string): Promise<void> => {
    try {
      await apiPost(path, body);
      onChanged(msg);
    } catch (e) {
      onError(e instanceof ApiFailure ? e.message : 'Erreur inattendue');
    }
  };
  return (
    <li className="sched-row" data-testid="schedule-row">
      <span className={`status-dot ${s.enabled ? 'st-running' : 'st-cancelled'}`} aria-hidden />
      <span className="grow">
        <strong>{s.title}</strong>
        <span className="muted small">
          {agentName} · {scheduleLabel(s)} · plafond {money(s.maxCostUsd)} / exécution
        </span>
        <span className="muted small sched-next">
          {s.enabled ? `Prochaine : ${when(s.nextRunAt)}` : 'Suspendue'}
          {s.runCount > 0 ? ` · ${s.runCount} exécution(s)` : ''}
        </span>
      </span>
      {canManage && (
        <span className="actions row">
          <button
            className="btn small-btn"
            onClick={() =>
              void act(`/v1/schedules/${s.id}/run`, {}, `« ${s.title} » lancée maintenant`)
            }
            data-testid="schedule-run"
          >
            ▶ Lancer
          </button>
          <button
            className="btn small-btn"
            onClick={() =>
              void act(
                `/v1/schedules/${s.id}`,
                {
                  agentId: s.agentId,
                  title: s.title,
                  instructions: s.instructions,
                  frequency: s.frequency,
                  hour: s.hour,
                  minute: s.minute,
                  ...(s.weekday ? { weekday: s.weekday } : {}),
                  ...(s.monthDay ? { monthDay: s.monthDay } : {}),
                  timezone: s.timezone,
                  maxCostUsd: s.maxCostUsd,
                  enabled: !s.enabled,
                },
                s.enabled ? 'Suspendue' : 'Reprise',
              )
            }
          >
            {s.enabled ? '❚❚' : '▶︎ Reprendre'}
          </button>
          <button className="btn small-btn" onClick={onEdit}>
            Modifier
          </button>
          <button
            className="btn small-btn danger"
            onClick={() => {
              if (window.confirm(`Supprimer « ${s.title} » ?`))
                void act(`/v1/schedules/${s.id}/delete`, {}, 'Supprimée');
            }}
          >
            ✕
          </button>
        </span>
      )}
    </li>
  );
}
