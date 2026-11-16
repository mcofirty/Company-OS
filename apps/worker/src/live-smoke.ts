/**
 * Vérification manuelle du parcours LIVE (M2) : un vrai appel modèle Anthropic, outils démo
 * « hybrides » (aucun effet externe), organisation live séparée, budget plafonné.
 * Usage : ANTHROPIC_API_KEY=... pnpm --filter @company-os/worker live-smoke
 * Coût : quelques appels modèle (plafond du run : $0.50, budget org : $2).
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import {
  createAgent,
  createDb,
  createTask,
  listEventsByCorrelation,
  startNextTask,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { createActivities, liveProviderFromEnv } from './activities';
import { runAgentTaskInline } from './inline';

config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const LIVE_ORG = {
  id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
  name: 'Living HQ — live local (smoke)',
  mode: 'live',
  // Test de fumée étiqueté : vrai modèle, outils de démonstration explicitement autorisés.
  allowDemoTools: true,
} as const;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
const provider = liveProviderFromEnv(process.env);
if (!provider) {
  console.error('ANTHROPIC_API_KEY absent : parcours LIVE non vérifiable. Rien n’a été exécuté.');
  process.exit(2);
}
const db = createDb(url);

await db.organization.upsert({
  where: { id: LIVE_ORG.id },
  create: LIVE_ORG,
  update: { allowDemoTools: true },
});
await db.department.upsert({
  where: { id: 'smoke-sales' },
  create: {
    id: 'smoke-sales',
    orgId: LIVE_ORG.id,
    name: 'Sales',
    color: '#EA966C',
    roomId: 'sales',
    capacity: 4,
  },
  update: {},
});
await createAgent(db, {
  orgId: LIVE_ORG.id,
  id: 'smoke-sdr',
  name: 'Lina',
  title: 'SDR',
  role: 'specialist',
  departmentId: 'smoke-sales',
  managerId: null,
  avatarId: 'avatar-03',
  deskAnchor: 'sales-desk-04',
  grants: { crm: ['lookup_lead'], email: ['draft_email'] },
  createdBy: { kind: 'system', id: 'live-smoke' },
  provenance: 'live',
  activate: true,
  initialVersion: {
    promptVersion: PROMPT_VERSION,
    instructions: instructionsFor('sales', 'specialist'),
    goal: 'Qualifier des prospects',
    modelPolicy: {
      model: process.env.LLM_MODEL || 'claude-opus-5-5',
      effort: 'medium',
      maxTokens: 4000,
    },
    limits: { maxSteps: 6, maxDurationMs: 5 * 60_000, maxCostMicros: 500_000 },
  },
});
for (const [scopeType, scopeId, limitMicros] of [
  ['org', LIVE_ORG.id, 2_000_000],
  ['agent', 'smoke-sdr', 1_000_000],
] as const) {
  await db.budget.upsert({
    where: {
      orgId_scopeType_scopeId_period: { orgId: LIVE_ORG.id, scopeType, scopeId, period: 'month' },
    },
    create: {
      id: randomUUID(),
      orgId: LIVE_ORG.id,
      scopeType,
      scopeId,
      limitMicros,
      hardStop: true,
    },
    update: {},
  });
}

const { task } = await createTask(db, {
  orgId: LIVE_ORG.id,
  kind: 'qualify_lead',
  requester: { kind: 'user', id: 'live-smoke' },
  idempotencyKey: `live-smoke-${randomUUID()}`,
});
const started = await startNextTask(db, LIVE_ORG.id);
if (!started) throw new Error('Aucune tâche démarrée (kill switch ?)');
const acts = createActivities({
  db,
  gateway: new ToolGateway(db),
  pricing: loadPricing(),
  liveProvider: provider,
});
const outcome = await runAgentTaskInline(acts, started.runId);
const run = await db.agentRun.findFirstOrThrow({ where: { id: started.runId } });
const events = await listEventsByCorrelation(db, LIVE_ORG.id, task.correlationId);
console.log(
  JSON.stringify(
    {
      outcome: {
        status: outcome.status,
        ...(outcome.status === 'succeeded'
          ? { summary: outcome.result.summary }
          : { reasonCode: outcome.reasonCode }),
      },
      run: {
        model: run.model,
        llmCalls: run.llmCalls,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        costMicros: run.costMicros,
        costSource: run.costSource,
      },
      events: events.map((e) => e.type),
    },
    null,
    2,
  ),
);
await db.$disconnect();
