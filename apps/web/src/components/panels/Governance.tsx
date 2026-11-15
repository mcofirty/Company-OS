'use client';

import { useEffect, useState } from 'react';
import type { ApprovalView, MeetingView, TaskView, WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { duration, TASK_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { Badge, Empty, Section } from '../common';

export type DecideFn = (
  approvalId: string,
  decision: 'approve' | 'reject',
  reason: string,
) => Promise<void>;

const KIND_LABEL: Record<ApprovalView['kind'], string> = {
  tool_action: 'Action externe',
  agent_hire: 'Nouvel agent',
};
const STATUS_TONE: Record<ApprovalView['status'], string> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
};
const STATUS_LABEL: Record<ApprovalView['status'], string> = {
  pending: 'EN ATTENTE',
  approved: 'APPROUVÉE',
  rejected: 'REFUSÉE',
  expired: 'EXPIRÉE',
  cancelled: 'ANNULÉE',
};

/** Boîte d'approbations (docs/14 §6) : les validations ne se cachent jamais derrière le jeu. */
export function ApprovalsInbox({
  world,
  now,
  onSelect,
}: {
  world: WorldSnapshot;
  now: number;
  onSelect: (s: Selection) => void;
}) {
  const pending = world.approvals.filter((a) => a.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <section
      className="panel approvals"
      aria-label="Validations en attente"
      data-testid="approvals-inbox"
    >
      <header className="panel-head">
        <h2>À valider</h2>
        <Badge tone="warning">{pending.length}</Badge>
      </header>
      {pending.map((a) => (
        <button
          key={a.id}
          className="approval-row"
          onClick={() => onSelect({ kind: 'approval', id: a.id })}
          data-testid="approval-row"
          data-task-id={a.taskId ?? undefined}
        >
          <span className="approval-kind">{KIND_LABEL[a.kind]}</span>
          <strong>{summaryOf(a, world)}</strong>
          <span className="muted">
            {world.agents.find((x) => x.id === a.agentId)?.name ?? a.agentId} · expire dans{' '}
            {duration(Date.parse(a.deadlineAt) - now)}
          </span>
        </button>
      ))}
    </section>
  );
}

function summaryOf(a: ApprovalView, world: WorldSnapshot): string {
  if (a.kind === 'agent_hire')
    return `${String(a.safePreview['name'] ?? '?')} · ${String(a.safePreview['title'] ?? '')}`;
  const tool = world.tools.find((t) => t.id === a.toolId);
  return `${tool?.name ?? a.toolId} · ${a.action}`;
}

export function ApprovalInspector({
  world,
  id,
  onSelect,
  onDecide,
}: {
  world: WorldSnapshot;
  id: string;
  onSelect: (s: Selection) => void;
  onDecide: DecideFn;
}) {
  const a = world.approvals.find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  const { caps } = useControls();
  if (!a) return <Empty>Demande introuvable (hors de la fenêtre récente).</Empty>;
  const requester = world.agents.find((x) => x.id === a.agentId);
  const decide = (decision: 'approve' | 'reject'): void => {
    const reason = window.prompt(
      decision === 'approve' ? 'Motif de l’approbation' : 'Motif du refus',
      decision === 'approve' ? 'Validé par l’opérateur' : 'Refusé par l’opérateur',
    );
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    void onDecide(a.id, decision, reason.trim()).finally(() => setBusy(false));
  };
  return (
    <>
      <header className="insp-head">
        <span className="avatar-dot approval" aria-hidden>
          ?
        </span>
        <div>
          <h2 data-testid="inspector-title">{KIND_LABEL[a.kind]}</h2>
          <p className="muted">{summaryOf(a, world)}</p>
        </div>
      </header>
      <div className="insp-badges">
        <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
        <Badge tone="neutral">
          {a.kind === 'agent_hire' ? 'décision engageante' : 'effet externe'}
        </Badge>
      </div>
      <p className="risk">{a.riskReason}</p>
      <Section title="Aperçu (rédigé)">
        <dl className="kv">
          {Object.entries(a.safePreview).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Traçabilité">
        <dl className="kv">
          <div>
            <dt>Demandé par</dt>
            <dd>
              {requester ? (
                <a onClick={() => onSelect({ kind: 'agent', id: requester.id })}>
                  {requester.name}
                </a>
              ) : (
                a.agentId
              )}
            </dd>
          </div>
          {a.taskId && (
            <div>
              <dt>Tâche</dt>
              <dd>
                <a onClick={() => onSelect({ kind: 'task', id: a.taskId! })}>
                  {world.tasks.find((t) => t.id === a.taskId)?.title ?? 'Voir'}
                </a>
              </dd>
            </div>
          )}
          {a.invocationId && (
            <div>
              <dt>Invocation</dt>
              <dd>
                <a onClick={() => onSelect({ kind: 'invocation', id: a.invocationId! })}>
                  {a.invocationId.slice(0, 8)}
                </a>
              </dd>
            </div>
          )}
          <div>
            <dt>Demandé</dt>
            <dd>{time(a.requestedAt)}</dd>
          </div>
          <div>
            <dt>Échéance</dt>
            <dd>{time(a.deadlineAt)}</dd>
          </div>
          {a.reviewedBy && (
            <div>
              <dt>Décision</dt>
              <dd>
                {a.reviewedBy} · {a.reviewedAt ? time(a.reviewedAt) : ''} · {a.decisionReason}
              </dd>
            </div>
          )}
        </dl>
      </Section>
      {a.status === 'pending' && caps.decideApproval && (
        <div className="actions row">
          <button
            className="btn approve"
            disabled={busy}
            onClick={() => decide('approve')}
            data-testid="approve"
          >
            ✓ Approuver
          </button>
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => decide('reject')}
            data-testid="reject"
          >
            ✕ Refuser
          </button>
        </div>
      )}
      <p className="hint">
        {a.kind === 'agent_hire'
          ? 'Approuver crée l’agent avec exactement les outils listés, un budget plafonné, et l’installe à un poste libre.'
          : 'Approuver autorise cette seule action ; la plateforme revérifie les droits au moment de l’exécution.'}
      </p>
    </>
  );
}

interface MeetingDetail {
  meeting: MeetingView;
  tasksCreated: TaskView[];
}

export function MeetingInspector({
  world,
  id,
  onSelect,
}: {
  world: WorldSnapshot;
  id: string;
  onSelect: (s: Selection) => void;
}) {
  const local = world.meetings.find((m) => m.id === id);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<MeetingDetail>(`/v1/meetings/${id}`)
      .then((r) => !cancelled && setDetail(r.data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, local?.status]);
  const m = local ?? detail?.meeting;
  if (!m) return <Empty>Chargement de la réunion…</Empty>;
  const name = (aid: string): string => world.agents.find((a) => a.id === aid)?.name ?? aid;
  return (
    <>
      <header className="insp-head">
        <span className="avatar-dot meeting" aria-hidden>
          ◎
        </span>
        <div>
          <h2 data-testid="inspector-title">{m.topic}</h2>
          <p className="muted">
            Réunion · {m.roomId === 'meeting' ? 'Salle de réunion' : m.roomId}
          </p>
        </div>
      </header>
      <div className="insp-badges">
        <Badge tone={m.status === 'in_progress' ? 'accent' : 'success'}>
          {m.status === 'in_progress' ? 'EN COURS' : 'TERMINÉE'}
        </Badge>
      </div>
      <Section title="Participants (sièges réservés)">
        <ul className="mini-log">
          {m.participantAgentIds.map((p) => (
            <li key={p}>
              <a onClick={() => onSelect({ kind: 'agent', id: p })}>{name(p)}</a> · {m.seats[p]}
              {p === m.initiatorAgentId ? ' · initiateur' : ''}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Synthèse">
        {m.summary ? <p className="small">{m.summary}</p> : <Empty>En cours…</Empty>}
      </Section>
      <Section title="Décisions">
        {m.decisions.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <ol className="mini-log">
            {m.decisions.map((d, i) => (
              <li key={i}>
                {d.decision} · <span className="muted">responsable : {name(d.ownerAgentId)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Tâches déléguées">
        {(detail?.tasksCreated ?? []).map((t) => (
          <button
            key={t.id}
            className="link-card"
            onClick={() => onSelect({ kind: 'task', id: t.id })}
          >
            <strong>{t.title}</strong>
            <span>
              {name(t.agentId)} · {TASK_STATUS_LABEL[t.status]} · profondeur {t.depth}
            </span>
          </button>
        ))}
        {m.taskIdsCreated.length === 0 && <Empty>Aucune.</Empty>}
      </Section>
      <p className="hint">
        La co-présence représente les participants déclarés. Seuls les résumés et décisions sont
        exposés, jamais de raisonnement interne.
      </p>
    </>
  );
}
