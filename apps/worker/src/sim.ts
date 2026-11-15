import {
  OFFICE_LAYOUT,
  type AgentView,
  type NewDomainEvent,
  type TilePosition,
  type WorldSnapshot,
} from '@company-os/contracts';
import { DEMO_AGENTS } from '@company-os/db';

/** Lieux du bureau demo (coordonnées de tuiles). */
export const PLACES = {
  meeting: OFFICE_LAYOUT.meetingSpot,
  coffee: OFFICE_LAYOUT.coffeeSpot,
} as const;

const WORK_ACTIVITIES: Record<AgentView['role'], string[]> = {
  ceo: ['Revue des objectifs trimestriels', 'Prépare le point hebdo'],
  engineering: ['Implémente une fonctionnalité', 'Relit une pull request', 'Corrige un bug'],
  marketing: ['Rédige un brouillon de post', 'Analyse une campagne'],
  sales: ['Qualifie des prospects', 'Prépare une proposition'],
  hr: ['Rédige une fiche de poste', 'Prépare un onboarding'],
  finance: ['Rapproche les dépenses', 'Met à jour le budget'],
};

/** PRNG déterministe (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const same = (a: TilePosition, b: TilePosition): boolean => a.x === b.x && a.y === b.y;

/**
 * Calcule le prochain pas de simulation à partir du snapshot uniquement :
 * même historique => mêmes événements (mode demo déterministe, sans appel externe).
 */
export function nextDemoStep(world: WorldSnapshot): NewDomainEvent[] {
  if (world.mode !== 'demo' || world.agents.length === 0) return [];
  const rand = prng(world.lastSeq * 2654435761);
  const agent = world.agents[Math.floor(rand() * world.agents.length)];
  if (!agent) return [];
  const desk = DEMO_AGENTS.find((d) => d.id === agent.id)?.desk ?? agent.position;
  const common = {
    companyId: world.companyId,
    mode: 'demo' as const,
    actor: { kind: 'system' as const, id: 'demo-simulator' },
  };
  const move = (to: TilePosition): NewDomainEvent => ({
    ...common,
    type: 'agent.moved',
    payload: { agentId: agent.id, from: agent.position, to },
  });
  const status = (s: AgentView['status'], activity: string | null): NewDomainEvent => ({
    ...common,
    type: 'agent.status_changed',
    payload: { agentId: agent.id, status: s, activity },
  });

  // Hors du bureau : retour au poste.
  if (!same(agent.position, desk)) {
    return [status('walking', 'Retourne à son poste'), move(desk), status('idle', null)];
  }
  const r = rand();
  if (r < 0.55) {
    const list = WORK_ACTIVITIES[agent.role];
    const activity = list[Math.floor(rand() * list.length)] ?? 'Travaille';
    return [status('working', activity)];
  }
  if (r < 0.8) {
    return [
      status('walking', 'Se rend en salle de réunion'),
      move(PLACES.meeting),
      status('meeting', 'Point d’équipe (simulation)'),
    ];
  }
  return [status('walking', 'Pause café'), move(PLACES.coffee), status('idle', 'Pause café')];
}
