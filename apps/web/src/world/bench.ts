import { TOOL_CATALOG, type AgentActivity, type WorldSnapshot } from '@company-os/contracts';
import { anchorsOfKind, HQ_MAP } from '@company-os/world';

/**
 * Monde SYNTHÉTIQUE pour le banc de charge (docs/08 §3 : 50 avatars). Construit localement, jamais
 * envoyé à l'API, jamais présenté comme une activité : il sert uniquement à mesurer le rendu.
 * Les avatars passent par les mêmes règles visuelles que le cockpit (poste, café, outil).
 */
const DEPTS = [
  { id: 'direction', name: 'Direction', color: '#e9c46a' },
  { id: 'finance', name: 'Finance', color: '#5fbf8f' },
  { id: 'sales', name: 'Sales', color: '#ea966c' },
  { id: 'marketing', name: 'Marketing', color: '#8f7ad6' },
  { id: 'rh', name: 'RH', color: '#e58fb1' },
  { id: 'operations', name: 'Operations', color: '#6aaee0' },
];
const ORG = '00000000-0000-4000-8000-00000000be4c';
const ACTIVITIES: AgentActivity[] = ['working', 'using_tool', 'idle', 'thinking'];

export function syntheticWorld(count: number, tick: number, now: number): WorldSnapshot {
  const desks = anchorsOfKind(HQ_MAP, 'desk');
  const iso = (ms: number): string => new Date(ms).toISOString();
  const agents = Array.from({ length: count }, (_, i) => {
    const desk = desks[i % desks.length]!;
    const dept = DEPTS.find((d) => d.id === desk.roomId) ?? DEPTS[0]!;
    // Un quart des agents change d'état à chaque tick : déplacements continus (café <-> poste).
    const phase = (i + tick) % 4;
    const activity = ACTIVITIES[phase]!;
    return {
      id: `bench-${i}`,
      name: `Bench ${i}`,
      title: 'Synthétique',
      role: 'specialist' as const,
      departmentId: dept.id,
      managerId: null,
      avatarId: `avatar-${String((i % 8) + 1).padStart(2, '0')}`,
      deskAnchor: desk.id,
      status: 'active' as const,
      activity,
      currentTaskId: activity === 'idle' ? null : `t-${i}`,
      // idle juste après une tâche => pause café (marche vers le café puis retour).
      lastTaskEndedAt: activity === 'idle' ? iso(now - 1000) : null,
      provenance: 'demo' as const,
    };
  });
  const invocations = agents
    .filter((a) => a.activity === 'using_tool')
    .map((a, k) => {
      const tool = TOOL_CATALOG[k % (TOOL_CATALOG.length - 1)]!;
      const action = tool.actions[0]!;
      return {
        id: `inv-${a.id}-${tick}`,
        toolId: tool.id,
        agentId: a.id,
        taskId: a.currentTaskId!,
        action: action.action,
        actionKind: action.kind,
        risk: action.risk,
        status: 'running' as const,
        attempt: 1,
        requestedAt: iso(now - 2000),
        startedAt: iso(now - 1500),
        endedAt: null,
        durationMs: null,
        safeSummary: null,
        errorCode: null,
        correlationId: `c-${a.id}`,
        provenance: 'demo' as const,
      };
    });
  return {
    org: { id: ORG, name: 'Banc de charge (synthétique)', mode: 'demo' },
    lastSeq: tick,
    serverTime: iso(now),
    worldMap: { id: HQ_MAP.id, version: HQ_MAP.version },
    departments: DEPTS.map((d) => ({ ...d, roomId: d.id, capacity: 4, managerAgentId: null })),
    agents,
    tools: TOOL_CATALOG.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      category: t.category,
      color: t.color,
      status: 'healthy' as const,
      actions: t.actions.map((a) => ({
        action: a.action,
        kind: a.kind,
        risk: a.risk,
        label: a.label,
      })),
    })),
    tasks: [],
    invocations,
    costs: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false },
    budgets: [],
    system: { paused: false },
    approvals: [],
    meetings: [],
    alerts: [],
    timeline: [],
  };
}
