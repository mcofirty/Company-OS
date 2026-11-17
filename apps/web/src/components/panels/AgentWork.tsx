'use client';

import { useEffect, useState } from 'react';
import type { AgentView, TaskView, WorldSnapshot } from '@company-os/contracts';
import { api, apiPost, ApiFailure } from '../../lib/api';
import { duration, TASK_STATUS_LABEL, time, usd } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { ModelTierSelect, TIER_CHOICE_LABEL, type Tier } from '../cockpit/ModelTierSelect';
import { ScheduleForm, scheduleLabel, type ScheduleView } from '../pages/Schedules';
import { Empty, Section } from '../common';
import { DocViewer, downloadDocument, type DocumentView } from './Documents';

export interface AgentVersionView {
  version: number;
  goal: string;
  instructions: string;
  model: string;
  modelTier: Tier;
  createdBy: string;
  createdAt: string;
}
export interface AgentRemote {
  grants: { toolId: string; actions: string[] }[];
  recentTasks: TaskView[];
  versions: AgentVersionView[];
  activeVersion: number;
  budget: { limitMicros: number; usedMicros: number } | null;
}

const errText = (e: unknown): string => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');

/**
 * Le TRAVAIL de l'agent (panneau de droite) : mission en cours, missions récurrentes, derniers
 * livrables, historique. L'identité (pôle, compétences, équipe…) est dans la fiche flottante.
 */
export function AgentWork({
  world,
  agent,
  now,
  remote,
  canSchedule,
  onSelect,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  now: number;
  remote: AgentRemote | null;
  canSchedule: boolean;
  onSelect: (s: Selection) => void;
}) {
  const task = world.tasks.find((t) => t.id === agent.currentTaskId);
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [open, setOpen] = useState<(DocumentView & { content: string }) | null>(null);
  const [schedules, setSchedules] = useState<ScheduleView[] | null>(null);
  const [editing, setEditing] = useState<ScheduleView | 'new' | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<DocumentView[]>(`/v1/documents?agentId=${encodeURIComponent(agent.id)}&limit=4`)
      .then((r) => !cancelled && setDocs(r.data))
      .catch(() => !cancelled && setDocs([]));
    if (world.org.mode === 'live') {
      api<ScheduleView[]>(`/v1/schedules?agentId=${encodeURIComponent(agent.id)}`)
        .then((r) => !cancelled && setSchedules(r.data))
        .catch(() => !cancelled && setSchedules([]));
    }
    return () => {
      cancelled = true;
    };
  }, [agent.id, world.org.mode, version, agent.currentTaskId]);

  const history = (remote?.recentTasks ?? [])
    .filter((t) => t.id !== agent.currentTaskId)
    .slice(0, 5);
  return (
    <>
      <Section title="Mission en cours">
        {task ? (
          <button
            className="link-card"
            onClick={() => onSelect({ kind: 'task', id: task.id })}
            data-testid="agent-current-task"
          >
            <strong>{task.title}</strong>
            <span>
              {TASK_STATUS_LABEL[task.status]} · depuis{' '}
              {task.startedAt ? duration(now - Date.parse(task.startedAt)) : '—'}
            </span>
          </button>
        ) : (
          <Empty>Disponible : aucune mission en cours.</Empty>
        )}
      </Section>
      {world.org.mode === 'live' && (
        <Section title="Missions récurrentes">
          {schedules === null ? (
            <Empty>Chargement…</Empty>
          ) : schedules.length === 0 ? (
            <Empty>Aucune planification.</Empty>
          ) : (
            <ul className="plain-list">
              {schedules.map((s) => (
                <li key={s.id} className="sched-mini">
                  <span>
                    <strong>{s.title}</strong>
                    <span className="muted small">
                      {' '}
                      · {scheduleLabel(s)} {s.enabled ? '' : '· suspendue'}
                    </span>
                  </span>
                  {canSchedule && (
                    <button className="btn small-btn" onClick={() => setEditing(s)}>
                      Modifier
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canSchedule && (
            <button
              className="btn small-btn"
              onClick={() => setEditing('new')}
              data-testid="agent-schedule-new"
            >
              ⟳ Planifier une mission récurrente
            </button>
          )}
        </Section>
      )}
      <Section title="Derniers livrables">
        {docs === null ? (
          <Empty>Chargement…</Empty>
        ) : docs.length === 0 ? (
          <Empty>Aucun document produit pour l’instant.</Empty>
        ) : (
          <ul className="plain-list">
            {docs.map((d) => (
              <li key={d.id} className="doc-row">
                <span>
                  <strong>{d.title}</strong>
                  <span className="muted small"> · {time(d.createdAt)}</span>
                </span>
                <span className="actions row">
                  <button
                    className="btn small-btn"
                    onClick={() =>
                      void api<DocumentView & { content: string }>(`/v1/documents/${d.id}`).then(
                        (r) => setOpen(r.data),
                      )
                    }
                  >
                    Lire
                  </button>
                  <button className="btn small-btn" onClick={() => void downloadDocument(d)}>
                    ⤓
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Historique">
        {history.length === 0 ? (
          <Empty>Aucune mission passée.</Empty>
        ) : (
          <ul className="plain-list">
            {history.map((t) => (
              <li key={t.id}>
                <button className="link-row" onClick={() => onSelect({ kind: 'task', id: t.id })}>
                  <span className={`status-dot st-${t.status}`} aria-hidden />
                  <span className="grow">{t.title}</span>
                  <span className="muted small">{TASK_STATUS_LABEL[t.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {open && <DocViewer doc={open} onClose={() => setOpen(null)} />}
      {editing && (
        <ScheduleForm
          world={world}
          agentId={agent.id}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}

/**
 * GÉRER l'agent (administrateur) : objectif, consignes et modèle (nouvelle version, historique),
 * budget mensuel. Chaque changement est journalisé côté serveur.
 */
export function AgentManage({
  world,
  agent,
  remote,
  canEditAgent,
  canEditBudget,
  onChanged,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  remote: AgentRemote | null;
  canEditAgent: boolean;
  canEditBudget: boolean;
  onChanged: () => void;
}) {
  const current = remote?.versions[0];
  // Projection temps réel si présente, sinon lecture serveur (agent créé depuis le chargement).
  const budget =
    world.budgets.find((b) => b.scopeType === 'agent' && b.scopeId === agent.id) ??
    remote?.budget ??
    undefined;
  const [edit, setEdit] = useState(false);
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [tier, setTier] = useState<Tier>('quality');
  const [note, setNote] = useState('');
  const [limit, setLimit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const saveVersion = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/v1/agents/${agent.id}/version`, {
        goal,
        instructions,
        modelTier: tier,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setEdit(false);
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveBudget = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/budgets', {
        scopeType: 'agent',
        scopeId: agent.id,
        monthlyLimitUsd: Number(limit),
      });
      setLimit('');
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Gérer l’agent">
      <div className="manage-grid">
        <div className="manage-item">
          <span className="muted small">Version active</span>
          <strong>
            v{remote?.activeVersion ?? '…'} ·{' '}
            {current ? (
              <span data-testid="agent-model-label">{TIER_CHOICE_LABEL[current.modelTier]}</span>
            ) : (
              '…'
            )}
          </strong>
          {canEditAgent && current && !edit && (
            <button
              className="btn small-btn"
              data-testid="agent-edit-version"
              onClick={() => {
                setGoal(current.goal);
                setInstructions(current.instructions);
                setTier(current.modelTier);
                setNote('');
                setEdit(true);
              }}
            >
              ✎ Modifier consignes et modèle
            </button>
          )}
        </div>
        <div className="manage-item">
          <span className="muted small">Budget IA ce mois</span>
          <strong>{budget ? `${usd(budget.usedMicros)} / ${usd(budget.limitMicros)}` : '—'}</strong>
          {budget && (
            <span className="meter" aria-hidden>
              <span
                style={{
                  width: `${Math.min(100, (budget.usedMicros / Math.max(1, budget.limitMicros)) * 100)}%`,
                }}
              />
            </span>
          )}
          {canEditBudget && budget && (
            <span className="inline-form">
              <input
                type="number"
                min={0.5}
                max={5000}
                step={0.5}
                placeholder="Nouveau plafond $"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                data-testid="agent-budget-input"
              />
              <button
                className="btn small-btn"
                disabled={busy || !limit || Number(limit) < 0.5}
                onClick={() => void saveBudget()}
                data-testid="agent-budget-save"
              >
                OK
              </button>
            </span>
          )}
        </div>
      </div>
      {edit && (
        <div className="version-editor" data-testid="version-editor">
          <label>
            Son job (objectif)
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={300}
              data-testid="version-goal"
            />
          </label>
          <label>
            Consignes
            <textarea
              rows={6}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={4000}
              data-testid="version-instructions"
            />
          </label>
          <ModelTierSelect value={tier} onChange={setTier} testId="version-model" />
          <label>
            Note de version (facultatif)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="ex. Rapport hebdo le lundi"
            />
          </label>
          <p className="muted small">
            Une nouvelle version est créée ; la mission en cours garde l’ancienne, les suivantes
            prennent la nouvelle. Les règles de sécurité de la plateforme restent toujours en tête.
          </p>
          <div className="actions row">
            <button
              className="btn primary small-btn"
              disabled={busy || goal.trim().length < 5 || instructions.trim().length < 20}
              onClick={() => void saveVersion()}
              data-testid="version-save"
            >
              Enregistrer la version {(remote?.activeVersion ?? 0) + 1}
            </button>
            <button className="btn ghost small-btn" onClick={() => setEdit(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {remote && remote.versions.length > 1 && (
        <div>
          <button className="linklike" onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? '▾' : '▸'} Historique des versions ({remote.versions.length})
          </button>
          {showHistory && (
            <ol className="version-history">
              {remote.versions.map((v) => (
                <li key={v.version}>
                  <strong>v{v.version}</strong> · {time(v.createdAt)} · {v.model}
                  <div className="muted small">{v.goal}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Section>
  );
}
