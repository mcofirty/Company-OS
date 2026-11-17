'use client';

import { useState, type ReactNode } from 'react';
import type { AgentView, WorldSnapshot } from '@company-os/contracts';
import { api, ApiFailure } from '../../lib/api';
import { TASK_STATUS_LABEL } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { ToolIcon } from '../common';
import { AgentPortrait } from './Portrait2D';

export interface AgentProfile {
  goal: string | null;
  skills: string[];
  routines: string[];
}

const tint = (hex: string | undefined, a: number): string => {
  if (!hex) return 'var(--surface-muted)';
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Fiche d'un agent (vue principale de l'inspecteur) : pôle, poste, rattachement, statut réel,
 * mission, compétences, outils accordés, tâches habituelles, équipe. Tout vient du serveur :
 * état projeté (snapshot + événements) et fiche `/v1/agents/:id`.
 */
export function AgentCard({
  world,
  agent,
  grants,
  profile,
  canEdit,
  canMission,
  onMission,
  onSelect,
  onProfileSaved,
  extras,
}: {
  world: WorldSnapshot;
  agent: AgentView;
  grants: { toolId: string; actions: string[] }[] | null;
  profile: AgentProfile | null;
  canEdit: boolean;
  canMission: boolean;
  onMission: () => void;
  onSelect: (s: Selection) => void;
  onProfileSaved: () => void;
  /** Activité en direct, indicateurs, actions rapides, relations (fiche flottante). */
  extras?: ReactNode;
}) {
  const dept = world.departments.find((d) => d.id === agent.departmentId);
  const manager = world.agents.find((a) => a.id === agent.managerId);
  const task = world.tasks.find((t) => t.id === agent.currentTaskId);
  const chief = dept?.managerAgentId === agent.id || agent.role === 'manager';
  const reports = world.agents.filter(
    (a) => a.managerId === agent.id && a.status !== 'deactivated',
  );
  const team =
    reports.length > 0
      ? reports
      : chief
        ? world.agents.filter(
            (a) =>
              a.departmentId === agent.departmentId &&
              a.id !== agent.id &&
              a.status !== 'deactivated',
          )
        : [];
  const [editing, setEditing] = useState(false);
  const [skills, setSkills] = useState('');
  const [routines, setRoutines] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = (() => {
    if (agent.status === 'deactivated') return { dot: '#9a93a8', text: 'Désactivé' };
    if (agent.status === 'paused') return { dot: '#d49c30', text: 'Suspendu' };
    if (agent.activity === 'waiting_approval')
      return { dot: '#d49c30', text: `En attente de validation${task ? ` · ${task.title}` : ''}` };
    if (task)
      return {
        dot: '#3c9d4e',
        text: `Au poste · ${task.title}${task.status !== 'running' ? ` (${TASK_STATUS_LABEL[task.status]})` : ''}`,
      };
    return { dot: '#3c9d4e', text: 'Au poste · disponible' };
  })();

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/agents/${agent.id}/profile`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          skills: skills
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          routines: routines
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setEditing(false);
      onProfileSaved();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Erreur inattendue');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="agent-card" data-testid="agent-card">
      <div className="agent-card-top">
        <div className="portrait" style={{ background: tint(dept?.color, 0.18) }}>
          <AgentPortrait world={world} agent={agent} size={96} />
        </div>
        <div className="agent-card-id">
          {dept && (
            <button
              className="dept-chip"
              style={{ background: dept.color }}
              onClick={() => onSelect({ kind: 'department', id: dept.id })}
            >
              {dept.name}
            </button>
          )}
          <h2 data-testid="agent-card-name">{agent.name}</h2>
          <p className="agent-card-title">{agent.title}</p>
          {chief && (
            <span className="chief-chip" data-testid="chief-chip">
              ★ Chef du pôle
            </span>
          )}
          <p className="agent-card-reports">
            Rend compte à{' '}
            {manager ? (
              <a onClick={() => onSelect({ kind: 'agent', id: manager.id })}>{manager.name}</a>
            ) : (
              <span>{world.org.mode === 'live' ? 'vous (administrateur)' : 'la direction'}</span>
            )}
          </p>
        </div>
      </div>

      <button
        className="status-pill"
        disabled={!task}
        onClick={() => task && onSelect({ kind: 'task', id: task.id })}
        data-testid="agent-status-pill"
      >
        <span className="dot" style={{ background: status.dot }} aria-hidden />
        <span>{status.text}</span>
      </button>

      {extras}

      <Block title="Son job au QG">
        <p className="card-text">{profile ? (profile.goal ?? '—') : 'Chargement…'}</p>
      </Block>

      {editing ? (
        <div className="profile-editor" data-testid="profile-editor">
          <label>
            Compétences (séparées par des virgules, 8 max)
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Direction artistique, Charte, Brief créa"
              data-testid="profile-skills"
            />
          </label>
          <label>
            Tâches habituelles (une par ligne, 6 max)
            <textarea
              rows={3}
              value={routines}
              onChange={(e) => setRoutines(e.target.value)}
              placeholder={'Valide les visuels de la semaine\nBrief la vidéo Insta'}
              data-testid="profile-routines"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="actions row">
            <button
              className="btn primary small-btn"
              disabled={busy}
              onClick={() => void save()}
              data-testid="profile-save"
            >
              Enregistrer la fiche
            </button>
            <button className="btn ghost small-btn" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          <Block title="Compétences">
            {profile && profile.skills.length > 0 ? (
              <div className="chips">
                {profile.skills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted small">Non renseignées.</p>
            )}
          </Block>
          <Block title="Outils">
            {grants === null ? (
              <p className="muted small">Chargement…</p>
            ) : grants.length === 0 ? (
              <p className="muted small">Aucun outil accordé.</p>
            ) : (
              <div className="chips">
                {grants.map((g) => {
                  const tool = world.tools.find((t) => t.id === g.toolId);
                  return (
                    <button
                      key={g.toolId}
                      className="chip tool-chip"
                      title={g.actions.join(', ')}
                      onClick={() => tool && onSelect({ kind: 'tool', id: tool.id })}
                    >
                      <ToolIcon tool={tool} size={20} /> {tool?.name ?? g.toolId}
                    </button>
                  );
                })}
              </div>
            )}
          </Block>
          <Block title="Tâches habituelles">
            {profile && profile.routines.length > 0 ? (
              <ul className="card-list">
                {profile.routines.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Non renseignées.</p>
            )}
          </Block>
          {canEdit && profile && (
            <button
              className="btn ghost small-btn"
              data-testid="profile-edit"
              onClick={() => {
                setSkills(profile.skills.join(', '));
                setRoutines(profile.routines.join('\n'));
                setEditing(true);
              }}
            >
              ✎ Modifier la fiche
            </button>
          )}
        </>
      )}

      {team.length > 0 && (!extras || reports.length === 0) && (
        <Block title={reports.length > 0 ? 'Son équipe' : 'Son pôle'}>
          <div className="team-faces">
            {team.slice(0, 12).map((a) => (
              <button
                key={a.id}
                className="face"
                title={`${a.name} · ${a.title}`}
                aria-label={a.name}
                style={{ background: tint(dept?.color, 0.16) }}
                onClick={() => onSelect({ kind: 'agent', id: a.id })}
              >
                <AgentPortrait world={world} agent={a} size={40} crop="head" />
              </button>
            ))}
          </div>
        </Block>
      )}

      <div className="agent-card-actions">
        {canMission && (
          <button className="btn dark" onClick={onMission} data-testid="agent-mission">
            Lui confier une mission
          </button>
        )}
        {dept && (
          <button
            className="btn light"
            onClick={() => onSelect({ kind: 'department', id: dept.id })}
            data-testid="agent-dept"
          >
            Voir le pôle
          </button>
        )}
      </div>
    </article>
  );
}
