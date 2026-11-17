'use client';

import { useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { useControls } from '../../lib/controls';
import { time } from '../../lib/format';
import type { Selection } from '../../world/HqScene';
import { ActivityFeed } from './ActivityFeed';

/**
 * Vue téléphone (consultation secondaire) : validations en attente — avec décision rapide — et
 * fil d'activité. Affichée seulement sur petit écran (CSS), le QG isométrique restant sur PC.
 */
export function MobileView({
  world,
  onDecide,
  onSelect,
}: {
  world: WorldSnapshot | null;
  onDecide: (id: string, d: 'approve' | 'reject', reason: string) => Promise<void>;
  onSelect: (s: Selection) => void;
}) {
  const { caps } = useControls();
  const [tab, setTab] = useState<'approvals' | 'feed'>('approvals');
  const pending = (world?.approvals ?? []).filter((a) => a.status === 'pending');
  const agentName = (id: string) => world?.agents.find((a) => a.id === id)?.name ?? id;
  return (
    <div className="mobile-view" data-testid="mobile-view">
      <div className="seg">
        <button className={tab === 'approvals' ? 'on' : ''} onClick={() => setTab('approvals')}>
          Validations {pending.length > 0 && <span className="count warn">{pending.length}</span>}
        </button>
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
          Activité
        </button>
      </div>
      {tab === 'approvals' ? (
        pending.length === 0 ? (
          <p className="muted mobile-empty">Rien à valider. 👍</p>
        ) : (
          <ul className="mobile-approvals">
            {pending.map((a) => (
              <li key={a.id}>
                <strong>{agentName(a.agentId)}</strong>
                <span className="muted small"> · {time(a.requestedAt)}</span>
                <p>{a.riskReason}</p>
                {caps.decideApproval && (
                  <div className="actions row">
                    <button
                      className="btn primary"
                      onClick={() => void onDecide(a.id, 'approve', 'Validé depuis le téléphone')}
                    >
                      ✓ Valider
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => void onDecide(a.id, 'reject', 'Refusé depuis le téléphone')}
                    >
                      ✕ Refuser
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <ActivityFeed world={world} onSelect={onSelect} />
      )}
    </div>
  );
}
