import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_EVENT_TYPES,
  toolAvailableIn,
  canTransitionTask,
  DomainEventSchema,
  EnvelopeBase,
  Payloads,
  TOOL_CATALOG,
} from './index';

const root = path.resolve(import.meta.dirname, '../../..');
const schema = JSON.parse(readFileSync(path.join(root, 'specs/events.schema.json'), 'utf8')) as {
  required: string[];
  properties: { type: { enum: string[] } };
};
const example = JSON.parse(
  readFileSync(path.join(root, 'examples/agent-tool-cycle.json'), 'utf8'),
) as { events: Record<string, unknown>[] };

describe('alignement avec specs/events.schema.json', () => {
  it("l'enum des types est identique", () => {
    expect([...ALL_EVENT_TYPES].sort()).toEqual([...schema.properties.type.enum].sort());
  });
  it('les champs requis de l’enveloppe existent dans Zod', () => {
    const zodKeys = [...Object.keys(EnvelopeBase.shape), 'type', 'payload'];
    for (const k of schema.required) expect(zodKeys).toContain(k);
  });
  it('chaque type implémenté appartient à l’enum v1', () => {
    for (const t of Object.keys(Payloads)) expect(ALL_EVENT_TYPES).toContain(t);
  });
});

describe('DomainEventSchema', () => {
  const ok = {
    schemaVersion: 1,
    eventId: '65e409df-ed5a-46cd-91fd-45e2b2abc9a2',
    orgId: 'daae0071-c886-4afb-b748-3a60b84403d2',
    seq: 102,
    type: 'tool.invocation.started',
    aggregateType: 'tool_invocation',
    aggregateId: '12b1b432-a2a5-42a2-9149-f1c725a39bfd',
    aggregateVersion: 2,
    correlationId: 'd4ae8dc8-f581-45dd-9548-9ee73167b677',
    causationId: null,
    actor: { kind: 'agent', id: 'sales-01' },
    provenance: 'demo',
    occurredAt: '2026-11-14T10:00:02Z',
    classification: 'internal',
    payload: {
      invocationId: '12b1b432-a2a5-42a2-9149-f1c725a39bfd',
      toolId: 'crm',
      agentId: 'sales-01',
      taskId: '764a5f25-35c3-4e84-8bd8-a9a8ec444501',
      action: 'lookup_lead',
      attempt: 1,
    },
  };
  it('accepte un événement conforme', () => {
    expect(DomainEventSchema.safeParse(ok).success).toBe(true);
  });
  it('rejette un champ inconnu, un payload incomplet, une provenance inconnue', () => {
    expect(DomainEventSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(DomainEventSchema.safeParse({ ...ok, payload: { toolId: 'crm' } }).success).toBe(false);
    expect(DomainEventSchema.safeParse({ ...ok, provenance: 'fake' }).success).toBe(false);
  });
  it("l'exemple du pack respecte l'enveloppe", () => {
    for (const e of example.events) expect(EnvelopeBase.safeParse(e).success).toBe(true);
  });
});

describe('domaine', () => {
  it('transitions de tâche', () => {
    expect(canTransitionTask('queued', 'running')).toBe(true);
    expect(canTransitionTask('succeeded', 'running')).toBe(false);
    expect(canTransitionTask('failed', 'queued')).toBe(true);
    expect(canTransitionTask('created', 'succeeded')).toBe(false);
  });
  it('catalogue : 8 outils démo + plateforme + 4 outils réels (live), ids uniques', () => {
    expect(TOOL_CATALOG).toHaveLength(13);
    expect(new Set(TOOL_CATALOG.map((t) => t.id)).size).toBe(13);
    const live = TOOL_CATALOG.filter((t) => toolAvailableIn(t, 'live')).map((t) => t.id);
    expect(live.sort()).toEqual(['company', 'library', 'team', 'web']);
    // Aucun outil réel dans la démo, aucun outil fictif en live (sans autorisation explicite).
    expect(TOOL_CATALOG.filter((t) => toolAvailableIn(t, 'demo')).map((t) => t.id)).not.toContain(
      'web',
    );
    expect(
      toolAvailableIn(
        TOOL_CATALOG.find((t) => t.id === 'crm')!,
        'live',
      ),
    ).toBe(false);
    expect(
      toolAvailableIn(
        TOOL_CATALOG.find((t) => t.id === 'crm')!,
        'live',
        true,
      ),
    ).toBe(true);
  });
});
