'use client';

import { useMemo, useState, type DragEvent, type JSX } from 'react';
import type { AgentView, WorldSnapshot } from '@company-os/contracts';
import { api, ApiFailure } from '../../lib/api';
import { ACTIVITY_LABEL } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { Portrait } from '../panels/AgentCard';

const ROOT = '__admin__';

interface Node {
  agent: AgentView;
  children: Node[];
}

/**
 * Organigramme (responsabilités) : arbre des rattachements réels (`managerId`), racine =
 * l'administrateur humain. Un admin réorganise par glisser-déposer ou via la barre d'actions
 * (rattacher, promouvoir / rétrograder). Chaque changement est vérifié par le serveur (pas de
 * cycle…) et journalisé (`agent.reporting.updated`) ; l'arbre se met à jour par les événements.
 */
export function OrgChart({
  world,
  canEdit,
  onClose,
  onSelect,
}: {
  world: WorldSnapshot;
  canEdit: boolean;
  onClose: () => void;
  onSelect: (s: Selection) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const agents = useMemo(
    () => world.agents.filter((a) => a.status !== 'deactivated'),
    [world.agents],
  );
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const tree = useMemo(() => {
    const kids = new Map<string, AgentView[]>();
    for (const a of agents) {
      const parent = a.managerId && byId.has(a.managerId) ? a.managerId : ROOT;
      kids.set(parent, [...(kids.get(parent) ?? []), a]);
    }
    const build = (id: string, seen: Set<string>): Node[] =>
      (kids.get(id) ?? [])
        .filter((a) => !seen.has(a.id))
        .sort((x, y) =>
          x.role === y.role ? x.name.localeCompare(y.name) : x.role === 'manager' ? -1 : 1,
        )
        .map((a) => ({ agent: a, children: build(a.id, new Set([...seen, a.id])) }));
    return build(ROOT, new Set());
  }, [agents, byId]);

  // Propositions de recrutement en attente : nœuds en pointillés sous le manager demandeur.
  const pendingHires = world.approvals.filter(
    (ap) => ap.kind === 'agent_hire' && ap.status === 'pending',
  );
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (x: string): void => {
      for (const a of agents) {
        if (a.managerId !== x || out.has(a.id)) continue;
        out.add(a.id);
        walk(a.id);
      }
    };
    walk(id);
    return out;
  };

  const report = async (agentId: string, managerId: string | null, role?: string) => {
    const agent = byId.get(agentId);
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/agents/${agentId}/reporting`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          managerId,
          role: role ?? (agent.role === 'manager' ? 'manager' : 'specialist'),
        }),
      });
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Erreur inattendue');
    } finally {
      setBusy(false);
    }
  };

  const dropOn = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = dragging ?? e.dataTransfer.getData('text/plain');
    setDragging(null);
    if (!id || id === target) return;
    const managerId = target === ROOT ? null : target;
    if ((byId.get(id)?.managerId ?? null) === managerId) return;
    void report(id, managerId);
  };
  const dropProps = (target: string) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragging || dragging === target) return;
            if (target !== ROOT && descendants(dragging).has(target)) return; // cycle
            e.preventDefault();
            setOver(target);
          },
          onDragLeave: () => setOver((o) => (o === target ? null : o)),
          onDrop: dropOn(target),
        }
      : {};

  const deptOf = (a: AgentView) => world.departments.find((d) => d.id === a.departmentId);
  const card = (a: AgentView) => {
    const dept = deptOf(a);
    const task = world.tasks.find((t) => t.id === a.currentTaskId);
    const reports = agents.filter((x) => x.managerId === a.id).length;
    const statusColor =
      a.status === 'paused' ? '#d49c30' : a.activity === 'idle' ? '#9a93a8' : '#3c9d4e';
    return (
      <div
        className={`org-node${picked === a.id ? ' picked' : ''}${over === a.id ? ' drop' : ''}`}
        style={{ borderTopColor: dept?.color }}
        draggable={canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', a.id);
          setDragging(a.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        onClick={() => setPicked(a.id)}
        data-testid={`org-node-${a.id}`}
        {...dropProps(a.id)}
      >
        <span className="org-face" style={{ background: `${dept?.color ?? '#ccc'}33` }}>
          <Portrait avatarId={a.avatarId} scale={2} crop="head" />
        </span>
        <span className="org-id">
          <strong>{a.name}</strong>
          <span className="muted small">{a.title}</span>
          <span className="org-meta">
            {a.role === 'manager' && <span className="org-chief">★ Manager</span>}
            <span className="org-dept" style={{ color: dept?.color }}>
              {dept?.name}
            </span>
          </span>
          <span className="org-status">
            <span className="dot" style={{ background: statusColor }} aria-hidden />
            {task ? task.title : a.status === 'paused' ? 'Suspendu' : ACTIVITY_LABEL[a.activity]}
          </span>
          {reports > 0 && <span className="muted small">{reports} subordonné(s)</span>}
        </span>
      </div>
    );
  };
  const branch = (nodes: Node[], parentId: string): JSX.Element | null => {
    const hires = pendingHires.filter((h) => h.agentId === parentId);
    if (nodes.length === 0 && hires.length === 0) return null;
    return (
      <ul>
        {nodes.map((n) => (
          <li key={n.agent.id}>
            {card(n.agent)}
            {branch(n.children, n.agent.id)}
          </li>
        ))}
        {hires.map((h) => (
          <li key={h.id}>
            <button
              className="org-node pending"
              onClick={() => {
                onSelect({ kind: 'approval', id: h.id });
                onClose();
              }}
              data-testid="org-pending-hire"
            >
              <span className="org-id">
                <strong>{String(h.safePreview['name'] ?? 'Nouvel agent')}</strong>
                <span className="muted small">{String(h.safePreview['title'] ?? '')}</span>
                <span className="org-chief">⏳ Recrutement proposé · à valider</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const sel = picked ? byId.get(picked) : undefined;
  const eligible = sel
    ? agents.filter((a) => a.id !== sel.id && !descendants(sel.id).has(a.id))
    : [];
  const managers = agents.filter((a) => a.role === 'manager').length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Organigramme">
      <div className="modal org-modal" data-testid="org-chart">
        <header className="org-head">
          <div>
            <h2>Organigramme</h2>
            <p className="muted small">
              {agents.length} agent(s) · {managers} manager(s) · qui rend compte à qui.
              {canEdit
                ? ' Glissez une carte sur un manager (ou sur « Vous ») pour la rattacher ; cliquez pour plus d’actions.'
                : ' Lecture seule.'}
            </p>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Fermer l’organigramme">
            ✕
          </button>
        </header>
        {error && (
          <p className="form-error" role="alert" data-testid="org-error">
            {error}
          </p>
        )}
        <div className="org-scroll">
          <div className="org-tree">
            <ul>
              <li>
                <div
                  className={`org-node root${over === ROOT ? ' drop' : ''}`}
                  data-testid="org-root"
                  {...dropProps(ROOT)}
                >
                  <span className="org-id">
                    <strong>Vous</strong>
                    <span className="muted small">Administrateur humain · décide et valide</span>
                  </span>
                </div>
                {branch(tree, ROOT)}
              </li>
            </ul>
          </div>
          {agents.length === 0 && <p className="muted">Aucun agent pour l’instant.</p>}
        </div>
        {sel && (
          <footer className="org-actions" data-testid="org-actions">
            <strong>{sel.name}</strong>
            <button
              className="btn small-btn"
              onClick={() => {
                onSelect({ kind: 'agent', id: sel.id });
                onClose();
              }}
            >
              Ouvrir la fiche
            </button>
            {canEdit && (
              <>
                <label className="org-attach">
                  Rend compte à
                  <select
                    value={sel.managerId ?? ROOT}
                    disabled={busy}
                    data-testid="org-manager-select"
                    onChange={(e) =>
                      void report(sel.id, e.target.value === ROOT ? null : e.target.value)
                    }
                  >
                    <option value={ROOT}>Vous (administrateur)</option>
                    {eligible.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {a.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn small-btn"
                  disabled={busy}
                  data-testid="org-toggle-role"
                  onClick={() =>
                    void report(
                      sel.id,
                      sel.managerId,
                      sel.role === 'manager' ? 'specialist' : 'manager',
                    )
                  }
                >
                  {sel.role === 'manager' ? 'Retirer le rôle de manager' : '★ Nommer manager'}
                </button>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
