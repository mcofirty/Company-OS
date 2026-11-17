import type { WorldSnapshot } from '@company-os/contracts';

/** Élément sélectionnable dans le QG (ouvre l'inspecteur correspondant). */
export type Selection =
  | { kind: 'agent'; id: string }
  | { kind: 'department'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'invocation'; id: string }
  | { kind: 'tool'; id: string }
  | { kind: 'approval'; id: string }
  | { kind: 'meeting'; id: string };

export interface WorldCallbacks {
  onSelect: (sel: Selection | null) => void;
  /** Clic sur un local libre de l'aile d'extension. */
  onEmptyRoom?: (roomId: string) => void;
}

/** Vue 3D : angle de caméra prédéfini. */
export type CameraView = 'top' | 'tq' | 'close';

/**
 * Contrat commun des rendus du QG (3D « studio » et 2D classique). Le rendu ne détient aucun
 * état métier : il projette le snapshot issu des événements backend.
 */
export interface HqWorldView {
  sync(world: WorldSnapshot, sel: Selection | null, now: number): void;
  home(): void;
  zoomBy(f: number): void;
  focusAgent(id: string): void;
  setHighlight(dept: string | null): void;
  setLinksMode(on: boolean): void;
  /** Hooks e2e (hors production) et fiche flottante : position écran d'un avatar. */
  agentScreenPosition(id: string): { x: number; y: number } | null;
  agentAlpha(id: string): number | null;
  isWalking(id: string): boolean;
  drawnLinks: { agentId: string; toolId: string }[];
  hiddenLinks: number;
  /** Options propres au rendu 3D (sans effet en 2D). */
  setView?(v: CameraView): void;
  setNight?(on: boolean): void;
  /** Marges occupées par l'interface flottante, en px : le cadrage les évite. */
  setInsets?(i: { top: number; right: number; bottom: number; left: number }): void;
}
