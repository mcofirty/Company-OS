import type { WorldSnapshot } from '@company-os/contracts';
import { randomUUID } from 'node:crypto';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import {
  createAgent,
  createDb,
  DEMO_ORG,
  listEventsAfter,
  seedDemo,
  type Db,
} from '@company-os/db';
import { applyEvents } from '@company-os/world';

export function testDb(): Db {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST manquant');
  return createDb(url);
}

export async function resetAndSeed(
  db: Db,
  now = new Date('2026-01-01T09:00:00.000Z'),
): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE outbox, event_log, alerts, llm_usage, meeting_participants, meetings, approval_requests,
     tool_invocations, agent_runs, tasks, agent_tool_grants, documents, connector_tools, connectors,
     agent_versions, budgets, agents, departments, tools, memberships, users, idempotency_keys,
     organizations CASCADE`,
  );
  await seedDemo(db, now);
}

/** Snapshot vide de l'org démo (point de départ pour rejouer tout le journal). */
export function emptySnapshot(base: WorldSnapshot): WorldSnapshot {
  return {
    ...base,
    lastSeq: 0,
    agents: [],
    tasks: [],
    invocations: [],
    timeline: [],
    approvals: [],
    meetings: [],
    alerts: [],
    costs: { llmCalls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, estimated: false },
    budgets: base.budgets.map((b) => ({ ...b, usedMicros: 0 })),
    system: { paused: false },
  };
}

/** Projection client (fold du journal) à comparer au snapshot serveur. */
export async function foldAll(db: Db, base: WorldSnapshot): Promise<WorldSnapshot> {
  const events = await listEventsAfter(db, DEMO_ORG.id, 0, 10_000);
  return applyEvents(emptySnapshot(base), events);
}

export function comparable(w: WorldSnapshot) {
  return {
    lastSeq: w.lastSeq,
    agents: w.agents,
    tasks: [...w.tasks].sort((a, b) => a.id.localeCompare(b.id)),
    invocations: [...w.invocations].sort((a, b) => a.id.localeCompare(b.id)),
    timeline: w.timeline.map((e) => e.seq),
    costs: w.costs,
    budgets: w.budgets.map((b) => [b.scopeType, b.scopeId, b.usedMicros]),
    approvals: [...w.approvals].sort((a, b) => a.id.localeCompare(b.id)),
    meetings: [...w.meetings].sort((a, b) => a.id.localeCompare(b.id)),
    alerts: w.alerts,
  };
}

/** Organisation LIVE de test (modèle simulé par MockProvider, outils démo « hybrides »). */
export const LIVE_ORG = {
  id: '1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Org live (test)',
  mode: 'live',
  // Tests de la boucle LLM avec les outils de démonstration : autorisation explicite.
  allowDemoTools: true,
} as const;

export async function seedLiveOrg(
  db: Db,
  opts: { maxSteps?: number; agentBudgetMicros?: number; orgBudgetMicros?: number } = {},
): Promise<void> {
  await db.organization.create({ data: LIVE_ORG });
  // Les identifiants de département sont globaux ; le lien avec le plan passe par roomId.
  await db.department.create({
    data: {
      id: 'live-sales',
      orgId: LIVE_ORG.id,
      name: 'Sales',
      color: '#EA966C',
      roomId: 'sales',
      capacity: 4,
    },
  });
  await createAgent(db, {
    orgId: LIVE_ORG.id,
    id: 'live-sdr',
    name: 'Lina',
    title: 'SDR',
    role: 'specialist',
    departmentId: 'live-sales',
    managerId: null,
    avatarId: 'avatar-03',
    deskAnchor: 'sales-desk-04',
    grants: { crm: ['lookup_lead'], email: ['draft_email'] },
    createdBy: { kind: 'system', id: 'test' },
    provenance: 'live',
    activate: true,
    initialVersion: {
      promptVersion: PROMPT_VERSION,
      instructions: instructionsFor('sales', 'specialist'),
      goal: 'Qualifier des prospects',
      modelPolicy: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 2000 },
      limits: { maxSteps: opts.maxSteps ?? 6, maxDurationMs: 60_000, maxCostMicros: 2_000_000 },
    },
  });
  for (const [scopeType, scopeId, limit] of [
    ['org', LIVE_ORG.id, opts.orgBudgetMicros ?? 10_000_000],
    ['agent', 'live-sdr', opts.agentBudgetMicros ?? 5_000_000],
  ] as const) {
    await db.budget.create({
      data: {
        id: randomUUID(),
        orgId: LIVE_ORG.id,
        scopeType,
        scopeId,
        limitMicros: limit,
        hardStop: true,
        alertThreshold: 0.8,
      },
    });
  }
}
