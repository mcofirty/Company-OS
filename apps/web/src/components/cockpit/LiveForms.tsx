'use client';

import { useMemo, useState } from 'react';
import type { CreateAgentRequest, WorldSnapshot } from '@company-os/contracts';
import { ApiFailure } from '../../lib/api';
import { ModelTierSelect, type Tier } from './ModelTierSelect';

const RISK_LABEL: Record<string, string> = {
  read: 'lecture',
  internal_write: 'écriture interne',
  external_write: 'action externe · validation humaine à chaque fois',
};
const AVATARS = Array.from({ length: 8 }, (_, i) => `avatar-${String(i + 1).padStart(2, '0')}`);
const errorText = (err: unknown): string =>
  err instanceof ApiFailure ? `${err.code} · ${err.message}` : 'Erreur inattendue';

/** Coche/décoche une action ; les outils sans action disparaissent (aucun droit implicite). */
export function toggleGrant(
  g: Record<string, string[]>,
  toolId: string,
  action: string,
): Record<string, string[]> {
  const cur = new Set(g[toolId] ?? []);
  if (cur.has(action)) cur.delete(action);
  else cur.add(action);
  return Object.fromEntries(
    Object.entries({ ...g, [toolId]: [...cur] }).filter(([, acts]) => acts.length > 0),
  );
}

/**
 * Choix des droits : outils réels de l'organisation (dont connecteurs MCP actifs). Les actions à
 * fort impact et les actions de plateforme ne sont pas proposées (le serveur les refuse aussi).
 */
export function GrantPicker({
  world,
  grants,
  onToggle,
}: {
  world: WorldSnapshot;
  grants: Record<string, string[]>;
  onToggle: (toolId: string, action: string) => void;
}) {
  const offer = useMemo(
    () =>
      world.tools
        .filter((t) => t.id !== 'platform')
        .map((t) => ({ ...t, actions: t.actions.filter((a) => a.risk !== 'high_impact') }))
        .filter((t) => t.actions.length > 0),
    [world.tools],
  );
  return (
    <fieldset className="grant-picker">
      <legend>Outils autorisés</legend>
      {offer.length === 0 && <p className="muted small">Aucun outil disponible.</p>}
      {offer.map((t) => (
        <div key={t.id} className="grant-tool">
          <strong>
            {t.name}
            {t.category === 'connector' && <span className="muted small"> · connecteur</span>}
          </strong>
          {t.actions.map((a) => (
            <label key={a.action} className="check">
              <input
                type="checkbox"
                checked={grants[t.id]?.includes(a.action) ?? false}
                onChange={() => onToggle(t.id, a.action)}
                data-testid={`grant-${t.id}-${a.action}`}
              />
              {a.label} <span className="muted">· {RISK_LABEL[a.risk] ?? a.risk}</span>
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  );
}

/**
 * Création d'un agent par l'administrateur (organisation live). Les droits sont cochés un par
 * un ; les actions à fort impact et les actions de plateforme ne sont pas proposées (et le
 * serveur les refuse de toute façon).
 */
export function AgentForm({
  world,
  onCreate,
  onClose,
}: {
  world: WorldSnapshot;
  onCreate: (body: CreateAgentRequest, idempotencyKey: string) => Promise<void>;
  onClose: () => void;
}) {
  const [key] = useState(() => crypto.randomUUID()); // un formulaire = une création
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState(world.departments[0]?.id ?? '');
  const [role, setRole] = useState<'specialist' | 'manager'>('specialist');
  const [goal, setGoal] = useState('');
  const [instructions, setInstructions] = useState('');
  const [budget, setBudget] = useState(5);
  const [avatarId, setAvatarId] = useState('avatar-01');
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [skills, setSkills] = useState('');
  const [modelTier, setModelTier] = useState<Tier>('quality');
  const [routines, setRoutines] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (toolId: string, action: string): void =>
    setGrants((g) => toggleGrant(g, toolId, action));

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(
        {
          name,
          title,
          departmentId,
          role,
          grants,
          goal,
          instructions,
          monthlyBudgetUsd: budget,
          modelTier,
          avatarId,
          skills: skills
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 8),
          routines: routines
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 6),
        },
        key,
      );
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Nouvel agent">
      <form
        className="modal modal-wide"
        data-testid="agent-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>Nouvel agent (LIVE)</h2>
        <p className="muted small">
          Décision humaine : l’agent reçoit exactement les droits cochés, un budget à plafond dur,
          et vos consignes s’ajoutent aux règles de sécurité de la plateforme.
        </p>
        <div className="form-grid">
          <label>
            Prénom
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              data-testid="agent-name"
            />
          </label>
          <label>
            Poste
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={2}
              maxLength={60}
              placeholder="ex. Commerciale"
              data-testid="agent-title"
            />
          </label>
          <label>
            Département
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              data-testid="agent-dept"
            >
              {world.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rôle
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'specialist' | 'manager')}
            >
              <option value="specialist">Spécialiste</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <ModelTierSelect value={modelTier} onChange={setModelTier} />
          <label>
            Budget mensuel (USD, plafond dur)
            <input
              type="number"
              min={0.5}
              max={500}
              step={0.5}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
            />
          </label>
          <label>
            Apparence
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)}>
              {AVATARS.map((a, i) => (
                <option key={a} value={a}>
                  Avatar {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row2">
          <label>
            Compétences <span className="muted">(fiche, séparées par des virgules)</span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              maxLength={300}
              placeholder="ex. Prospection, Négociation, CRM"
              data-testid="agent-skills"
            />
          </label>
          <label>
            Tâches habituelles <span className="muted">(une par ligne)</span>
            <textarea
              value={routines}
              onChange={(e) => setRoutines(e.target.value)}
              rows={2}
              maxLength={800}
              placeholder={'ex. Relance les prospects chaque lundi'}
              data-testid="agent-routines"
            />
          </label>
        </div>
        <label>
          Objectif
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
            minLength={5}
            maxLength={300}
            placeholder="ex. Préparer les relances commerciales"
            data-testid="agent-goal"
          />
        </label>
        <label>
          Consignes
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            minLength={20}
            maxLength={4000}
            rows={4}
            placeholder="Ton, priorités, ce qu’il ne doit jamais faire…"
            data-testid="agent-instructions"
          />
        </label>
        <GrantPicker world={world} grants={grants} onToggle={toggle} />
        {error && <p className="form-error">{error}</p>}
        <div className="actions row">
          <button type="submit" className="btn primary" disabled={busy} data-testid="agent-submit">
            Créer l’agent
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}

/** Mission libre confiée à un agent de l'organisation live. */
export function MissionForm({
  world,
  agentId: initialAgent,
  onCreate,
  onClose,
}: {
  world: WorldSnapshot;
  agentId?: string;
  onCreate: (agentId: string, mission: { title: string; instructions: string }) => Promise<void>;
  onClose: () => void;
}) {
  const agents = world.agents.filter((a) => a.status === 'active');
  const [agentId, setAgentId] = useState(initialAgent ?? agents[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Nouvelle mission">
      <form
        className="modal modal-wide"
        data-testid="mission-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          onCreate(agentId, { title, instructions })
            .then(onClose)
            .catch((err: unknown) => setError(errorText(err)))
            .finally(() => setBusy(false));
        }}
      >
        <h2>Nouvelle mission (LIVE)</h2>
        <p className="muted small">
          Exécutée par Claude avec les seuls outils autorisés de l’agent, dans la limite de son
          budget. Tout envoi externe demandera votre validation.
        </p>
        {agents.length === 0 ? (
          <p className="form-error">Aucun agent actif : créez d’abord un agent.</p>
        ) : (
          <label>
            Agent
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              data-testid="mission-agent"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Titre
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
            maxLength={120}
            data-testid="mission-title"
          />
        </label>
        <label>
          Consignes
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            rows={5}
            placeholder="Ce que l’agent doit faire, le résultat attendu…"
            data-testid="mission-instructions"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="actions row">
          <button
            type="submit"
            className="btn primary"
            disabled={busy || agents.length === 0}
            data-testid="mission-submit"
          >
            Lancer la mission
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
