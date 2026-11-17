'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api } from '../../lib/api';
import type { HqWorldView, Selection } from '../../world/types';
import { AgentCard, type AgentProfile } from '../panels/AgentCard';

const CARD_W = 340;
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
}: {
  world: WorldSnapshot;
  agentId: string;
  scene: RefObject<HqWorldView | null>;
  canEdit: boolean;
  canMission: boolean;
  onMission: (agentId: string) => void;
  onSelect: (s: Selection) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [remote, setRemote] = useState<{
    grants: { toolId: string; actions: string[] }[];
    profile: AgentProfile;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRemote(null);
    api<{ grants: { toolId: string; actions: string[] }[]; profile: AgentProfile }>(
      `/v1/agents/${agentId}`,
    )
      .then((r) => !cancelled && setRemote(r.data))
      .catch(() => !cancelled && setRemote(null));
    return () => {
      cancelled = true;
    };
  }, [agentId, version]);

  // Suivi de l'avatar : position écran du personnage -> position de la fiche (sans re-rendu React).
  useLayoutEffect(() => {
    let raf = 0;
    const place = (): void => {
      const el = box.current;
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
  }, [agentId, scene]);

  const agent = world.agents.find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <div ref={box} className="agent-popover" style={{ width: CARD_W }} data-testid="agent-popover">
      <button className="popover-close" onClick={onClose} aria-label="Fermer la fiche">
        ✕
      </button>
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
      />
    </div>
  );
}
