'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CreateAgentRequest, WorldSnapshot } from '@company-os/contracts';
import { api, ApiFailure } from '../../lib/api';
import { ModelTierSelect, TIER_CHOICE_LABEL, type Tier } from './ModelTierSelect';
import { AppIcon } from './AppIcon';
import { actionLabel, isReadAction, TOOL_PURPOSE } from '../../lib/rights';

export interface MissionInput {
  title: string;
  instructions: string;
  modelTier?: Tier;
  objectiveId?: string;
  qualityCheck?: boolean;
}

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
  const [q, setQ] = useState('');
  const offer = useMemo(() => {
    const seen = new Set<string>();
    return (
      world.tools
        .filter((t) => {
          if (t.id === 'platform' || seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        })
        .map((t) => ({
          ...t,
          actions: t.actions
            .filter((a) => a.risk !== 'high_impact')
            .map((a) => ({ ...a, fr: actionLabel(a), read: isReadAction(a) })),
        }))
        .filter((t) => t.actions.length > 0)
        // Outils intégrés d'abord, puis les applications connectées.
        .sort((x, y) => Number(x.category === 'connector') - Number(y.category === 'connector'))
    );
  }, [world.tools]);
  const total = offer.reduce((n, t) => n + t.actions.length, 0);
  const needle = q.trim().toLowerCase();
  const has = (toolId: string, action: string): boolean =>
    grants[toolId]?.includes(action) ?? false;
  /** Coche (ou décoche) un ensemble d'actions en une fois. */
  const setAll = (toolId: string, actions: string[], on: boolean): void => {
    for (const a of actions) if (has(toolId, a) !== on) onToggle(toolId, a);
  };
  return (
    <fieldset className="grants">
      <legend>Droits de l’agent</legend>
      <ul className="grants-legend" aria-label="Légende">
        <li>
          <span className="grant-badge read">Consulter</span> lit sans rien changer
        </li>
        <li>
          <span className="grant-badge write">Modifier</span> change quelque chose dans le QG
        </li>
        <li>
          <span className="grant-badge ext">Action réelle</span> agit hors du QG : ta validation à
          chaque fois
        </li>
      </ul>
      {total > 15 && (
        <input
          className="grants-search"
          type="search"
          placeholder="Chercher un droit (ex. fichier, ticket, email)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Chercher un droit"
        />
      )}
      {offer.length === 0 && <p className="muted small">Aucun outil disponible.</p>}
      {offer.map((t) => {
        const shown = t.actions.filter(
          (a) =>
            !needle ||
            a.fr.toLowerCase().includes(needle) ||
            a.action.toLowerCase().includes(needle) ||
            t.name.toLowerCase().includes(needle),
        );
        if (shown.length === 0) return null;
        const checked = t.actions.filter((a) => has(t.id, a.action)).length;
        const connector = t.category === 'connector';
        const reads = shown.filter((a) => a.read);
        const writes = shown.filter((a) => !a.read);
        const row = (a: (typeof shown)[number]) => (
          <label key={a.action} className="grant-row">
            <input
              type="checkbox"
              checked={has(t.id, a.action)}
              onChange={() => onToggle(t.id, a.action)}
              data-testid={`grant-${t.id}-${a.action}`}
            />
            <span className="grant-text">
              <span>{a.fr}</span>
              {connector && <code className="grant-tech">{a.action}</code>}
            </span>
            <span
              className={`grant-badge ${a.read ? 'read' : a.risk === 'external_write' ? 'ext' : 'write'}`}
              title={
                a.risk === 'external_write'
                  ? 'Chaque utilisation attend ta validation dans « À valider ».'
                  : undefined
              }
            >
              {a.read
                ? a.risk === 'external_write'
                  ? 'Consulter · validation'
                  : 'Consulter'
                : a.risk === 'external_write'
                  ? 'Action réelle'
                  : 'Modifier'}
            </span>
          </label>
        );
        return (
          <details
            key={t.id}
            className="grant-group"
            open={!connector || checked > 0 || !!needle}
            data-testid={`grant-group-${t.id}`}
          >
            <summary>
              <AppIcon app={t.app ?? t.id} name={t.name} color={t.color} size={26} />
              <span className="grant-title">
                <strong>{t.name}</strong>
                <small>
                  {connector ? 'Application connectée' : 'Outil du QG'} · {checked}/
                  {t.actions.length} droit(s)
                </small>
              </span>
            </summary>
            <p className="grant-purpose">
              {TOOL_PURPOSE[t.id] ??
                (connector
                  ? `Actions sur ton compte ${t.name}. Les actions réelles attendent ta validation à chaque fois.`
                  : '')}
            </p>
            <div className="grant-quick">
              {reads.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setAll(
                      t.id,
                      reads.map((a) => a.action),
                      true,
                    )
                  }
                >
                  Cocher « Consulter »
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  setAll(
                    t.id,
                    shown.map((a) => a.action),
                    true,
                  )
                }
              >
                Tout cocher
              </button>
              <button
                type="button"
                onClick={() =>
                  setAll(
                    t.id,
                    shown.map((a) => a.action),
                    false,
                  )
                }
              >
                Tout décocher
              </button>
            </div>
            {reads.length > 0 && (
              <div className="grant-sub">
                <h5>Consulter</h5>
                {reads.map(row)}
              </div>
            )}
            {writes.length > 0 && (
              <div className="grant-sub">
                <h5>Agir</h5>
                {writes.map(row)}
              </div>
            )}
          </details>
        );
      })}
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
  const [modelTier, setModelTier] = useState<Tier>('auto');
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
  onCreate: (agentId: string, mission: MissionInput) => Promise<void>;
  onClose: () => void;
}) {
  const agents = world.agents.filter((a) => a.status === 'active');
  const [tier, setTier] = useState<Tier | ''>('');
  const [objectiveId, setObjectiveId] = useState('');
  const [quality, setQuality] = useState(false);
  const [objectives, setObjectives] = useState<
    { id: string; title: string; departmentId: string }[]
  >([]);
  useEffect(() => {
    api<{ id: string; title: string; departmentId: string }[]>('/v1/objectives')
      .then((r) => setObjectives(r.data))
      .catch(() => setObjectives([]));
  }, []);
  const [agentId, setAgentId] = useState(initialAgent ?? agents[0]?.id ?? '');
  const agentDept = world.agents.find((a) => a.id === agentId)?.departmentId;
  const deptObjectives = objectives.filter((o) => o.departmentId === agentDept);
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
          onCreate(agentId, {
            title,
            instructions,
            ...(tier ? { modelTier: tier } : {}),
            ...(objectiveId && deptObjectives.some((o) => o.id === objectiveId)
              ? { objectiveId }
              : {}),
            ...(quality ? { qualityCheck: true } : {}),
          })
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
        <label>
          Objectif du pôle (facultatif)
          <select
            value={objectiveId}
            onChange={(e) => setObjectiveId(e.target.value)}
            data-testid="mission-objective"
          >
            <option value="">Aucun</option>
            {deptObjectives.map((o) => (
              <option key={o.id} value={o.id}>
                🎯 {o.title}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={quality}
            onChange={(e) => setQuality(e.target.checked)}
            data-testid="mission-quality"
          />
          Contrôle qualité : un second agent relit avant que le livrable me soit rendu
        </label>
        <label>
          Modèle pour cette mission
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier | '')}
            data-testid="mission-model"
          >
            <option value="">Réglage de l’agent</option>
            {(['auto', 'economy', 'balanced', 'quality'] as const).map((t) => (
              <option key={t} value={t}>
                {TIER_CHOICE_LABEL[t]}
              </option>
            ))}
          </select>
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
