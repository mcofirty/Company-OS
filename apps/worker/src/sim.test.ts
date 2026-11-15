import { describe, expect, it } from 'vitest';
import { emptyWorld, applyEvents } from '@company-os/world';
import type { DomainEvent, NewDomainEvent, WorldSnapshot } from '@company-os/contracts';
import { DEMO_COMPANY, demoSpawnEvents } from '@company-os/db';
import { nextDemoStep } from './sim';

function materialize(events: NewDomainEvent[], startSeq: number): DomainEvent[] {
  return events.map(
    (e, i) =>
      ({
        ...e,
        id: `00000000-0000-4000-8000-${String(startSeq + i).padStart(12, '0')}`,
        seq: startSeq + i,
        occurredAt: '2026-01-01T00:00:00.000Z',
      }) as DomainEvent,
  );
}

function run(steps: number): WorldSnapshot {
  let world = applyEvents(emptyWorld(DEMO_COMPANY.id, 'demo'), materialize(demoSpawnEvents(), 1));
  for (let i = 0; i < steps; i++) {
    world = applyEvents(world, materialize(nextDemoStep(world), world.lastSeq + 1));
  }
  return world;
}

describe('simulateur demo', () => {
  it('est déterministe', () => {
    expect(run(40)).toEqual(run(40));
  });
  it("ne produit que des événements demo et n'en produit pas en live", () => {
    const w = run(3);
    expect(nextDemoStep(w).every((e) => e.mode === 'demo')).toBe(true);
    expect(nextDemoStep({ ...w, mode: 'live' })).toEqual([]);
  });
  it('fait bouger les agents sur la durée', () => {
    const w = run(60);
    const statuses = new Set(w.agents.map((a) => a.status));
    expect(w.lastSeq).toBeGreaterThan(60);
    expect(statuses.size).toBeGreaterThan(0);
  });
});
