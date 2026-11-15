import type { AgentView } from '@company-os/contracts';
import { anchorsOfKind, HQ_MAP, type Anchor, type WorldMap } from './map';

/** Durée de la pause café cosmétique après une tâche terminée. */
export const BREAK_MS = 20_000;

export type VisualMode = 'desk' | 'break' | 'meeting' | 'waiting' | 'hidden';
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
  meetingSeat: string | null = null,
): VisualIntent | null {
  if (agent.status === 'deactivated') return null;
  // Réunion réelle (meeting.started persisté) : siège réservé dans la salle.
  if (agent.activity === 'in_meeting' && meetingSeat) {
    const seat = map.anchors[meetingSeat];
    if (seat) return { agentId: agent.id, anchor: seat, mode: 'meeting', pose: 'idle' };
  }
  const desk = map.anchors[agent.deskAnchor];
  if (!desk || desk.kind !== 'desk') {
    // Aucun poste libre à l'arrivée : salle d'attente de l'accueil.
    const wait = anchorsOfKind(map, 'waiting');
    const spot = wait[agentIndex % Math.max(1, wait.length)];
    return spot ? { agentId: agent.id, anchor: spot, mode: 'waiting', pose: 'idle' } : null;
  }
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
/** Sièges de réunion en cours, par agent. */
export function meetingSeats(
  meetings: readonly { status: string; seats: Record<string, string> }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of meetings)
    if (m.status === 'in_progress') for (const [a, s] of Object.entries(m.seats)) out.set(a, s);
  return out;
}

export function departmentPresence(
  agents: readonly AgentView[],
  departmentId: string,
  now: number,
  seats: Map<string, string> = new Map(),
): { atDesk: number; total: number } {
  const members = agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.departmentId === departmentId && a.status !== 'deactivated');
  const atDesk = members.filter(
    ({ a, i }) => visualIntent(a, i, now, HQ_MAP, seats.get(a.id) ?? null)?.mode === 'desk',
  ).length;
  return { atDesk, total: members.length };
}
