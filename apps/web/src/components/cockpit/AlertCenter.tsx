'use client';

import { useState } from 'react';
import type { AlertView, WorldSnapshot } from '@company-os/contracts';
import { useControls } from '../../lib/controls';
import { time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';

const LEVEL_LABEL: Record<AlertView['level'], string> = {
  critical: 'CRITIQUE',
  error: 'ERREUR',
  warning: 'ATTENTION',
  info: 'INFO',
};

function target(a: AlertView): Selection | null {
  switch (a.resourceType) {
    case 'task':
      return { kind: 'task', id: a.resourceId };
    case 'invocation':
      return { kind: 'invocation', id: a.resourceId };
    case 'approval':
      return { kind: 'approval', id: a.resourceId };
    case 'agent':
      return { kind: 'agent', id: a.resourceId };
    default:
      return null;
  }
}

/** Centre d'alertes (docs/10 §5) : alertes persistées, niveau, acquittement, lien vers l'objet. */
export function AlertCenter({
  world,
  onSelect,
  onAck,
}: {
  world: WorldSnapshot | null;
  onSelect: (s: Selection) => void;
  onAck: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { caps } = useControls();
  const alerts = world?.alerts ?? [];
  const unacked = alerts.filter((a) => a.ackedAt === null);
  const worst = unacked.some((a) => a.level === 'critical')
    ? 'critical'
    : unacked.some((a) => a.level === 'error')
      ? 'error'
      : unacked.length
        ? 'warning'
        : 'none';
  return (
    <div className="menu">
      <button
        className={`btn bell bell-${worst}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Alertes : ${unacked.length} non acquittée(s)`}
        data-testid="alerts-button"
      >
        ⚠ {unacked.length}
      </button>
      {open && (
        <div
          className="menu-pop alerts-pop"
          role="dialog"
          aria-label="Centre d'alertes"
          data-testid="alerts-pop"
        >
          <header className="panel-head">
            <h2>Alertes</h2>
            <span className="muted">{unacked.length} non acquittée(s)</span>
          </header>
          {alerts.length === 0 && <p className="empty">Aucune alerte.</p>}
          {alerts.map((a) => {
            const t = target(a);
            return (
              <div
                key={a.id}
                className={`alert-row level-${a.level} ${a.ackedAt ? 'acked' : ''}`}
                data-testid="alert-row"
              >
                <span className={`level-pill level-${a.level}`}>{LEVEL_LABEL[a.level]}</span>
                <button
                  className="alert-title"
                  onClick={() => {
                    if (t) onSelect(t);
                    setOpen(false);
                  }}
                >
                  {a.title}
                </button>
                <span className="muted small">
                  {time(a.createdAt)} · #{a.eventSeq}
                  {a.ackedAt ? ` · acquittée ${time(a.ackedAt)}` : ''}
                </span>
                {!a.ackedAt && caps.ackAlert && (
                  <button
                    className="btn small-btn"
                    onClick={() => void onAck(a.id)}
                    data-testid="alert-ack"
                  >
                    Acquitter
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
