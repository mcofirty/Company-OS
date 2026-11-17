'use client';

import { useEffect, useState } from 'react';
import type { TaskView, WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { TASK_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { ScheduleForm, ScheduleRow, type ScheduleView } from './Schedules';

export type MissionsTab = 'open' | 'incidents' | 'done' | 'recurring';
const DAY = 86_400_000;

/** Incidents des dernières 24 h : tâches bloquées ou échouées (même règle que l'indicateur). */
export function recentIncidents(w: WorldSnapshot, now: number): TaskView[] {
  return w.tasks.filter((t) => {
    if (t.status === 'failed') return !!t.endedAt && now - Date.parse(t.endedAt) < DAY;
    if (t.status === 'blocked') return now - Date.parse(t.startedAt ?? t.createdAt) < DAY;
    return false;
  });
}

/** Page « Missions » : en cours, incidents (24 h), terminées, récurrentes. */
export function MissionsPage({
  world,
  now,
  tab,
  onTab,
  onSelect,
  onNewMission,
  toast,
}: {
  world: WorldSnapshot;
  now: number;
  tab: MissionsTab;
  onTab: (t: MissionsTab) => void;
  onSelect: (s: Selection) => void;
  onNewMission: () => void;
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const { caps } = useControls();
  const agentName = (id: string) => world.agents.find((a) => a.id === id)?.name ?? id;
  const open = world.tasks.filter((t) =>
    ['created', 'queued', 'running', 'waiting_approval'].includes(t.status),
  );
  const incidents = recentIncidents(world, now);
  const done = world.tasks
    .filter((t) => ['succeeded', 'cancelled', 'failed', 'blocked'].includes(t.status))
    .sort((a, b) => (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt));
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null);
  const [editing, setEditing] = useState<ScheduleView | 'new' | null>(null);
  const [version, setVersion] = useState(0);
  const live = world.org.mode === 'live';
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    api<ScheduleView[]>('/v1/schedules')
      .then((r) => !cancelled && setSchedules(r.data))
      .catch(() => !cancelled && setSchedules([]));
    return () => {
      cancelled = true;
    };
  }, [live, version]);

  const rows = { open, incidents, done };
  const list: TaskView[] = tab === 'recurring' ? [] : rows[tab];
  const TABS: [MissionsTab, string, number | null][] = [
    ['open', 'En cours', open.length],
    ['incidents', 'Incidents (24 h)', incidents.length],
    ['done', 'Terminées', null],
    ...(live
      ? [
          ['recurring', 'Récurrentes', schedules?.length ?? null] as [
            MissionsTab,
            string,
            number | null,
          ],
        ]
      : []),
  ];
  return (
    <section className="page" aria-label="Missions" data-testid="missions-page">
      <header className="page-head">
        <h2>Missions</h2>
        <div className="seg" role="tablist">
          {TABS.map(([k, label, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'on' : ''}
              onClick={() => onTab(k)}
              data-testid={`missions-tab-${k}`}
            >
              {label}
              {n !== null && (
                <span className={`count ${k === 'incidents' && n > 0 ? 'danger' : ''}`}>{n}</span>
              )}
            </button>
          ))}
        </div>
        <span className="grow" />
        {live && caps.createMission && (
          <button className="btn primary small-btn" onClick={onNewMission}>
            + Mission
          </button>
        )}
        {live && caps.manageSchedules && (
          <button
            className="btn small-btn"
            onClick={() => setEditing('new')}
            data-testid="schedule-new"
          >
            ⟳ Mission récurrente
          </button>
        )}
      </header>
      {tab === 'recurring' ? (
        schedules === null ? (
          <p className="muted">Chargement…</p>
        ) : schedules.length === 0 ? (
          <div className="page-empty">
            <p>
              Aucune mission récurrente. Exemple : « chaque lundi à 9 h, le DG fait le rapport
              d’activité de la semaine ».
            </p>
          </div>
        ) : (
          <ul className="plain-list" data-testid="schedules-list">
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                s={s}
                agentName={agentName(s.agentId)}
                canManage={caps.manageSchedules ?? false}
                onEdit={() => setEditing(s)}
                onChanged={(text) => {
                  toast({ text, tone: 'success' });
                  setVersion((v) => v + 1);
                }}
                onError={(text) => toast({ text, tone: 'danger' })}
              />
            ))}
          </ul>
        )
      ) : list.length === 0 ? (
        <div className="page-empty">
          <p>
            {tab === 'open'
              ? 'Aucune mission en cours.'
              : tab === 'incidents'
                ? 'Aucun incident ces dernières 24 heures. 👍'
                : 'Aucune mission terminée récemment.'}
          </p>
        </div>
      ) : (
        <table className="data-table" data-testid="missions-table">
          <thead>
            <tr>
              <th>Statut</th>
              <th>Mission</th>
              <th>Agent</th>
              <th>{tab === 'open' ? 'Créée' : 'Fin'}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr
                key={t.id}
                onClick={() => onSelect({ kind: 'task', id: t.id })}
                className="clickable"
              >
                <td>
                  <span className={`status-pill-sm st-${t.status}`}>
                    {TASK_STATUS_LABEL[t.status]}
                  </span>
                </td>
                <td>
                  <strong>{t.title}</strong>
                  {t.resultSummary && <div className="muted small ellipsis">{t.resultSummary}</div>}
                </td>
                <td>{agentName(t.agentId)}</td>
                <td className="muted small">{time(t.endedAt ?? t.startedAt ?? t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <ScheduleForm
          world={world}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
            toast({ text: 'Mission récurrente enregistrée', tone: 'success' });
          }}
        />
      )}
    </section>
  );
}
