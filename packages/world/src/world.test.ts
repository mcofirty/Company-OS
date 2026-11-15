import { describe, expect, it } from 'vitest';
import { DomainEventSchema, type DomainEvent } from '@company-os/contracts';
import { applyEvent, applyEvents, emptyWorld } from './index';

const base = {
  companyId: 'co_1',
  mode: 'demo' as const,
  occurredAt: '2026-01-01T00:00:00.000Z',
  actor: { kind: 'system' as const, id: null },
};
const spawned: DomainEvent = {
  ...base,
  id: '00000000-0000-4000-8000-000000000001',
  seq: 1,
  type: 'agent.spawned',
  payload: { agentId: 'ag_1', name: 'Ada', role: 'engineering', position: { x: 2, y: 3 } },
};
const moved: DomainEvent = {
  ...base,
  id: '00000000-0000-4000-8000-000000000002',
  seq: 2,
  type: 'agent.moved',
  payload: { agentId: 'ag_1', from: { x: 2, y: 3 }, to: { x: 4, y: 3 } },
};
const working: DomainEvent = {
  ...base,
  id: '00000000-0000-4000-8000-000000000003',
  seq: 3,
  type: 'agent.status_changed',
  payload: { agentId: 'ag_1', status: 'working', activity: 'Rédige la spec' },
};

describe('contracts', () => {
  it('valide les événements fixtures', () => {
    for (const e of [spawned, moved, working]) expect(DomainEventSchema.parse(e)).toEqual(e);
  });
  it('rejette un type inconnu et un payload invalide', () => {
    expect(DomainEventSchema.safeParse({ ...spawned, type: 'agent.deleted' }).success).toBe(false);
    expect(
      DomainEventSchema.safeParse({ ...moved, payload: { agentId: 'ag_1', to: { x: -1, y: 0 } } })
        .success,
    ).toBe(false);
  });
});

describe('projection monde', () => {
  it('applique spawn, déplacement et statut', () => {
    const w = applyEvents(emptyWorld('co_1', 'demo'), [working, spawned, moved]);
    expect(w.lastSeq).toBe(3);
    expect(w.agents).toHaveLength(1);
    expect(w.agents[0]).toMatchObject({
      position: { x: 4, y: 3 },
      status: 'working',
      activity: 'Rédige la spec',
      mode: 'demo',
    });
  });
  it('est idempotente au rejeu', () => {
    const once = applyEvents(emptyWorld('co_1', 'demo'), [spawned, moved]);
    expect(applyEvent(once, moved)).toBe(once);
    expect(applyEvent(once, spawned)).toBe(once);
  });
  it("ignore les événements d'une autre entreprise", () => {
    const w = emptyWorld('co_2', 'demo');
    expect(applyEvent(w, spawned)).toBe(w);
  });
});
