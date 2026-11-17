'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api, apiPost, ApiFailure } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { usd } from '../../lib/format';
import type { Selection } from '../../world/types';

const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');
type Toast = (t: { text: string; tone: 'success' | 'danger' }) => void;

/** Rechargement à chaque nouvel événement du QG (données servies par l'API). */
function useLive<T>(url: string, seq: number): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    let off = false;
    api<T>(url)
      .then((r) => !off && setData(r.data))
      .catch(() => !off && setData(null));
    return () => {
      off = true;
    };
  }, [url, seq, v]);
  return [data, () => setV((x) => x + 1)];
}

/* ------------------------------------------------------------------ objectifs */
export interface ObjectiveView {
  id: string;
  departmentId: string;
  title: string;
  target: number;
  done: number;
  periodEnd: string;
}

export function ObjectiveBar({ o }: { o: ObjectiveView }) {
  const pct = Math.min(1, o.done / o.target);
  return (
    <div className="objective" data-testid="objective">
      <div className="objective-head">
        <strong>🎯 {o.title}</strong>
        <span className="muted small">
          {o.done}/{o.target} · d’ici le {new Date(o.periodEnd).toLocaleDateString('fr-FR')}
        </span>
      </div>
      <span className="stat-bar big">
        <span style={{ width: `${Math.max(2, pct * 100)}%` }} className={pct >= 1 ? 'done' : ''} />
      </span>
    </div>
  );
}

export function ObjectivesPanel({ world, toast }: { world: WorldSnapshot; toast: Toast }) {
  const { caps } = useControls();
  const [list, reload] = useLive<ObjectiveView[]>('/v1/objectives', world.lastSeq);
  const [dept, setDept] = useState(world.departments[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState(10);
  const [busy, setBusy] = useState(false);
  return (
    <div className="ops-panel" data-testid="objectives-panel">
      {caps.manageObjectives && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            apiPost('/v1/objectives', { departmentId: dept, title, target })
              .then(() => {
                toast({
                  text: 'Objectif fixé : le responsable du pôle organise le travail',
                  tone: 'success',
                });
                setTitle('');
                reload();
              })
              .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }))
              .finally(() => setBusy(false));
          }}
        >
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            data-testid="objective-dept"
          >
            {world.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex. 10 posts LinkedIn ce mois"
            minLength={3}
            maxLength={120}
            required
            data-testid="objective-title"
          />
          <input
            type="number"
            min={1}
            max={10000}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            style={{ width: 80 }}
            aria-label="Cible"
            data-testid="objective-target"
          />
          <button className="btn primary small-btn" disabled={busy} data-testid="objective-create">
            🎯 Fixer l’objectif
          </button>
        </form>
      )}
      {!list ? (
        <p className="muted">Chargement…</p>
      ) : list.length === 0 ? (
        <div className="page-empty">
          <p>
            Aucun objectif. Fixe un objectif chiffré à un pôle : son responsable découpe le travail
            et délègue ; chaque mission réussie rattachée fait avancer la barre.
          </p>
        </div>
      ) : (
        world.departments
          .filter((d) => list.some((o) => o.departmentId === d.id))
          .map((d) => (
            <section key={d.id} className="ops-group">
              <h3>
                <span className="dot" style={{ background: d.color }} /> {d.name}
              </h3>
              {list
                .filter((o) => o.departmentId === d.id)
                .map((o) => (
                  <div key={o.id} className="objective-row">
                    <ObjectiveBar o={o} />
                    {caps.manageObjectives && (
                      <button
                        className="btn ghost small-btn"
                        onClick={() =>
                          apiPost(`/v1/objectives/${o.id}/archive`, {})
                            .then(reload)
                            .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }))
                        }
                      >
                        Archiver
                      </button>
                    )}
                  </div>
                ))}
            </section>
          ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ chaînes */
interface ChainTemplate {
  id: string;
  title: string;
  description: string;
  steps: { title: string; hint: string }[];
}
interface ChainView {
  id: string;
  title: string;
  status: string;
  currentStep: number;
  steps: { title: string; agentId: string; taskId: string | null; status: string }[];
}
const CHAIN_STATUS: Record<string, string> = {
  running: 'En cours',
  awaiting_validation: 'À valider',
  done: 'Validée',
  blocked: 'Bloquée',
  cancelled: 'Annulée',
};

export function ChainsPanel({
  world,
  toast,
  onSelect,
}: {
  world: WorldSnapshot;
  toast: Toast;
  onSelect: (s: Selection) => void;
}) {
  const { caps } = useControls();
  const [templates] = useLive<ChainTemplate[]>('/v1/chain-templates', 0);
  const [chains, reload] = useLive<ChainView[]>('/v1/chains', world.lastSeq);
  const [tpl, setTpl] = useState<string>('');
  const [topic, setTopic] = useState('');
  const [agents, setAgents] = useState<string[]>([]);
  const active = world.agents.filter((a) => a.status === 'active');
  const name = (id: string) => world.agents.find((a) => a.id === id)?.name ?? id;
  const current = templates?.find((t) => t.id === tpl) ?? null;
  const pick = (t: ChainTemplate) => {
    setTpl(t.id);
    // Suggestion : un agent du pôle conseillé pour chaque étape (modifiable).
    setAgents(
      t.steps.map(
        (s) =>
          active.find(
            (a) => a.departmentId.includes(s.hint) || a.title.toLowerCase().includes(s.hint),
          )?.id ??
          active[0]?.id ??
          '',
      ),
    );
  };
  return (
    <div className="ops-panel" data-testid="chains-panel">
      {caps.runChains && templates && (
        <div className="chain-templates">
          {templates.map((t) => (
            <button
              key={t.id}
              className={`chain-tpl ${tpl === t.id ? 'on' : ''}`}
              onClick={() => pick(t)}
              data-testid={`chain-tpl-${t.id}`}
            >
              <strong>⛓ {t.title}</strong>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>
      )}
      {current && (
        <form
          className="chain-form"
          onSubmit={(e) => {
            e.preventDefault();
            apiPost('/v1/chains', { templateId: current.id, topic, agentIds: agents })
              .then(() => {
                toast({ text: 'Chaîne lancée : étape 1 en cours', tone: 'success' });
                setTpl('');
                setTopic('');
                reload();
              })
              .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }));
          }}
        >
          <label>
            Sujet
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              minLength={3}
              maxLength={300}
              placeholder="ex. L’IA dans les PME industrielles"
              data-testid="chain-topic"
            />
          </label>
          <div className="chain-steps">
            {current.steps.map((s, i) => (
              <label key={s.title}>
                {i + 1}. {s.title}
                <select
                  value={agents[i] ?? ''}
                  onChange={(e) =>
                    setAgents((a) => a.map((x, j) => (j === i ? e.target.value : x)))
                  }
                >
                  {active.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.title}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <span className="chain-final">✋ Validation par toi (rien n’est publié sans toi)</span>
          </div>
          <button className="btn primary" data-testid="chain-start">
            Lancer la chaîne
          </button>
        </form>
      )}
      {!chains ? (
        <p className="muted">Chargement…</p>
      ) : chains.length === 0 ? (
        <div className="page-empty">
          <p>Aucune mission en chaîne pour l’instant.</p>
        </div>
      ) : (
        <ul className="chain-list">
          {chains.map((c) => (
            <li key={c.id} className={`chain st-${c.status}`} data-testid="chain-row">
              <div className="chain-head">
                <strong>{c.title}</strong>
                <span className={`status-pill-sm chain-${c.status}`}>
                  {CHAIN_STATUS[c.status] ?? c.status}
                </span>
              </div>
              <ol className="chain-track">
                {c.steps.map((s, i) => (
                  <li key={i} className={`step st-${s.status}`}>
                    <button
                      disabled={!s.taskId}
                      onClick={() => s.taskId && onSelect({ kind: 'task', id: s.taskId })}
                    >
                      {s.status === 'succeeded' ? '✓' : s.status === 'running' ? '…' : i + 1}{' '}
                      {s.title}
                      <small>{name(s.agentId)}</small>
                    </button>
                  </li>
                ))}
                <li className={`step ${c.status === 'done' ? 'st-succeeded' : ''}`}>
                  <span>✋ Validation</span>
                </li>
              </ol>
              {c.status === 'awaiting_validation' && caps.runChains && (
                <div className="actions row">
                  <button
                    className="btn primary small-btn"
                    onClick={() =>
                      apiPost(`/v1/chains/${c.id}/decide`, { decision: 'validate' })
                        .then(() => {
                          toast({ text: 'Chaîne validée', tone: 'success' });
                          reload();
                        })
                        .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }))
                    }
                    data-testid="chain-validate"
                  >
                    ✓ Valider
                  </button>
                  <button
                    className="btn ghost small-btn"
                    onClick={() =>
                      apiPost(`/v1/chains/${c.id}/decide`, { decision: 'cancel' })
                        .then(reload)
                        .catch((err: unknown) => toast({ text: errText(err), tone: 'danger' }))
                    }
                  >
                    Abandonner
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ coûts */
interface CostReport {
  since: string;
  totalMicros: number;
  runs: number;
  byAgent: { agentId: string; name: string; departmentId: string; micros: number; runs: number }[];
  byDepartment: { departmentId: string; micros: number }[];
  byTier: { tier: 'economy' | 'balanced' | 'quality'; micros: number; runs: number }[];
  autoSavingsMicros: number;
  autoRuns: number;
}
const TIER: Record<string, string> = {
  economy: 'Tier 1 · Haiku',
  balanced: 'Tier 2 · Sonnet',
  quality: 'Tier 3 · Opus',
};

function Bars({
  rows,
}: {
  rows: { label: string; micros: number; sub?: string; color?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.micros));
  return (
    <ul className="cost-bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="cost-label">{r.label}</span>
          <span className="cost-track">
            <span style={{ width: `${(r.micros / max) * 100}%`, background: r.color }} />
          </span>
          <span className="cost-value">
            {usd(r.micros)}
            {r.sub && <small> · {r.sub}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CostsPanel({ world }: { world: WorldSnapshot }) {
  const [days, setDays] = useState<number | null>(null);
  const [rep] = useLive<CostReport>(`/v1/costs${days ? `?days=${days}` : ''}`, world.lastSeq);
  const dept = (id: string) => world.departments.find((d) => d.id === id);
  return (
    <div className="ops-panel costs" data-testid="costs-panel">
      <div className="seg">
        {[
          [null, 'Ce mois'],
          [7, '7 jours'],
          [30, '30 jours'],
        ].map(([d, l]) => (
          <button
            key={String(l)}
            className={days === d ? 'on' : ''}
            onClick={() => setDays(d as number | null)}
          >
            {l}
          </button>
        ))}
      </div>
      {!rep ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <div className="cost-kpis">
            <div>
              <b>{usd(rep.totalMicros)}</b>
              <small>coût IA · {rep.runs} exécution(s)</small>
            </div>
            <div className="saving">
              <b>{usd(rep.autoSavingsMicros)}</b>
              <small>
                économisés par le mode Auto ({rep.autoRuns} exécution(s) vs tout en Opus)
              </small>
            </div>
          </div>
          <h3>Par niveau de modèle</h3>
          <Bars
            rows={rep.byTier.map((t) => ({
              label: TIER[t.tier] ?? t.tier,
              micros: t.micros,
              sub: `${t.runs} exéc.`,
              color:
                t.tier === 'economy' ? '#2a9468' : t.tier === 'balanced' ? '#3b7dd8' : '#7c60c9',
            }))}
          />
          <h3>Par pôle</h3>
          <Bars
            rows={rep.byDepartment.map((d) => ({
              label: dept(d.departmentId)?.name ?? d.departmentId,
              micros: d.micros,
              color: dept(d.departmentId)?.color,
            }))}
          />
          <h3>Par agent</h3>
          <Bars
            rows={rep.byAgent.slice(0, 15).map((a) => ({
              label: a.name,
              micros: a.micros,
              sub: `${a.runs} exéc.`,
              color: dept(a.departmentId)?.color,
            }))}
          />
        </>
      )}
    </div>
  );
}
