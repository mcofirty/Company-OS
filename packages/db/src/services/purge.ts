import { TOOL_CATALOG } from '@company-os/contracts';
import type { Db } from '../client';

/** Tables rattachées à une organisation, dans un ordre qui respecte les clés étrangères. */
const ORG_TABLES = [
  'outbox',
  'event_log',
  'alerts',
  'llm_usage',
  'approval_requests',
  'tool_invocations',
  'agent_runs',
  'documents',
  'budgets',
  'idempotency_keys',
] as const;

/**
 * Retire du serveur TOUTES les organisations de démonstration et leurs données (agents, tâches,
 * journaux…), dans une seule transaction, puis les outils fictifs qui ne servent plus à personne.
 * Idempotent : sans organisation démo, ne fait rien. Les organisations live ne sont jamais touchées.
 */
export async function purgeDemoData(
  db: Db,
): Promise<{ organizations: number; agents: number; events: number; tools: number }> {
  const demos = await db.organization.findMany({ where: { mode: 'demo' }, select: { id: true } });
  const ids = demos.map((o) => o.id);
  let agents = 0;
  let events = 0;
  if (ids.length > 0) {
    await db.$transaction(
      async (tx) => {
        agents = await tx.agent.count({ where: { orgId: { in: ids } } });
        events = await tx.eventLog.count({ where: { orgId: { in: ids } } });
        const agentIds = (
          await tx.agent.findMany({ where: { orgId: { in: ids } }, select: { id: true } })
        ).map((a) => a.id);
        const meetingIds = (
          await tx.meeting.findMany({ where: { orgId: { in: ids } }, select: { id: true } })
        ).map((m) => m.id);
        await tx.meetingParticipant.deleteMany({ where: { meetingId: { in: meetingIds } } });
        await tx.meeting.deleteMany({ where: { orgId: { in: ids } } });
        for (const table of ORG_TABLES) {
          await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE org_id = ANY($1::uuid[])`, ids);
        }
        await tx.$executeRawUnsafe(
          `UPDATE tasks SET parent_task_id = NULL WHERE org_id = ANY($1::uuid[])`,
          ids,
        );
        await tx.task.deleteMany({ where: { orgId: { in: ids } } });
        await tx.agentToolGrant.deleteMany({ where: { agentId: { in: agentIds } } });
        await tx.agentVersion.deleteMany({ where: { agentId: { in: agentIds } } });
        await tx.agent.deleteMany({ where: { orgId: { in: ids } } });
        await tx.department.deleteMany({ where: { orgId: { in: ids } } });
        await tx.membership.deleteMany({ where: { orgId: { in: ids } } });
        await tx.organization.deleteMany({ where: { id: { in: ids } } });
      },
      { timeout: 120_000 },
    );
  }
  // Outils fictifs (catalogue démo) qui ne sont plus référencés par personne.
  const demoTools = TOOL_CATALOG.filter((t) => (t.availability ?? 'demo') === 'demo').map(
    (t) => t.id,
  );
  let tools = 0;
  for (const id of demoTools) {
    const used =
      (await db.agentToolGrant.count({ where: { toolId: id } })) +
      (await db.toolInvocation.count({ where: { toolId: id } }));
    if (used === 0) tools += (await db.tool.deleteMany({ where: { id, orgId: null } })).count;
  }
  return { organizations: ids.length, agents, events, tools };
}
