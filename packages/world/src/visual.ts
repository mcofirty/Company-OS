import type { AgentView } from '@company-os/contracts';
import { anchorsOfKind, HQ_MAP, type Anchor, type WorldMap } from './map';

/** Durée de la pause café cosmétique après une tâche terminée. */
export const BREAK_MS = 20_000;

export type VisualMode = 'desk' | 'break' | 'hidden';
export interface VisualIntent {
  agentId: string;
  anchor: Anchor;
  mode: VisualMode;
  /** Animation à jouer une fois arrivé. */
  pose: 'idle' | 'work' | 'tool';
}

/**
 * Projection visuelle pure (docs/06 §6) : où doit se trouver l'avatar et dans quelle pose.
 * Ne crée aucun état métier. La pause café n'est affichée que si l'agent est réellement
 * idle juste après une tâche terminée, et elle est étiquetée « cosmétique » dans l'UI.
 */
export function visualIntent(
  agent: AgentView,
  agentIndex: number,
  now: number,
  map: WorldMap = HQ_MAP,
): VisualIntent | null {
  if (agent.status === 'deactivated') return null;
  const desk = map.anchors[agent.deskAnchor] ?? anchorsOfKind(map, 'waiting')[0];
  if (!desk) return null;
  const busy = [
    'working',
    'using_tool',
    'thinking',
    'queued',
    'blocked',
    'waiting_approval',
  ].includes(agent.activity);
  if (!busy && agent.activity === 'idle' && agent.lastTaskEndedAt) {
    const since = now - Date.parse(agent.lastTaskEndedAt);
    if (since >= 0 && since < BREAK_MS) {
      const spots = anchorsOfKind(map, 'cafe');
      const spot = spots[agentIndex % spots.length];
      if (spot) return { agentId: agent.id, anchor: spot, mode: 'break', pose: 'idle' };
    }
  }
  const pose =
    agent.activity === 'using_tool' ? 'tool' : agent.activity === 'working' ? 'work' : 'idle';
  return { agentId: agent.id, anchor: desk, mode: 'desk', pose };
}

/** « X/Y au poste » : agents dont la cible visuelle est leur bureau / agents du département. */
export function departmentPresence(
  agents: readonly AgentView[],
  departmentId: string,
  now: number,
): { atDesk: number; total: number } {
  const members = agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.departmentId === departmentId && a.status !== 'deactivated');
  const atDesk = members.filter(({ a, i }) => visualIntent(a, i, now)?.mode === 'desk').length;
  return { atDesk, total: members.length };
}
