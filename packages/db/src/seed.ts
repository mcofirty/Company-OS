import { TOOL_CATALOG } from '@company-os/contracts';
import type { Db } from './client';
import { createAgent } from './services/agents';
import { DEMO_AGENTS, DEMO_DEPARTMENTS, DEMO_ORG, DEV_ADMIN } from './seed-data';

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
  let agentsCreated = 0;
  for (const a of DEMO_AGENTS) {
    const r = await createAgent(db, {
      ...a,
      orgId: DEMO_ORG.id,
      createdBy: { kind: 'system', id: 'seed' },
      provenance: 'demo',
      activate: true,
      now,
    });
    if (r.created) agentsCreated++;
  }
  return { agentsCreated };
}
