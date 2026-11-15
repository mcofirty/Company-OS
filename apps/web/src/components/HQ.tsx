'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { AgentStatus, AgentView, DomainEvent } from '@company-os/contracts';
import { DomainEventSchema } from '@company-os/contracts';
import { API_URL, useWorld, type ConnectionState } from '../lib/useWorld';
import { describeEvent, ROLE_LABEL, STATUS_LABEL, time } from '../lib/labels';

const PhaserWorld = dynamic(() => import('./PhaserWorld').then((m) => m.PhaserWorld), {
  ssr: false,
  loading: () => <div className="world-canvas world-loading">Chargement du QG…</div>,
});

const STATUS_CSS: Record<AgentStatus, string> = {
  idle: '#9aa3ad',
  walking: '#3b82f6',
  working: '#22c55e',
  meeting: '#a855f7',
  offline: '#4b5563',
};
const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: 'Connexion…',
  live: 'Temps réel',
  reconnecting: 'Reconnexion…',
  error: 'Erreur',
};

export function HQ({ companyId }: { companyId: string }) {
  const { world, feed, connection, error } = useWorld(companyId);
  const [selected, setSelected] = useState<string | null>(null);
  const names = useMemo(() => new Map(world?.agents.map((a) => [a.id, a.name]) ?? []), [world]);
  const selectedAgent = world?.agents.find((a) => a.id === selected) ?? null;
  const counts = useMemo(() => {
    const c: Record<AgentStatus, number> = {
      idle: 0,
      walking: 0,
      working: 0,
      meeting: 0,
      offline: 0,
    };
    for (const a of world?.agents ?? []) c[a.status]++;
    return c;
  }, [world]);

  return (
    <div className="hq">
      <header className="topbar">
        <h1>Company OS · Living HQ</h1>
        {world && (
          <span
            className={`mode-badge mode-${world.mode}`}
            data-testid="mode-badge"
            title={
              world.mode === 'demo'
                ? 'Simulation déterministe : aucune activité réelle, aucun appel externe.'
                : 'Activité réelle'
            }
          >
            {world.mode === 'demo' ? 'MODE DÉMO — simulation' : 'LIVE'}
          </span>
        )}
        <span className={`conn conn-${connection}`} data-testid="connection">
          ● {CONNECTION_LABEL[connection]}
        </span>
        {world && <span className="seq">seq #{world.lastSeq}</span>}
      </header>

      {error && <div className="error-banner">API indisponible : {error}</div>}

      <main className="layout">
        <section className="world-pane">
          <div className="kpis" data-testid="kpis">
            <Kpi label="Agents" value={world?.agents.length ?? 0} />
            <Kpi label="Travaillent" value={counts.working} color={STATUS_CSS.working} />
            <Kpi label="En réunion" value={counts.meeting} color={STATUS_CSS.meeting} />
            <Kpi label="Se déplacent" value={counts.walking} color={STATUS_CSS.walking} />
            <Kpi label="Disponibles" value={counts.idle} color={STATUS_CSS.idle} />
          </div>
          <PhaserWorld world={world} selectedAgentId={selected} onSelectAgent={setSelected} />
        </section>

        <aside className="sidebar">
          {selectedAgent ? (
            <AgentInspector
              companyId={companyId}
              agent={selectedAgent}
              names={names}
              onClose={() => setSelected(null)}
            />
          ) : (
            <section className="panel">
              <h2>Agents</h2>
              <ul className="roster" data-testid="roster">
                {world?.agents.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setSelected(a.id)} data-testid={`roster-${a.id}`}>
                      <span className="dot" style={{ background: STATUS_CSS[a.status] }} />
                      <strong>{a.name}</strong>
                      <span className="muted">{ROLE_LABEL[a.role]}</span>
                      <span className="activity">{a.activity ?? STATUS_LABEL[a.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel feed-panel">
            <h2>Journal d’événements</h2>
            <ol className="feed" data-testid="feed">
              {feed.length === 0 && <li className="muted">En attente d’événements…</li>}
              {feed.map((e) => (
                <li key={e.id}>
                  <span className="muted">{time(e.occurredAt)}</span> {describeEvent(e, names)}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function AgentInspector({
  companyId,
  agent,
  names,
  onClose,
}: {
  companyId: string;
  agent: AgentView;
  names: Map<string, string>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<DomainEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/companies/${companyId}/agents/${agent.id}`)
      .then((r) => r.json())
      .then((body: { events?: unknown[] }) => {
        if (cancelled) return;
        setHistory(
          (body.events ?? []).flatMap((e) => {
            const p = DomainEventSchema.safeParse(e);
            return p.success ? [p.data] : [];
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, agent.id, agent.updatedAtSeq]);

  return (
    <section className="panel inspector" data-testid="inspector">
      <div className="inspector-head">
        <h2>{agent.name}</h2>
        <button onClick={onClose} aria-label="Fermer l’inspecteur">
          ✕
        </button>
      </div>
      <dl>
        <dt>Rôle</dt>
        <dd>{ROLE_LABEL[agent.role]}</dd>
        <dt>Statut</dt>
        <dd data-testid="inspector-status">
          <span className="dot" style={{ background: STATUS_CSS[agent.status] }} />{' '}
          {STATUS_LABEL[agent.status]}
        </dd>
        <dt>Activité</dt>
        <dd>{agent.activity ?? '—'}</dd>
        <dt>Position</dt>
        <dd>
          ({agent.position.x}, {agent.position.y})
        </dd>
        <dt>Mode</dt>
        <dd>{agent.mode === 'demo' ? 'Démo (simulé)' : 'Live'}</dd>
        <dt>Identifiant</dt>
        <dd className="mono">{agent.id}</dd>
      </dl>
      <h3>Trace d’actions</h3>
      <ol className="feed small">
        {history.map((e) => (
          <li key={e.id}>
            <span className="muted">
              #{e.seq} {time(e.occurredAt)}
            </span>{' '}
            {describeEvent(e, names)}
          </li>
        ))}
      </ol>
    </section>
  );
}
