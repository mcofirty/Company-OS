import type { AgentView, DomainEvent, Mode, WorldSnapshot } from '@company-os/contracts';

export function emptyWorld(companyId: string, mode: Mode): WorldSnapshot {
  return { companyId, mode, lastSeq: 0, agents: [] };
}

/**
 * Projection pure : applique un événement persisté au snapshot du monde.
 * Idempotente : un événement déjà appliqué (seq <= lastSeq) est ignoré, ce qui
 * permet de rejouer sans risque après une reconnexion WebSocket.
 */
export function applyEvent(world: WorldSnapshot, event: DomainEvent): WorldSnapshot {
  if (event.companyId !== world.companyId || event.seq <= world.lastSeq) return world;
  const next: WorldSnapshot = { ...world, lastSeq: event.seq };

  switch (event.type) {
    case 'agent.spawned': {
      if (world.agents.some((a) => a.id === event.payload.agentId)) return next;
      const agent: AgentView = {
        id: event.payload.agentId,
        name: event.payload.name,
        role: event.payload.role,
        status: 'idle',
        activity: null,
        position: event.payload.position,
        mode: event.mode,
        spawnedAtSeq: event.seq,
        updatedAtSeq: event.seq,
      };
      return { ...next, agents: [...world.agents, agent] };
    }
    case 'agent.moved':
      return updateAgent(next, event.payload.agentId, (a) => ({
        ...a,
        position: event.payload.to,
        updatedAtSeq: event.seq,
      }));
    case 'agent.status_changed':
      return updateAgent(next, event.payload.agentId, (a) => ({
        ...a,
        status: event.payload.status,
        activity: event.payload.activity,
        updatedAtSeq: event.seq,
      }));
  }
}

export function applyEvents(world: WorldSnapshot, events: readonly DomainEvent[]): WorldSnapshot {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyEvent, world);
}

function updateAgent(
  world: WorldSnapshot,
  agentId: string,
  fn: (a: AgentView) => AgentView,
): WorldSnapshot {
  return { ...world, agents: world.agents.map((a) => (a.id === agentId ? fn(a) : a)) };
}
