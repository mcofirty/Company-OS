'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AgentView, ApprovalView, TaskView, WorldSnapshot } from '@company-os/contracts';
import { HQ_MAP } from '@company-os/world';
import { api } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { ACTIVITY_LABEL, ACTIVITY_TONE, duration, TASK_STATUS_LABEL, time } from '../../lib/format';
import type { Selection } from '../../world/types';
import type { DocumentView, FullDocument } from '../panels/Documents';
import { AgentPortrait } from '../panels/Portrait2D';
import { ActivityFeed } from './ActivityFeed';

export type MobilePage = 'org' | 'missions' | 'deliverables' | 'settings';
type Tab = 'home' | 'approvals' | 'team' | 'missions' | 'more';
type MissionFilter = 'open' | 'blocked' | 'done';

/** Libellés lisibles des détails d'une demande de validation. */
const PREVIEW_LABEL: Record<string, string> = {
  name: 'Nom',
  title: 'Poste',
  manager: 'Rattaché à',
  department: 'Pôle',
  role: 'Rôle',
  goal: 'Objectif',
  monthlyBudgetUsd: 'Budget / mois ($)',
  tool: 'Outil',
  action: 'Action',
  mode: 'Mode',
  to: 'Destinataire',
  subject: 'Objet',
  amount: 'Montant',
};
const OPEN: TaskView['status'][] = ['created', 'queued', 'running', 'waiting_approval'];
const DONE: TaskView['status'][] = ['succeeded', 'failed', 'cancelled'];

/**
 * Cockpit téléphone : tout piloter au pouce (valider, suivre, confier une mission, gérer l'équipe,
 * l'organigramme et les réglages). Mêmes données temps réel et mêmes droits que sur ordinateur ;
 * fiches et pages s'ouvrent en feuilles plein écran. Style iOS : barres en verre dépoli.
 */
export function MobileCockpit({
  world,
  now,
  connected,
  selection,
  onSelect,
  onDecide,
  onSystem,
  renderDetail,
  renderAgent,
  renderPage,
  orgSwitcher,
  onNewMission,
  onNewAgent,
  onNewDepartment,
  onConvene,
}: {
  world: WorldSnapshot | null;
  now: number;
  connected: boolean;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onDecide: (id: string, d: 'approve' | 'reject', reason: string) => Promise<void>;
  onSystem: (pause: boolean) => Promise<void>;
  renderDetail: (s: Selection) => ReactNode;
  renderAgent: (id: string, close: () => void) => ReactNode;
  renderPage: (p: MobilePage, close: () => void) => ReactNode;
  orgSwitcher: ReactNode;
  onNewMission: (agentId?: string) => void;
  onNewAgent: () => void;
  onNewDepartment: () => void;
  onConvene: () => void;
}) {
  const { caps } = useControls();
  const [tab, setTab] = useState<Tab>('home');
  const [page, setPage] = useState<MobilePage | 'feed' | 'docs' | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [filter, setFilter] = useState<MissionFilter>('open');
  const [reading, setReading] = useState<FullDocument | null>(null);
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const lastSeq = world?.lastSeq ?? 0;
  useEffect(() => {
    if (page !== 'docs') return;
    api<DocumentView[]>('/v1/documents?limit=30')
      .then((r) => setDocs(r.data))
      .catch(() => setDocs([]));
  }, [page, lastSeq]);

  const agents = useMemo(
    () => (world?.agents ?? []).filter((a) => a.status !== 'deactivated'),
    [world?.agents],
  );
  const agentById = (id: string): AgentView | undefined => world?.agents.find((a) => a.id === id);
  const pending = (world?.approvals ?? []).filter((a) => a.status === 'pending');
  const open = (world?.tasks ?? []).filter((t) => OPEN.includes(t.status));
  const blockedTasks = (world?.tasks ?? []).filter((t) => t.status === 'blocked');
  const blockedAgents = agents.filter((a) => a.activity === 'blocked');
  const tasksFor = (f: MissionFilter): TaskView[] =>
    (world?.tasks ?? [])
      .filter((t) =>
        f === 'open'
          ? OPEN.includes(t.status)
          : f === 'blocked'
            ? t.status === 'blocked'
            : DONE.includes(t.status),
      )
      .sort((a, b) => (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt))
      .slice(0, 40);
  const today = new Date(now).toDateString();
  const doneToday = (world?.tasks ?? []).filter(
    (t) => t.status === 'succeeded' && t.endedAt && new Date(t.endedAt).toDateString() === today,
  ).length;

  const TITLES: Record<Tab, string> = {
    home: 'Accueil',
    approvals: 'À valider',
    team: 'Équipe',
    missions: 'Missions',
    more: 'Plus',
  };
  const go = (t: Tab): void => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const face = (a: AgentView | undefined, size: number): ReactNode =>
    world && a ? <AgentPortrait world={world} agent={a} size={size} crop="head" /> : null;

  const agentRow = (a: AgentView): ReactNode => {
    const task = world?.tasks.find((t) => t.id === a.currentTaskId);
    return (
      <li key={a.id}>
        <button
          className="m-row"
          onClick={() => onSelect({ kind: 'agent', id: a.id })}
          data-testid={`m-agent-${a.id}`}
        >
          <span className="m-face">{face(a, 40)}</span>
          <span className="m-main">
            <strong>{a.name}</strong>
            <small>{task ? task.title : a.title}</small>
          </span>
          <span className={`m-pill tone-${ACTIVITY_TONE[a.activity]}`}>
            {ACTIVITY_LABEL[a.activity]}
          </span>
        </button>
      </li>
    );
  };

  const taskRow = (t: TaskView): ReactNode => {
    const a = agentById(t.agentId);
    return (
      <li key={t.id}>
        <button
          className="m-row"
          onClick={() => onSelect({ kind: 'task', id: t.id })}
          data-testid="m-task"
        >
          <span className="m-face">{face(a, 40)}</span>
          <span className="m-main">
            <strong>{t.title}</strong>
            <small>
              {a?.name ?? t.agentId}
              {t.startedAt && OPEN.includes(t.status)
                ? ` · depuis ${duration(now - Date.parse(t.startedAt))}`
                : t.endedAt
                  ? ` · ${time(t.endedAt)}`
                  : ''}
            </small>
          </span>
          <span className={`m-pill st-${t.status}`}>{TASK_STATUS_LABEL[t.status]}</span>
        </button>
      </li>
    );
  };

  const approvalCard = (ap: ApprovalView): ReactNode => {
    const a = agentById(ap.agentId);
    const preview = Object.entries(ap.safePreview)
      .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      .slice(0, 6);
    return (
      <li key={ap.id} className="m-card" data-testid="m-approval">
        <div className="m-row static">
          <span className="m-face">{face(a, 40)}</span>
          <span className="m-main">
            <strong>
              {ap.kind === 'agent_hire' ? 'Recrutement' : `${ap.toolId ?? ''} · ${ap.action ?? ''}`}
            </strong>
            <small>
              {a?.name ?? ap.agentId} · expire {time(ap.deadlineAt)}
            </small>
          </span>
        </div>
        <p className="m-text">{ap.riskReason}</p>
        {preview.length > 0 && (
          <dl className="m-preview">
            {preview.map(([k, v]) => (
              <div key={k}>
                <dt>{PREVIEW_LABEL[k] ?? k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {caps.decideApproval ? (
          <div className="m-actions">
            <button
              className="m-btn danger"
              onClick={() => {
                const reason = window.prompt('Motif du refus :', 'Refusé depuis le téléphone');
                if (reason && reason.trim().length >= 3)
                  void onDecide(ap.id, 'reject', reason.trim());
              }}
            >
              Refuser
            </button>
            <button
              className="m-btn primary"
              onClick={() => void onDecide(ap.id, 'approve', 'Validé depuis le téléphone')}
              data-testid="mobile-approve"
            >
              Valider
            </button>
          </div>
        ) : (
          <p className="m-note">Décision réservée à un administrateur.</p>
        )}
      </li>
    );
  };

  /** Plan du QG en direct : zones des pôles et position de chaque agent à son poste. */
  const miniMap = (): ReactNode => {
    if (!world) return null;
    const W = HQ_MAP.cols;
    const H = HQ_MAP.rows;
    return (
      <svg className="m-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Plan du QG en direct">
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="1" className="m-map-floor" />
        {HQ_MAP.rooms.map((r) => {
          const d = world.departments.find((x) => x.roomId === r.id);
          return (
            <rect
              key={r.id}
              x={r.rect.x0 + 0.2}
              y={r.rect.y0 + 0.2}
              width={r.rect.x1 - r.rect.x0 + 0.6}
              height={r.rect.y1 - r.rect.y0 + 0.6}
              rx="1"
              fill={d?.color ?? r.color}
              opacity={d ? 0.55 : 0.25}
            />
          );
        })}
        {agents.map((a) => {
          const anchor = HQ_MAP.anchors[a.deskAnchor];
          if (!anchor) return null;
          const tone = ACTIVITY_TONE[a.activity];
          return (
            <circle
              key={a.id}
              cx={anchor.x + 0.5}
              cy={anchor.y + 0.5}
              r="1.1"
              className={`m-dot tone-${tone}`}
              onClick={() => onSelect({ kind: 'agent', id: a.id })}
            />
          );
        })}
      </svg>
    );
  };

  const sheet = (title: string, close: () => void, body: ReactNode, testId?: string): ReactNode => (
    <div
      className="m-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <header className="m-sheet-bar m-glass">
        <span className="m-grabber" aria-hidden />
        <button className="m-link" onClick={close} data-testid="m-sheet-close">
          ‹ Retour
        </button>
        <strong>{title}</strong>
        <span />
      </header>
      <div className="m-sheet-body">{body}</div>
    </div>
  );

  const selTitle = (s: Selection): string =>
    s.kind === 'agent'
      ? (agentById(s.id)?.name ?? 'Agent')
      : s.kind === 'task'
        ? 'Mission'
        : s.kind === 'approval'
          ? 'Validation'
          : s.kind === 'meeting'
            ? 'Réunion'
            : s.kind === 'department'
              ? 'Pôle'
              : 'Détail';
  const PAGE_TITLE: Record<MobilePage | 'feed' | 'docs', string> = {
    org: 'Organigramme',
    missions: 'Missions',
    deliverables: 'Livrables',
    settings: 'Réglages',
    feed: 'Activité',
    docs: 'Livrables',
  };

  return (
    <div className="mobile-cockpit" data-testid="mobile-view">
      <div className="m-backdrop" aria-hidden />
      <header className="m-top m-glass">
        <div className="m-top-row">
          <span className={`m-mode ${world?.org.mode ?? 'demo'}`}>
            {world?.org.mode === 'live' ? 'LIVE' : 'DÉMO'}
          </span>
          <span className="m-org">{world?.org.name ?? 'Chargement…'}</span>
          <span
            className={`m-conn ${connected ? 'on' : ''}`}
            title={connected ? 'Temps réel' : 'Hors ligne'}
          />
        </div>
        <h1 className="m-title">{TITLES[tab]}</h1>
      </header>

      <main className="m-content">
        {world?.system.paused && (
          <div className="m-banner danger">Système en pause : aucune mission ne démarre.</div>
        )}
        {world?.org.mode === 'demo' && (
          <div className="m-banner">Démo : activité simulée, aucun effet réel.</div>
        )}

        {tab === 'home' && (
          <>
            <div className="m-kpis">
              <div className="m-kpi m-glass-card">
                <b>{agents.filter((a) => a.status === 'active').length}</b>
                <small>agents actifs</small>
              </div>
              <div className="m-kpi m-glass-card">
                <b>{open.length}</b>
                <small>en cours</small>
              </div>
              <div className="m-kpi m-glass-card">
                <b>{doneToday}</b>
                <small>réussies aujourd’hui</small>
              </div>
            </div>
            {blockedAgents.length > 0 && (
              <button
                className="m-banner danger"
                onClick={() => onSelect({ kind: 'agent', id: blockedAgents[0]!.id })}
              >
                {blockedAgents.length} agent(s) bloqué(s) ·{' '}
                {blockedAgents.map((a) => a.name).join(', ')} ›
              </button>
            )}
            <div className="m-section">
              <h2>À valider</h2>
              {pending.length > 2 && (
                <button className="m-link" onClick={() => go('approvals')}>
                  Tout voir ({pending.length})
                </button>
              )}
            </div>
            {pending.length === 0 ? (
              <p className="m-empty">Rien à valider.</p>
            ) : (
              <ul className="m-list plain">{pending.slice(0, 2).map(approvalCard)}</ul>
            )}
            <div className="m-section">
              <h2>En cours</h2>
              <button className="m-link" onClick={() => go('missions')}>
                Missions
              </button>
            </div>
            {open.length === 0 ? (
              <p className="m-empty">Aucune mission en cours.</p>
            ) : (
              <ul className="m-list">{open.slice(0, 5).map(taskRow)}</ul>
            )}
            <div className="m-section">
              <h2>Le QG en direct</h2>
            </div>
            <div className="m-glass-card m-map-card">{miniMap()}</div>
          </>
        )}

        {tab === 'approvals' &&
          (pending.length === 0 ? (
            <p className="m-empty big">Rien à valider. 👍</p>
          ) : (
            <ul className="m-list plain">{pending.map(approvalCard)}</ul>
          ))}

        {tab === 'team' && (
          <>
            <div className="m-chips" role="toolbar" aria-label="Filtrer par pôle">
              <button className={dept === null ? 'on' : ''} onClick={() => setDept(null)}>
                Tous
              </button>
              {(world?.departments ?? []).map((d) => (
                <button
                  key={d.id}
                  className={dept === d.id ? 'on' : ''}
                  onClick={() => setDept(d.id)}
                >
                  <i style={{ background: d.color }} /> {d.name}
                </button>
              ))}
            </div>
            <ul className="m-list">
              {agents.filter((a) => !dept || a.departmentId === dept).map(agentRow)}
            </ul>
            <div className="m-grid-actions">
              {caps.createAgent && (
                <button className="m-btn primary" onClick={onNewAgent} data-testid="m-new-agent">
                  ＋ Agent
                </button>
              )}
              {caps.manageDepartments && (
                <button className="m-btn" onClick={onNewDepartment}>
                  ＋ Pôle
                </button>
              )}
              {caps.conveneMeeting && (
                <button className="m-btn" onClick={onConvene}>
                  ◎ Réunion
                </button>
              )}
              <button className="m-btn" onClick={() => setPage('org')}>
                ⑂ Organigramme
              </button>
            </div>
          </>
        )}

        {tab === 'missions' && (
          <>
            <div className="m-segmented" role="tablist">
              {(
                [
                  ['open', `En cours (${open.length})`],
                  ['blocked', `Bloquées (${blockedTasks.length})`],
                  ['done', 'Terminées'],
                ] as [MissionFilter, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            {tasksFor(filter).length === 0 ? (
              <p className="m-empty">Aucune mission.</p>
            ) : (
              <ul className="m-list">{tasksFor(filter).map(taskRow)}</ul>
            )}
            <button className="m-btn wide" onClick={() => setPage('missions')}>
              Récurrentes, objectifs, chaînes ›
            </button>
          </>
        )}

        {tab === 'more' && (
          <>
            <ul className="m-list">
              {(
                [
                  ['org', '⑂', 'Organigramme'],
                  ['docs', '📄', 'Livrables'],
                  ['missions', '🔁', 'Récurrentes, objectifs et chaînes'],
                  ['feed', '⚡', 'Activité en direct'],
                  ['settings', '⚙', 'Réglages, coûts et notifications'],
                ] as [MobilePage | 'feed' | 'docs', string, string][]
              ).map(([p, icon, label]) => (
                <li key={p}>
                  <button className="m-row" onClick={() => setPage(p)} data-testid={`m-more-${p}`}>
                    <span className="m-icon">{icon}</span>
                    <span className="m-main">
                      <strong>{label}</strong>
                    </span>
                    <span className="m-chev">›</span>
                  </button>
                </li>
              ))}
            </ul>
            {orgSwitcher && (
              <div className="m-glass-card m-field">
                <label>Organisation</label>
                {orgSwitcher}
              </div>
            )}
            {world && caps.systemControl && (
              <button
                className={`m-btn wide ${world.system.paused ? 'primary' : 'danger solid'}`}
                data-testid="m-kill-switch"
                onClick={() => {
                  const pause = !world.system.paused;
                  const ok = window.confirm(
                    pause
                      ? 'Mettre le système en pause ? Aucune nouvelle exécution ne sera lancée.'
                      : 'Reprendre l’exécution des agents ?',
                  );
                  if (ok) void onSystem(pause);
                }}
              >
                {world.system.paused
                  ? '▶ Reprendre le système'
                  : '■ Pause système (arrêt d’urgence)'}
              </button>
            )}
            <p className="m-note">Le QG en 3D s’affiche sur ordinateur ou tablette.</p>
          </>
        )}
      </main>

      {caps.createMission && world?.org.mode === 'live' && (
        <button
          className="m-fab m-glass"
          onClick={() => onNewMission()}
          aria-label="Nouvelle mission"
          data-testid="m-new-mission"
        >
          ＋
        </button>
      )}

      <nav className="m-tabbar m-glass" aria-label="Navigation">
        {(
          [
            ['home', '⌂', 'Accueil', 0],
            ['approvals', '✓', 'À valider', pending.length],
            ['team', '☺', 'Équipe', 0],
            ['missions', '☰', 'Missions', 0],
            ['more', '⋯', 'Plus', 0],
          ] as [Tab, string, string, number][]
        ).map(([k, icon, label, n]) => (
          <button
            key={k}
            aria-current={tab === k ? 'page' : undefined}
            onClick={() => go(k)}
            data-testid={`m-tab-${k}`}
          >
            <span className="m-tab-icon">{icon}</span>
            <span>{label}</span>
            {n > 0 && <em>{n}</em>}
          </button>
        ))}
      </nav>

      {page &&
        sheet(
          PAGE_TITLE[page],
          () => {
            setPage(null);
            setReading(null);
          },
          page === 'feed' ? (
            <ActivityFeed world={world} onSelect={onSelect} />
          ) : page === 'docs' ? (
            reading ? (
              <article className="m-doc" data-testid="mobile-reader">
                <button className="m-link" onClick={() => setReading(null)}>
                  ‹ Livrables
                </button>
                <h2>{reading.title}</h2>
                <p className="m-note">{time(reading.createdAt)}</p>
                <div className="m-doc-text">{reading.content}</div>
              </article>
            ) : !docs ? (
              <p className="m-empty">Chargement…</p>
            ) : docs.length === 0 ? (
              <p className="m-empty">Aucun livrable pour l’instant.</p>
            ) : (
              <ul className="m-list">
                {docs.map((d) => (
                  <li key={d.id}>
                    <button
                      className="m-row"
                      onClick={() =>
                        void api<FullDocument>(`/v1/documents/${d.id}`).then((r) =>
                          setReading(r.data),
                        )
                      }
                    >
                      <span className="m-icon">📄</span>
                      <span className="m-main">
                        <strong>{d.title}</strong>
                        <small>
                          {agentById(d.agentId)?.name ?? d.agentId} · {time(d.createdAt)}
                        </small>
                      </span>
                      <span className="m-chev">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            renderPage(page, () => setPage(null))
          ),
          `m-page-${page}`,
        )}

      {selection &&
        sheet(
          selTitle(selection),
          () => onSelect(null),
          selection.kind === 'agent'
            ? renderAgent(selection.id, () => onSelect(null))
            : renderDetail(selection),
          'm-detail',
        )}
    </div>
  );
}
