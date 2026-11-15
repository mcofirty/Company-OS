import { randomUUID } from 'node:crypto';
import { TOOL_CATALOG } from '@company-os/contracts';
import { instructionsFor, PROMPT_VERSION } from '@company-os/agents';
import type { Db } from './client';
import { createAgent } from './services/agents';
import { DEMO_AGENTS, DEMO_DEPARTMENTS, DEMO_ORG, DEV_ADMIN } from './seed-data';

/** Politique par défaut des versions d'agent (modèle runtime configurable, distinct du modèle de dev). */
export const DEFAULT_MODEL_POLICY = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  maxTokens: 8000,
} as const;
export const DEFAULT_LIMITS = {
  maxSteps: 8,
  maxDurationMs: 5 * 60_000,
  maxCostMicros: 500_000,
} as const;

/** Seed démo relançable sans doublons (upserts + createAgent idempotent). */
export async function seedDemo(db: Db, now = new Date()): Promise<{ agentsCreated: number }> {
  await db.organization.upsert({ where: { id: DEMO_ORG.id }, create: DEMO_ORG, update: {} });
  await db.user.upsert({ where: { id: DEV_ADMIN.id }, create: DEV_ADMIN, update: {} });
  await db.membership.upsert({
    where: { orgId_userId: { orgId: DEMO_ORG.id, userId: DEV_ADMIN.id } },
    create: { orgId: DEMO_ORG.id, userId: DEV_ADMIN.id, role: 'admin' },
    update: {},
  });
  for (const d of DEMO_DEPARTMENTS) {
    await db.department.upsert({
      where: { id: d.id },
      create: { ...d, orgId: DEMO_ORG.id, roomId: d.id },
      update: {},
    });
  }
  for (const t of TOOL_CATALOG) {
    const data = {
      name: t.name,
      code: t.code,
      category: t.category,
      color: t.color,
      actions: t.actions.map((a) => ({ ...a })),
    };
    await db.tool.upsert({
      where: { id: t.id },
      create: { id: t.id, orgId: null, ...data },
      update: data,
    });
  }
  // Budgets mensuels (micro-dollars) : plafond dur, alerte à 80 %.
  const budgets = [
    { scopeType: 'org', scopeId: DEMO_ORG.id, limitMicros: 20_000_000 },
    ...DEMO_AGENTS.map((a) => ({ scopeType: 'agent', scopeId: a.id, limitMicros: 2_000_000 })),
  ];
  for (const b of budgets) {
    await db.budget.upsert({
      where: {
        orgId_scopeType_scopeId_period: {
          orgId: DEMO_ORG.id,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
          period: 'month',
        },
      },
      create: { id: randomUUID(), orgId: DEMO_ORG.id, ...b, hardStop: true, alertThreshold: 0.8 },
      update: {},
    });
  }
  let agentsCreated = 0;
  for (const a of DEMO_AGENTS) {
    const r = await createAgent(db, {
      ...a,
      orgId: DEMO_ORG.id,
      createdBy: { kind: 'system', id: 'seed' },
      provenance: 'demo',
      activate: true,
      now,
      initialVersion: {
        promptVersion: PROMPT_VERSION,
        instructions: instructionsFor(a.departmentId, a.role),
        goal: `${a.title} — ${DEMO_DEPARTMENTS.find((d) => d.id === a.departmentId)?.name ?? a.departmentId}`,
        modelPolicy: DEFAULT_MODEL_POLICY,
        limits: DEFAULT_LIMITS,
      },
    });
    if (r.created) agentsCreated++;
  }
  return { agentsCreated };
}
