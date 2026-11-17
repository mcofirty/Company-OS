'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ACTIVE_INVOCATION_STATUSES,
  DEMO_TASK_CATALOG,
  isDemoTaskKind,
  type AgentView,
  type DemoTaskKind,
  type DomainEvent,
  type InvocationView,
  type TaskKind,
  type TaskView,
  type WorldSnapshot,
} from '@company-os/contracts';
import { departmentPresence } from '@company-os/world';
import { api, apiPost, ApiFailure } from '../../lib/api';
import {
  ACTIVITY_LABEL,
  ACTIVITY_TONE,
  describe,
  duration,
  INVOCATION_STATUS_LABEL,
  TASK_STATUS_LABEL,
  time,
  usd,
} from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { useControls } from '../../lib/controls';
import type { MetricsSummary } from '../../lib/useMetrics';
import { Badge, ConfirmAction, Empty, Provenance, Section, ToolIcon } from '../common';
import { ApprovalInspector, MeetingInspector, type DecideFn } from './Governance';
import { TaskDocuments } from './Documents';
import type { AgentProfile } from './AgentCard';
import { AgentManage, AgentWork, type AgentRemote } from './AgentWork';
import { FeedbackBox, TaskQualityBlock, type TaskQuality } from './TaskQuality';
import { ObjectiveBar, type ObjectiveView } from '../pages/AgentOps';
import { GrantPicker, toggleGrant } from '../cockpit/LiveForms';
import { DepartmentDialog } from '../cockpit/OrgDialogs';

interface Props {
  world: WorldSnapshot;
  selection: Selection;
  now: number;
  onSelect: (s: Selection | null) => void;
  onCreateTask: (kind: TaskKind, agentId?: string) => Promise<void>;
  onFocus: (agentId: string) => void;
  onDecide: DecideFn;
  onLifecycle: (
    agentId: string,
    action: 'pause' | 'resume' | 'deactivate',
    reason: string,
  ) => Promise<void>;
  metrics: MetricsSummary | null;
  /** Organisation live : confier une mission libre à cet agent. */
  onMission: (agentId: string) => void;
  onCancelTask: (taskId: string, reason: string) => Promise<void>;
  onRetryTask: (taskId: string) => Promise<void>;
}

/** Inspecteur universel (docs/01 §6) : provenance, état réel, horodatages, identifiants. */
export function Inspector(p: Props) {
  const { selection } = p;
  return (
    <aside className="inspector" data-testid="inspector" aria-label="Inspecteur">
      <button
        className="close"
        onClick={() => p.onSelect(null)}
        aria-label="Fermer l’inspecteur (Échap)"
      >
        ✕
      </button>
      {selection.kind === 'agent' && <AgentInspector {...p} id={selection.id} />}
      {selection.kind === 'task' && <TaskInspector {...p} id={selection.id} />}
      {selection.kind === 'invocation' && <InvocationInspector {...p} id={selection.id} />}
      {selection.kind === 'department' && <DepartmentInspector {...p} id={selection.id} />}
      {selection.kind === 'tool' && <ToolInspector {...p} id={selection.id} />}
      {selection.kind === 'approval' && (
        <ApprovalInspector
          world={p.world}
          id={selection.id}
          onSelect={p.onSelect}
          onDecide={p.onDecide}
        />
      )}
      {selection.kind === 'meeting' && (
        <MeetingInspector world={p.world} id={selection.id} onSelect={p.onSelect} />
      )}
    </aside>
  );
}

function useRemote<T>(path: string, version: unknown): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<T>(path)
      .then((r) => !cancelled && setData(r.data))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [path, version]);
  return data;
}

function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function AgentInspector({
  world,
  id,
  now,
  onSelect,
  onCreateTask,
  onFocus,
  onLifecycle,
  onMission,
}: Props & { id: string }) {
  const { caps } = useControls();
  const agent = world.agents.find((a) => a.id === id);
  const [grantsVersion, setGrantsVersion] = useState(0);
  const [editGrants, setEditGrants] = useState<Record<string, string[]> | null>(null);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const remote = useRemote<AgentRemote & { profile: AgentProfile }>(
    `/v1/agents/${id}`,
    `${id}-${grantsVersion}-${agent?.currentTaskId ?? ''}-${agent?.status ?? ''}`,
  );
  const [busy, setBusy] = useState(false);
  if (!agent) return <Empty>Agent introuvable.</Empty>;
  const dept = world.departments.find((d) => d.id === agent.departmentId);
  const manager = world.agents.find((a) => a.id === agent.managerId);
  const activeInv = world.invocations.filter(
    (i) => i.agentId === id && ACTIVE_INVOCATION_STATUSES.includes(i.status),
  );
  const recent = world.timeline
    .filter((e) => (e.payload as { agentId?: string }).agentId === id)
    .slice(0, 8);
  const kinds = (Object.keys(DEMO_TASK_CATALOG) as DemoTaskKind[]).filter(
    (k) => DEMO_TASK_CATALOG[k].departmentId === agent.departmentId,
  );
  const index = world.agents.findIndex((a) => a.id === id);
  const onBreak =
    agent.activity === 'idle' &&
    agent.lastTaskEndedAt &&
    now - Date.parse(agent.lastTaskEndedAt) < 20_000;
  return (
    <>
      <header className="insp-head">
        <span className="avatar-dot" style={{ background: dept?.color }} aria-hidden>
          {agent.name.slice(0, 1)}
        </span>
        <div>
          <h2 data-testid="inspector-title">{agent.name}</h2>
          <p className="muted">
            {agent.title} · {dept?.name}
          </p>
        </div>
      </header>
      <div className="insp-badges">
        <Badge tone={ACTIVITY_TONE[agent.activity]}>{ACTIVITY_LABEL[agent.activity]}</Badge>
        <Badge tone="neutral">{agent.status}</Badge>
        <Provenance value={agent.provenance} />
        {onBreak && <Badge tone="neutral">pause café (cosmétique)</Badge>}
      </div>
      <AgentWork
        world={world}
        agent={agent}
        now={now}
        remote={remote}
        canSchedule={caps.manageSchedules ?? false}
        onSelect={onSelect}
      />
      {activeInv.length > 0 && (
        <Section title="Outil utilisé en ce moment">
          {activeInv.map((i) => (
            <InvLink key={i.id} inv={i} world={world} now={now} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {(caps.editAgent || caps.editBudget || world.org.mode === 'live') && (
        <AgentManage
          world={world}
          agent={agent}
          remote={remote}
          canEditAgent={caps.editAgent ?? false}
          canEditBudget={caps.editBudget ?? false}
          onChanged={() => setGrantsVersion((v) => v + 1)}
        />
      )}
      <Section title="Outils autorisés">
        <p className="muted small">
          Rend compte à{' '}
          {manager ? (
            <a onClick={() => onSelect({ kind: 'agent', id: manager.id })}>{manager.name}</a>
          ) : (
            'l’administrateur'
          )}{' '}
          · identifiant <code>{agent.id}</code>
        </p>
        {editGrants ? (
          <div className="grant-editor" data-testid="grant-editor">
            <GrantPicker
              world={world}
              grants={editGrants}
              onToggle={(toolId, action) =>
                setEditGrants((g) => toggleGrant(g ?? {}, toolId, action))
              }
            />
            {grantsError && <p className="form-error">{grantsError}</p>}
            <div className="actions row">
              <button
                className="btn primary small-btn"
                disabled={busy}
                data-testid="grants-save"
                onClick={() => {
                  setBusy(true);
                  setGrantsError(null);
                  api(`/v1/agents/${id}/grants`, {
                    method: 'POST',
                    headers: { 'idempotency-key': crypto.randomUUID() },
                    body: JSON.stringify({ grants: editGrants }),
                  })
                    .then(() => {
                      setEditGrants(null);
                      setGrantsVersion((v) => v + 1);
                    })
                    .catch((e: unknown) =>
                      setGrantsError(e instanceof ApiFailure ? e.message : 'Erreur inattendue'),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Enregistrer
              </button>
              <button className="btn ghost small-btn" onClick={() => setEditGrants(null)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <div className="grants">
            {remote?.grants.map((g) => {
              const tool = world.tools.find((t) => t.id === g.toolId);
              return (
                <span key={g.toolId} className="grant" title={tool?.name ?? g.toolId}>
                  <ToolIcon tool={tool} size={22} /> {g.actions.join(', ')}
                </span>
              );
            }) ?? <span className="muted">Chargement…</span>}
            {remote && remote.grants.length === 0 && <span className="muted">Aucun outil.</span>}
            {caps.manageConnectors && remote && (
              <button
                className="btn small-btn"
                data-testid="grants-edit"
                onClick={() =>
                  setEditGrants(Object.fromEntries(remote.grants.map((g) => [g.toolId, g.actions])))
                }
              >
                Modifier les outils
              </button>
            )}
          </div>
        )}
      </Section>
      <details className="tech-log">
        <summary>Journal technique de l’agent</summary>
        <ol className="mini-log">
          {recent.map((e) => (
            <li key={e.eventId}>
              <span className="muted">{time(e.occurredAt)}</span> {describe(e, world).text}
            </li>
          ))}
        </ol>
      </details>
      <div className="actions">
        {world.org.mode === 'live' && caps.createMission && agent.status === 'active' && (
          <button
            className="btn primary"
            onClick={() => onMission(agent.id)}
            data-testid="inspector-mission"
          >
            Confier une mission
          </button>
        )}
        {caps.createTask &&
          world.org.mode !== 'live' &&
          kinds.map((k) => (
            <button
              key={k}
              className="btn"
              disabled={busy || agent.status !== 'active'}
              onClick={() => {
                setBusy(true);
                void onCreateTask(k, agent.id).finally(() => setBusy(false));
              }}
              data-testid={`assign-${k}`}
            >
              Assigner : {DEMO_TASK_CATALOG[k].title}
            </button>
          ))}
        <button className="btn ghost" onClick={() => onFocus(agent.id)}>
          Centrer sur l’avatar
        </button>
      </div>
      {(caps.pauseAgent || caps.deactivateAgent) && agent.status !== 'deactivated' && (
        <div className="actions row lifecycle">
          {caps.pauseAgent && (
            <button
              className="btn"
              disabled={busy}
              data-testid={agent.status === 'paused' ? 'agent-resume' : 'agent-pause'}
              onClick={() => {
                const action = agent.status === 'paused' ? 'resume' : 'pause';
                const reason = window.prompt(
                  action === 'pause'
                    ? 'Motif de la suspension (la tâche en cours se termine, aucune nouvelle ne démarre) :'
                    : 'Motif de la reprise :',
                );
                if (!reason || reason.trim().length < 3) return;
                setBusy(true);
                void onLifecycle(agent.id, action, reason.trim()).finally(() => setBusy(false));
              }}
            >
              {agent.status === 'paused' ? '▶ Reprendre l’agent' : '❚❚ Suspendre l’agent'}
            </button>
          )}
          {caps.deactivateAgent && (
            <button
              className="btn danger"
              disabled={busy}
              data-testid="agent-deactivate"
              onClick={() => {
                const reason = window.prompt(
                  'Motif de la désactivation (définitive ; refusée si des tâches sont ouvertes) :',
                );
                if (!reason || reason.trim().length < 3) return;
                setBusy(true);
                void onLifecycle(agent.id, 'deactivate', reason.trim()).finally(() =>
                  setBusy(false),
                );
              }}
            >
              ✕ Désactiver
            </button>
          )}
        </div>
      )}
      {caps.deleteAgent && (
        <div className="actions row lifecycle">
          <ConfirmAction
            label="🗑 Supprimer l’agent"
            confirmLabel="Supprimer définitivement"
            question={`Supprimer ${agent.name} ? ${agent.currentTaskId ? 'Sa mission en cours est arrêtée. ' : ''}Il quitte le QG et l’organigramme ; ses tâches en attente sont annulées et son équipe est rattachée à son manager. L’historique reste consultable.`}
            placeholder="Motif (ex. poste supprimé)"
            testId="agent-delete"
            onConfirm={async (reason) => {
              await api(`/v1/agents/${agent.id}/delete`, {
                method: 'POST',
                headers: { 'idempotency-key': crypto.randomUUID() },
                body: JSON.stringify({ reason }),
              });
              onSelect(null);
            }}
          />
        </div>
      )}
      <p className="hint">
        Index visuel #{index + 1} · les déplacements sont une projection locale, sans effet métier.
      </p>
    </>
  );
}

function InvLink({
  inv,
  world,
  now,
  onSelect,
}: {
  inv: InvocationView;
  world: WorldSnapshot;
  now: number;
  onSelect: (s: Selection) => void;
}) {
  const tool = world.tools.find((t) => t.id === inv.toolId);
  const running = ACTIVE_INVOCATION_STATUSES.includes(inv.status);
  return (
    <button className="link-card row" onClick={() => onSelect({ kind: 'invocation', id: inv.id })}>
      <ToolIcon tool={tool} size={24} />
      <span>
        <strong>
          {tool?.name} · {inv.action}
        </strong>
        <span>
          {INVOCATION_STATUS_LABEL[inv.status]} ·{' '}
          {duration(
            running ? now - Date.parse(inv.startedAt ?? inv.requestedAt) : (inv.durationMs ?? 0),
          )}
        </span>
      </span>
    </button>
  );
}

interface TaskDetail {
  task: TaskView;
  quality?: TaskQuality;
  feedback?: { kind: string; note: string; createdAt: string }[];
  runs: {
    id: string;
    provider: string;
    model: string | null;
    agentVersion: number;
    workflowId: string | null;
    status: string;
    stepCount: number;
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    costSource: string;
    startedAt: string;
    endedAt: string | null;
    outcomeSummary: string | null;
    failureCode: string | null;
    llmCallsDetail: {
      step: number;
      model: string;
      inputTokens: number;
      outputTokens: number;
      costMicros: number | null;
      pricingVersion: string;
      stopReason: string;
    }[];
  }[];
  invocations: InvocationView[];
  events: DomainEvent[];
}

function TaskInspector({ world, id, onSelect, onCancelTask, onRetryTask }: Props & { id: string }) {
  const { caps } = useControls();
  const [busy, setBusy] = useState(false);
  const local = world.tasks.find((t) => t.id === id);
  const detail = useRemote<TaskDetail>(`/v1/tasks/${id}`, `${local?.status}-${world.lastSeq}`);
  const task = local ?? detail?.task;
  const retriedAs =
    world.timeline.find(
      (e): e is Extract<DomainEvent, { type: 'task.cancelled' }> =>
        e.type === 'task.cancelled' && e.payload.taskId === id,
    )?.payload.retriedAs ?? null;
  if (!task) return <Empty>Chargement de la tâche…</Empty>;
  const agent = world.agents.find((a) => a.id === task.agentId);
  return (
    <>
      <header className="insp-head">
        <span className="avatar-dot task" aria-hidden>
          ◇
        </span>
        <div>
          <h2 data-testid="inspector-title">{task.title}</h2>
          <p className="muted">
            Tâche ·{' '}
            {isDemoTaskKind(task.kind)
              ? DEMO_TASK_CATALOG[task.kind].description
              : 'Mission libre rédigée par un humain'}
          </p>
        </div>
      </header>
      <div className="insp-badges">
        <Badge
          tone={
            task.status === 'succeeded'
              ? 'success'
              : task.status === 'blocked' || task.status === 'failed'
                ? 'danger'
                : 'info'
          }
        >
          {TASK_STATUS_LABEL[task.status]}
        </Badge>
        <Provenance value={task.provenance} />
      </div>
      <Kv
        rows={[
          [
            'Agent',
            agent ? (
              <a onClick={() => onSelect({ kind: 'agent', id: agent.id })}>{agent.name}</a>
            ) : (
              task.agentId
            ),
          ],
          ['Créée', time(task.createdAt)],
          ['Démarrée', task.startedAt ? time(task.startedAt) : '—'],
          ['Terminée', task.endedAt ? time(task.endedAt) : '—'],
          ['Résultat', task.resultSummary ?? '—'],
          ['Erreur', task.failureCode ?? '—'],
          [
            'Délégation',
            task.parentTaskId ? (
              <a key="p" onClick={() => onSelect({ kind: 'task', id: task.parentTaskId! })}>
                tâche parente · profondeur {task.depth}
              </a>
            ) : (
              'tâche racine'
            ),
          ],
          ['Task ID', <code key="t">{task.id}</code>],
          ['Correlation', <code key="c">{task.correlationId}</code>],
        ]}
      />
      {retriedAs && (
        <p className="small">
          Relancée :{' '}
          <a onClick={() => onSelect({ kind: 'task', id: retriedAs })} data-testid="retried-link">
            voir la nouvelle tâche
          </a>
        </p>
      )}
      {caps.createTask &&
        ['blocked', 'failed', 'queued', 'running', 'waiting_approval'].includes(task.status) && (
          <div className="actions row">
            {(task.status === 'blocked' || task.status === 'failed') && (
              <button
                className="btn primary"
                disabled={busy}
                data-testid="task-retry"
                title="Crée une tâche identique ; la tâche bloquée est annulée et reliée à la nouvelle"
                onClick={() => {
                  setBusy(true);
                  void onRetryTask(task.id).finally(() => setBusy(false));
                }}
              >
                ↻ Relancer
              </button>
            )}
            {['blocked', 'queued', 'running', 'waiting_approval'].includes(task.status) && (
              <ConfirmAction
                label={
                  task.status === 'running' || task.status === 'waiting_approval'
                    ? '■ Arrêter la mission'
                    : '⊘ Annuler'
                }
                confirmLabel="Confirmer"
                question={
                  task.status === 'running' || task.status === 'waiting_approval'
                    ? 'Arrêter la mission en cours ? L’agent s’arrête à sa prochaine étape ; les actions en attente sont rejetées.'
                    : 'Annuler cette tâche ?'
                }
                placeholder="Motif (conservé dans le journal)"
                testId="task-cancel"
                onConfirm={(reason) => onCancelTask(task.id, reason)}
              />
            )}
          </div>
        )}
      <TaskQualityBlock q={detail?.quality} onSelect={onSelect} />
      {world.org.mode === 'live' &&
        caps.createMission &&
        ['succeeded', 'failed', 'blocked', 'cancelled'].includes(task.status) && (
          <FollowUp taskId={task.id} onCreated={(id) => onSelect({ kind: 'task', id })} />
        )}
      {task.status === 'succeeded' && (
        <FeedbackBox
          taskId={task.id}
          feedback={detail?.feedback ?? []}
          live={world.org.mode === 'live'}
          onDone={(id) => id && onSelect({ kind: 'task', id })}
        />
      )}
      <TaskDocuments taskId={task.id} version={`${task.status}-${world.lastSeq}`} />
      <Section title="Exécution (run)">
        {detail?.runs.map((r) => (
          <div key={r.id} className="run-card" data-testid="run-card">
            <Kv
              rows={[
                [
                  'Fournisseur',
                  r.provider === 'demo-scripted'
                    ? 'Démo scripté — aucun LLM appelé'
                    : `${r.provider} · ${r.model ?? '—'}`,
                ],
                ['Version agent', `v${r.agentVersion}`],
                ['Statut', `${r.status}${r.failureCode ? ` · ${r.failureCode}` : ''}`],
                ['Étapes outils', String(r.stepCount)],
                ['Appels LLM', String(r.llmCalls)],
                ['Tokens', r.llmCalls ? `${r.inputTokens} entrée · ${r.outputTokens} sortie` : '—'],
                [
                  'Coût',
                  r.llmCalls
                    ? `${usd(r.costMicros)} · ${r.costSource === 'estimated' ? 'estimé (grille versionnée)' : r.costSource}`
                    : '$0.00 · aucun appel',
                ],
                ['Workflow', r.workflowId ? <code key="w">{r.workflowId}</code> : '—'],
                ['Run ID', <code key="r">{r.id}</code>],
              ]}
            />
            {r.llmCallsDetail.length > 0 && (
              <ol className="mini-log">
                {r.llmCallsDetail.map((c) => (
                  <li key={c.step}>
                    Étape {c.step + 1} · {c.model} · {c.inputTokens}/{c.outputTokens} tokens ·{' '}
                    {c.costMicros === null ? 'non tarifé' : usd(c.costMicros)} · arrêt{' '}
                    {c.stopReason}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )) ?? <Empty>—</Empty>}
        <p className="hint">
          Seuls les actions, résultats et coûts sont exposés ; jamais le raisonnement interne du
          modèle.
        </p>
      </Section>
      <Section title="Outils">
        {detail?.invocations.map((i) => (
          <InvLink key={i.id} inv={i} world={world} now={Date.now()} onSelect={onSelect} />
        ))}
      </Section>
      <Section title="Trace corrélée">
        <ol className="mini-log" data-testid="task-trace">
          {detail?.events.map((e) => (
            <li key={e.eventId}>
              <span className="muted">#{e.seq}</span> <code>{e.type}</code> ·{' '}
              {describe(e, world).text}
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

interface InvDetail {
  invocation: InvocationView;
  redactedInput: Record<string, unknown>;
  events: DomainEvent[];
}

function InvocationInspector({ world, id, now, onSelect }: Props & { id: string }) {
  const local = world.invocations.find((i) => i.id === id);
  const detail = useRemote<InvDetail>(
    `/v1/tool-invocations/${id}`,
    `${local?.status}-${local?.attempt}`,
  );
  const inv = local ?? detail?.invocation;
  if (!inv) return <Empty>Chargement de l’invocation…</Empty>;
  const tool = world.tools.find((t) => t.id === inv.toolId);
  const agent = world.agents.find((a) => a.id === inv.agentId);
  const running = ACTIVE_INVOCATION_STATUSES.includes(inv.status);
  return (
    <>
      <header className="insp-head">
        <ToolIcon tool={tool} size={40} />
        <div>
          <h2 data-testid="inspector-title">
            {tool?.name} · {inv.action}
          </h2>
          <p className="muted">Invocation d’outil · risque {inv.risk}</p>
        </div>
      </header>
      <div className="insp-badges">
        <Badge tone={inv.status === 'succeeded' ? 'success' : running ? 'accent' : 'danger'}>
          {INVOCATION_STATUS_LABEL[inv.status]}
        </Badge>
        <Provenance value={inv.provenance} />
        <Badge tone="neutral">tentative {inv.attempt}</Badge>
      </div>
      <Kv
        rows={[
          [
            'Agent',
            agent ? (
              <a onClick={() => onSelect({ kind: 'agent', id: agent.id })}>{agent.name}</a>
            ) : (
              inv.agentId
            ),
          ],
          [
            'Tâche',
            <a key="t" onClick={() => onSelect({ kind: 'task', id: inv.taskId })}>
              {world.tasks.find((t) => t.id === inv.taskId)?.title ?? 'Voir la tâche'}
            </a>,
          ],
          ['Type', inv.actionKind],
          [
            'Durée',
            duration(
              running ? now - Date.parse(inv.startedAt ?? inv.requestedAt) : (inv.durationMs ?? 0),
            ),
          ],
          ['Résultat', inv.safeSummary ?? '—'],
          ['Erreur', inv.errorCode ?? '—'],
          [
            'Entrée (redigée)',
            <code key="i">{detail ? JSON.stringify(detail.redactedInput) : '…'}</code>,
          ],
          ['Invocation ID', <code key="id">{inv.id}</code>],
          ['Correlation', <code key="c">{inv.correlationId}</code>],
        ]}
      />
      <Section title="Trace">
        <ol className="mini-log">
          {detail?.events.map((e) => (
            <li key={e.eventId}>
              <span className="muted">
                #{e.seq} {time(e.occurredAt)}
              </span>{' '}
              <code>{e.type}</code>
            </li>
          ))}
        </ol>
      </Section>
      {world.org.mode === 'demo' && (
        <p className="hint">
          Mode démo : adaptateur fictif côté serveur, aucun appel réseau externe.
        </p>
      )}
    </>
  );
}

function DepartmentInspector({ world, id, now, onSelect }: Props & { id: string }) {
  const { caps } = useControls();
  const [editing, setEditing] = useState(false);
  const dept = world.departments.find((d) => d.id === id);
  if (!dept) return <Empty>Département introuvable.</Empty>;
  const members = world.agents.filter((a) => a.departmentId === id);
  const { atDesk, total } = departmentPresence(world.agents, id, now);
  const open = world.tasks.filter(
    (t) =>
      members.some((m) => m.id === t.agentId) &&
      ['queued', 'running', 'blocked'].includes(t.status),
  );
  return (
    <>
      <header className="insp-head">
        <span className="avatar-dot" style={{ background: dept.color }} aria-hidden />
        <div>
          <h2 data-testid="inspector-title">{dept.name}</h2>
          <p className="muted">
            {atDesk}/{total} au poste · capacité {dept.capacity}
          </p>
        </div>
      </header>
      <DepartmentObjectives departmentId={dept.id} seq={world.lastSeq} />
      {caps.manageDepartments && (
        <div className="insp-actions">
          <button
            className="btn small-btn"
            onClick={() => setEditing(true)}
            data-testid="department-edit"
          >
            Renommer / couleur
          </button>
        </div>
      )}
      {editing && (
        <DepartmentDialog
          world={world}
          edit={{ id: dept.id, name: dept.name, color: dept.color }}
          onClose={() => setEditing(false)}
          toast={() => undefined}
        />
      )}
      <Section title="Équipe">
        <TeamRows agents={members} world={world} onSelect={onSelect} />
      </Section>
      <Section title="Tâches ouvertes">
        {open.length === 0 ? (
          <Empty>Aucune.</Empty>
        ) : (
          open.map((t) => (
            <button
              key={t.id}
              className="link-card"
              onClick={() => onSelect({ kind: 'task', id: t.id })}
            >
              <strong>{t.title}</strong>
              <span>{TASK_STATUS_LABEL[t.status]}</span>
            </button>
          ))
        )}
      </Section>
    </>
  );
}

function ToolInspector({ world, id, onSelect, now, metrics }: Props & { id: string }) {
  const tool = world.tools.find((t) => t.id === id);
  if (!tool) return <Empty>Outil introuvable.</Empty>;
  const h = metrics?.tools.find((t) => t.toolId === id);
  const invs = world.invocations.filter((i) => i.toolId === id).slice(0, 10);
  return (
    <>
      <header className="insp-head">
        <ToolIcon tool={tool} size={40} />
        <div>
          <h2 data-testid="inspector-title">{tool.name}</h2>
          <p className="muted">
            {tool.category} · {tool.status}
          </p>
        </div>
      </header>
      <Section title={`Santé (${metrics?.window ?? '—'})`}>
        {h ? (
          <p className="small" data-testid="tool-health">
            <Badge tone={h.health === 'healthy' ? 'success' : 'danger'}>
              {h.health === 'healthy' ? 'sain' : 'dégradé'}
            </Badge>{' '}
            {h.calls} appel(s) · {h.failures} échec(s)
            {h.errorRate != null ? ` · ${Math.round(h.errorRate * 100)} % d’erreurs` : ''}
            {h.p95Ms != null ? ` · p95 ${Math.round(h.p95Ms)} ms` : ''}
          </p>
        ) : (
          <Empty>Aucune invocation sur la fenêtre (ou indicateurs indisponibles en replay).</Empty>
        )}
      </Section>
      <Section title="Actions">
        {tool.actions.map((a) => (
          <p key={a.action} className="small">
            <code>{a.action}</code> · {a.label} · risque {a.risk}
          </p>
        ))}
      </Section>
      <Section title="Invocations récentes">
        {invs.map((i) => (
          <InvLink key={i.id} inv={i} world={world} now={now} onSelect={onSelect} />
        ))}
      </Section>
    </>
  );
}

export function TeamRows({
  agents,
  world,
  onSelect,
}: {
  agents: AgentView[];
  world: WorldSnapshot;
  onSelect: (s: Selection) => void;
}) {
  return (
    <ul className="team" data-testid="team-list">
      {agents.map((a) => {
        const dept = world.departments.find((d) => d.id === a.departmentId);
        const task = world.tasks.find((t) => t.id === a.currentTaskId);
        return (
          <li key={a.id}>
            <button
              onClick={() => onSelect({ kind: 'agent', id: a.id })}
              data-testid={`agent-${a.id}`}
            >
              <span className="avatar-dot sm" style={{ background: dept?.color }} aria-hidden>
                {a.name.slice(0, 1)}
              </span>
              <span className="team-main">
                <strong>{a.name}</strong> <span className="muted">{a.title}</span>
                <span className="team-sub">{task ? task.title : ACTIVITY_LABEL[a.activity]}</span>
              </span>
              <Badge tone={ACTIVITY_TONE[a.activity]}>{ACTIVITY_LABEL[a.activity]}</Badge>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** « Demander une suite » : même agent, il reçoit le résultat précédent et la nouvelle demande. */
export function FollowUp({
  taskId,
  onCreated,
}: {
  taskId: string;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <div className="actions row">
        <button className="btn" onClick={() => setOpen(true)} data-testid="task-follow-up">
          ↪ Demander une suite
        </button>
      </div>
    );
  }
  return (
    <div className="confirm-box neutral" data-testid="follow-up-box">
      <p>
        Que doit faire l’agent ensuite ? Il recevra le résultat et les documents de cette mission.
      </p>
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2500}
        placeholder="ex. Refais la partie 2 avec des sources ; ajoute un plan d’action."
        data-testid="follow-up-text"
      />
      {error && <p className="form-error">{error}</p>}
      <div className="actions row">
        <button
          className="btn primary"
          disabled={busy || text.trim().length < 5}
          data-testid="follow-up-send"
          onClick={() => {
            setBusy(true);
            setError(null);
            apiPost<{ id: string }>(`/v1/tasks/${taskId}/follow-up`, { instructions: text.trim() })
              .then((r) => onCreated(r.data.id))
              .catch((e: unknown) => setError(e instanceof ApiFailure ? e.message : 'Erreur'))
              .finally(() => setBusy(false));
          }}
        >
          Lancer la suite
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Objectifs du pôle et leur barre d'avancement. */
function DepartmentObjectives({ departmentId, seq }: { departmentId: string; seq: number }) {
  const list = useRemote<ObjectiveView[]>('/v1/objectives', seq);
  const mine = (list ?? []).filter((o) => o.departmentId === departmentId);
  if (!mine.length) return null;
  return (
    <Section title="Objectifs du pôle">
      {mine.map((o) => (
        <ObjectiveBar key={o.id} o={o} />
      ))}
    </Section>
  );
}
