'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import type { HqWorldView, Selection } from '../../world/types';
import { AgentCard, type AgentProfile } from '../panels/AgentCard';
import {
  AgentLive,
  AgentQuickActions,
  AgentRelations,
  AgentStats,
  type AgentInsights,
} from '../panels/AgentCardExtras';

const CARD_W = 380;

interface Remote {
  grants: { toolId: string; actions: string[] }[];
  profile: AgentProfile;
  insights?: AgentInsights;
  budget: { limitMicros: number; usedMicros: number } | null;
}
const GAP = 34; // distance au personnage

/**
 * Fiche de l'agent affichée À CÔTÉ de son personnage dans le QG : elle suit l'avatar (marche,
 * déplacement de caméra, zoom) image par image. Si l'avatar sort du cadre, la fiche se range
 * contre le bord gauche du monde. Données : snapshot temps réel + `/v1/agents/:id`.
 */
export function AgentPopover({
  world,
  agentId,
  scene,
  canEdit,
  canMission,
  onMission,
  onSelect,
  onClose,
  details,
  now,
  pinned,
  onPin,
  onLifecycle,
  toast,
  docked = false,
}: {
  world: WorldSnapshot;
  agentId: string;
  scene: RefObject<HqWorldView | null>;
  canEdit: boolean;
  canMission: boolean;
  onMission: (agentId: string) => void;
  onSelect: (s: Selection) => void;
  onClose: () => void;
  /** Travail en cours, historique et réglages (inspecteur de l'agent), dans un onglet. */
  details?: ReactNode;
  now: number;
  /** Fiche épinglée : reste ouverte et suit l'agent. */
  pinned: boolean;
  onPin?: () => void;
  onLifecycle: (agentId: string, action: 'pause' | 'resume', reason: string) => Promise<void>;
  toast: (t: { text: string; tone: 'info' | 'danger' | 'success' }) => void;
  /** Téléphone : fiche à plat dans une feuille, sans suivi de l'avatar. */
  docked?: boolean;
}) {
  const [tab, setTab] = useState<'card' | 'work'>('card');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const box = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [remote, setRemote] = useState<Remote | null>(null);
  useEffect(() => setRemote(null), [agentId]);

  const agentNow = world.agents.find((a) => a.id === agentId);
  const busy = !!agentNow?.currentTaskId;
  const liveKey = `${agentNow?.activity ?? ''}|${agentNow?.currentTaskId ?? ''}|${agentNow?.status ?? ''}`;
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      api<Remote>(`/v1/agents/${agentId}`)
        .then((r) => !cancelled && setRemote(r.data))
        .catch(() => undefined);
    };
    load();
    // Pendant une mission : progression rafraîchie toutes les 6 s (sinon à chaque changement d'état).
    const t = busy ? window.setInterval(load, 6000) : 0;
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [agentId, version, liveKey, busy]);

  // Suivi de l'avatar : position écran du personnage -> position de la fiche (sans re-rendu React).
  useLayoutEffect(() => {
    if (docked) return;
    let raf = 0;
    const place = (): void => {
      const el = box.current;
      // Fiche immobile pendant qu'on s'en sert (survol, saisie, réglages) : les boutons ne bougent pas.
      if (
        el &&
        el.style.opacity === '1' &&
        (el.matches(':hover') || el.contains(document.activeElement) || tabRef.current === 'work')
      ) {
        raf = requestAnimationFrame(place);
        return;
      }
      const pane = el?.parentElement;
      const canvas = pane?.querySelector<HTMLCanvasElement>('[data-testid="world-canvas"] canvas');
      if (el && pane && canvas) {
        const paneR = pane.getBoundingClientRect();
        const canR = canvas.getBoundingClientRect();
        const p = scene.current?.agentScreenPosition(agentId) ?? null;
        const h = el.offsetHeight;
        let x = 12;
        let y = 56;
        if (p) {
          const ax = canR.left - paneR.left + p.x;
          const ay = canR.top - paneR.top + p.y;
          const inside = ax > 0 && ay > 0 && ax < paneR.width && ay < paneR.height;
          if (inside) {
            // À droite du personnage si la place le permet, sinon à gauche.
            x = ax + GAP + CARD_W < paneR.width - 8 ? ax + GAP : ax - GAP - CARD_W;
            y = ay - h * 0.35;
          }
        }
        // Zone libre : ne pas passer sous les panneaux flottants (équipe, barres du haut).
        const side = pane.closest('.cockpit')?.querySelector('.side')?.getBoundingClientRect();
        const bar = pane.querySelector('.view-bar .view-tabs')?.getBoundingClientRect();
        const maxX = (side && side.width > 0 ? side.left - paneR.left : paneR.width) - CARD_W - 8;
        const minY = bar && bar.height > 0 ? bar.bottom - paneR.top + 8 : 48;
        if (p && x > maxX) x = canR.left - paneR.left + p.x - GAP - CARD_W;
        x = Math.max(8, Math.min(x, maxX));
        const feed = pane.closest('.cockpit')?.querySelector('.feed')?.getBoundingClientRect();
        const maxY = (feed && feed.height > 0 ? feed.top - paneR.top : paneR.height) - h - 8;
        y = Math.max(minY, Math.min(y, maxY));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.style.opacity = '1';
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [agentId, scene, docked]);

  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <div
      ref={box}
      className={`agent-popover${docked ? ' docked' : ''}`}
      style={docked ? undefined : { width: CARD_W }}
      data-testid="agent-popover"
    >
      {onPin && (
        <button
          className={`popover-pin ${pinned ? 'on' : ''}`}
          onClick={onPin}
          aria-pressed={pinned}
          aria-label={pinned ? 'Désépingler la fiche' : 'Épingler la fiche'}
          title={pinned ? 'Désépingler' : 'Épingler (garder ouverte, 2 max)'}
          data-testid="popover-pin"
        >
          📌
        </button>
      )}
      <button className="popover-close" onClick={onClose} aria-label="Fermer la fiche">
        ✕
      </button>
      <div className="popover-tabs" role="tablist" aria-label="Fiche de l’agent">
        <button
          role="tab"
          aria-selected={tab === 'card'}
          onClick={() => setTab('card')}
          data-testid="popover-tab-card"
        >
          Fiche
        </button>
        <button
          role="tab"
          aria-selected={tab === 'work'}
          onClick={() => setTab('work')}
          data-testid="popover-tab-work"
        >
          Travail & réglages
        </button>
      </div>
      {tab === 'work' && details}
      {tab === 'card' && (
        <AgentCard
          world={world}
          agent={agent}
          grants={remote?.grants ?? null}
          profile={remote?.profile ?? null}
          canEdit={canEdit}
          canMission={canMission && world.org.mode === 'live' && agent.status === 'active'}
          onMission={() => onMission(agent.id)}
          onSelect={onSelect}
          onProfileSaved={() => setVersion((v) => v + 1)}
          extras={
            <>
              <AgentLive
                world={world}
                agent={agent}
                insights={remote?.insights ?? null}
                now={now}
                onSelect={onSelect}
              />
              <AgentStats
                insights={remote?.insights ?? null}
                budget={remote ? remote.budget : null}
              />
              <AgentQuickActions
                world={world}
                agent={agent}
                onSelect={onSelect}
                onLifecycle={onLifecycle}
                toast={toast}
              />
              <AgentRelations
                world={world}
                agent={agent}
                insights={remote?.insights ?? null}
                onSelect={onSelect}
              />
            </>
          }
        />
      )}
    </div>
  );
}
