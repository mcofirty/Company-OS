import { describe, expect, it } from 'vitest';
import type { AgentView, DomainEvent, NewEvent, WorldSnapshot } from '@company-os/contracts';
import {
  anchorsOfKind,
  applyEvent,
  applyEvents,
  computeMetrics,
  departmentPresence,
  findPath,
  HQ_MAP,
  visualIntent,
  BREAK_MS,
  idleLife,
  LIFE_SLOT_MS,
} from './index';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const T1 = '00000000-0000-4000-8000-000000000001';
const I1 = '00000000-0000-4000-8000-000000000002';
const R1 = '00000000-0000-4000-8000-000000000003';
const C1 = '00000000-0000-4000-8000-000000000004';

let n = 0;
function ev(e: NewEvent, seq: number, at = '2026-01-01T10:00:00.000Z'): DomainEvent {
  n++;
  return {
    ...e,
    schemaVersion: 1,
    eventId: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    orgId: ORG,
    seq,
    occurredAt: at,
  } as DomainEvent;
}
const base = {
  correlationId: C1,
  causationId: null,
  actor: { kind: 'system', id: 'test' },
  provenance: 'demo',
  classification: 'internal',
} as const;

const empty: WorldSnapshot = {
  org: { id: ORG, name: 'Test', mode: 'demo' },
  lastSeq: 0,
  serverTime: '2026-01-01T00:00:00.000Z',
  worldMap: { id: 'hq-v1', version: 1 },
  departments: [],
  agents: [],
  tools: [],
  tasks: [],
  invocations: [],
  costs: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false },
  budgets: [],
  system: { paused: false },
  approvals: [],
  meetings: [],
  alerts: [],
  timeline: [],
};

const cycle: DomainEvent[] = [
  ev(
    {
      ...base,
      type: 'agent.created',
      aggregateType: 'agent',
      aggregateId: 'sales-01',
      aggregateVersion: 1,
      payload: {
        agentId: 'sales-01',
        name: 'Nora',
        title: 'SDR',
        role: 'specialist',
        departmentId: 'sales',
        managerId: null,
        avatarId: 'avatar-01',
        deskAnchor: 'sales-desk-01',
      },
    },
    1,
  ),
  ev(
    {
      ...base,
      type: 'agent.activated',
      aggregateType: 'agent',
      aggregateId: 'sales-01',
      aggregateVersion: 2,
      payload: { agentId: 'sales-01', assignedAnchor: 'sales-desk-01' },
    },
    2,
  ),
  ev(
    {
      ...base,
      type: 'task.created',
      aggregateType: 'task',
      aggregateId: T1,
      aggregateVersion: 1,
      payload: {
        taskId: T1,
        agentId: 'sales-01',
        kind: 'qualify_lead',
        title: 'Qualifier',
        parentTaskId: null,
        depth: 0,
      },
    },
    3,
  ),
  ev(
    {
      ...base,
      type: 'task.started',
      aggregateType: 'task',
      aggregateId: T1,
      aggregateVersion: 2,
      payload: { taskId: T1, agentId: 'sales-01', targetAnchor: 'sales-desk-01' },
    },
    4,
    '2026-01-01T10:00:01.000Z',
  ),
  ev(
    {
      ...base,
      type: 'agent.run.started',
      aggregateType: 'agent_run',
      aggregateId: R1,
      aggregateVersion: 1,
      payload: {
        runId: R1,
        agentId: 'sales-01',
        taskId: T1,
        providerClass: 'demo',
        model: null,
        agentVersion: 1,
      },
    },
    5,
  ),
  ev(
    {
      ...base,
      type: 'tool.invocation.requested',
      aggregateType: 'tool_invocation',
      aggregateId: I1,
      aggregateVersion: 1,
      payload: {
        invocationId: I1,
        toolId: 'crm',
        agentId: 'sales-01',
        taskId: T1,
        action: 'lookup_lead',
        actionKind: 'read',
        risk: 'read',
      },
    },
    6,
  ),
  ev(
    {
      ...base,
      type: 'tool.invocation.started',
      aggregateType: 'tool_invocation',
      aggregateId: I1,
      aggregateVersion: 2,
      payload: {
        invocationId: I1,
        toolId: 'crm',
        agentId: 'sales-01',
        taskId: T1,
        action: 'lookup_lead',
        attempt: 1,
      },
    },
    7,
  ),
];
const finish: DomainEvent[] = [
  ev(
    {
      ...base,
      type: 'tool.invocation.succeeded',
      aggregateType: 'tool_invocation',
      aggregateId: I1,
      aggregateVersion: 3,
      payload: {
        invocationId: I1,
        toolId: 'crm',
        agentId: 'sales-01',
        taskId: T1,
        durationMs: 3000,
        safeSummary: 'Prospect trouvé',
      },
    },
    8,
  ),
  ev(
    {
      ...base,
      type: 'agent.run.completed',
      aggregateType: 'agent_run',
      aggregateId: R1,
      aggregateVersion: 2,
      payload: {
        runId: R1,
        agentId: 'sales-01',
        taskId: T1,
        status: 'succeeded',
        stepCount: 1,
        usage: {
          llmCalls: 1,
          inputTokens: 1200,
          outputTokens: 300,
          costMicros: 10800,
          costSource: 'estimated',
          model: 'claude-opus-5-5',
        },
      },
    },
    9,
  ),
  ev(
    {
      ...base,
      type: 'task.completed',
      aggregateType: 'task',
      aggregateId: T1,
      aggregateVersion: 3,
      payload: {
        taskId: T1,
        agentId: 'sales-01',
        resultRef: 'artifact://x',
        safeSummary: 'Qualifié',
      },
    },
    10,
    '2026-01-01T10:00:05.000Z',
  ),
];

describe('carte hq-v1', () => {
  it('a au moins 6 départements, une salle de réunion, un café, un accueil', () => {
    const kinds = HQ_MAP.rooms.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'department').length).toBeGreaterThanOrEqual(6);
    expect(kinds).toContain('meeting');
    expect(kinds).toContain('cafe');
    expect(kinds).toContain('entry');
    expect(HQ_MAP.cols).toBe(36);
    expect(HQ_MAP.rows).toBe(35); // aile d'extension (nouveaux pôles)
  });
  it('assez de postes pour 12 agents et de places au café', () => {
    expect(anchorsOfKind(HQ_MAP, 'desk').length).toBeGreaterThanOrEqual(12);
    expect(anchorsOfKind(HQ_MAP, 'cafe').length).toBeGreaterThanOrEqual(12);
    expect(anchorsOfKind(HQ_MAP, 'meeting_seat').length).toBe(8);
  });
  it('chaque ancre est praticable et accessible depuis l’accueil (pas de collision mobilier)', () => {
    const spawn = HQ_MAP.anchors['entry-spawn']!;
    for (const a of Object.values(HQ_MAP.anchors)) {
      expect(HQ_MAP.isWalkable(a), a.id).toBe(true);
      expect(findPath(spawn, a, HQ_MAP.isWalkable), a.id).not.toBeNull();
    }
  });
});

describe('A*', () => {
  it('contourne un obstacle et ne traverse jamais une cloison ou un meuble', () => {
    const from = HQ_MAP.anchors['entry-spawn']!;
    const to = HQ_MAP.anchors['finance-desk-01']!;
    const path = findPath(from, to, HQ_MAP.isWalkable)!;
    expect(path.at(-1)).toEqual({ x: to.x, y: to.y });
    for (const t of path) expect(HQ_MAP.isWalkable(t)).toBe(true);
    for (let i = 1; i < path.length; i++) {
      const d = Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
      expect(d).toBe(1);
    }
  });
  it('retourne null pour une cible bloquée', () => {
    expect(findPath({ x: 0, y: 0 }, { x: 1, y: 1 }, (t) => !(t.x === 1 && t.y === 1))).toBeNull();
  });
});

describe('réducteur', () => {
  it('applique le cycle tâche -> outil -> fin', () => {
    const mid = applyEvents(empty, cycle);
    expect(mid.agents[0]).toMatchObject({
      status: 'active',
      activity: 'using_tool',
      currentTaskId: T1,
    });
    expect(mid.tasks[0]?.status).toBe('running');
    expect(mid.invocations[0]).toMatchObject({ status: 'running', actionKind: 'read' });
    expect(computeMetrics(mid)).toMatchObject({
      activeInvocations: 1,
      activeToolIds: ['crm'],
      busyAgents: 1,
    });

    const end = applyEvents(mid, finish);
    expect(end.agents[0]).toMatchObject({ activity: 'idle', currentTaskId: null });
    expect(end.tasks[0]).toMatchObject({ status: 'succeeded', resultSummary: 'Qualifié' });
    expect(end.invocations[0]).toMatchObject({ status: 'succeeded', durationMs: 3000 });
    expect(end.timeline[0]?.type).toBe('task.completed');
    expect(computeMetrics(end).activeInvocations).toBe(0);
    expect(end.costs).toEqual({
      llmCalls: 1,
      inputTokens: 1200,
      outputTokens: 300,
      costMicros: 10800,
      estimated: true,
    });
  });
  it('ignore les doublons et signale les trous', () => {
    const w = applyEvents(empty, cycle.slice(0, 3));
    expect(applyEvent(w, cycle[1]!).outcome).toBe('duplicate');
    expect(applyEvent(w, cycle[5]!).outcome).toBe('gap');
    expect(applyEvent(w, cycle[3]!).outcome).toBe('applied');
  });
});

describe('projection visuelle', () => {
  it('desk pendant le travail, pause café juste après, puis retour au poste', () => {
    const working = applyEvents(empty, cycle).agents[0]!;
    expect(visualIntent(working, 0, Date.now())).toMatchObject({ mode: 'desk', pose: 'tool' });
    const done = applyEvents(empty, [...cycle, ...finish]);
    const idle = done.agents[0]!;
    const end = Date.parse(idle.lastTaskEndedAt!);
    expect(visualIntent(idle, 0, end + 1000)?.mode).toBe('break');
    expect(visualIntent(idle, 0, end + BREAK_MS + 1)?.mode).toBe('desk');
    expect(departmentPresence(done.agents, 'sales', end + 1000)).toEqual({ atDesk: 0, total: 1 });
  });
});

describe('vie de bureau (cosmétique)', () => {
  const base = {
    id: 'a-life-1',
    status: 'active',
    activity: 'idle',
    currentTaskId: null,
    deskAnchor: 'sales-desk-01',
    lastTaskEndedAt: null,
  } as unknown as AgentView;
  it('est déterministe et jamais pendant une mission', () => {
    const seen = new Set<string>();
    for (let t = 0; t < 40 * LIFE_SLOT_MS; t += 5_000) {
      expect(idleLife(base, t)).toBe(idleLife(base, t));
      seen.add(String(idleLife(base, t)));
      for (const activity of [
        'working',
        'using_tool',
        'queued',
        'blocked',
        'waiting_approval',
        'in_meeting',
      ] as const) {
        const busy = { ...base, activity } as AgentView;
        expect(idleLife(busy, t)).toBeNull();
        const v = visualIntent(busy, 0, t);
        if (activity !== 'in_meeting') expect(v?.mode).toBe('desk');
      }
      expect(idleLife({ ...base, currentTaskId: 't1' } as AgentView, t)).toBeNull();
      expect(idleLife({ ...base, status: 'paused' } as AgentView, t)).toBeNull();
    }
    expect(seen.size).toBeGreaterThan(2);
  });
  it('envoie au café pour une pause ou une discussion', () => {
    for (let t = 0; t < 40 * LIFE_SLOT_MS; t += 5_000) {
      const life = idleLife(base, t);
      const v = visualIntent(base, 0, t)!;
      if (life === 'coffee' || life === 'chat') expect(v.anchor.kind).toBe('cafe');
      else expect(v.anchor.id).toBe('sales-desk-01');
    }
  });
});
