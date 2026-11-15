import {
  ACTIVE_INVOCATION_STATUSES,
  LIMITS,
  OPEN_TASK_STATUSES,
  type WorldSnapshot,
} from '@company-os/contracts';
import {
  HQ_MAP,
  trimAlerts,
  trimApprovals,
  trimInvocations,
  trimMeetings,
  trimTasks,
} from '@company-os/world';
import type { Db } from './client';
import { Prisma } from './generated/prisma/client';
import { rowToEvent } from './events';
import {
  agentView,
  alertView,
  approvalView,
  invocationView,
  meetingView,
  taskView,
  toolView,
} from './views';

/**
 * Snapshot cohérent : toutes les lectures dans une transaction REPEATABLE READ, donc
 * `lastSeq` correspond exactement à l'état lu (pas de fenêtre de course).
 * Mêmes règles de bornage que le réducteur client (trimTasks / trimInvocations).
 */
export async function loadSnapshot(db: Db, orgId: string): Promise<WorldSnapshot | null> {
  return db.$transaction(
    async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: orgId } });
      if (!org) return null;
      const [departments, agents, tools, openTasks, doneTasks, activeInv, doneInv, events] =
        await Promise.all([
          tx.department.findMany({ where: { orgId }, orderBy: { id: 'asc' } }),
          tx.agent.findMany({ where: { orgId, deletedAt: null }, orderBy: { id: 'asc' } }),
          tx.tool.findMany({ where: { OR: [{ orgId }, { orgId: null }] }, orderBy: { id: 'asc' } }),
          tx.task.findMany({ where: { orgId, status: { in: [...OPEN_TASK_STATUSES] } } }),
          tx.task.findMany({
            where: { orgId, status: { notIn: [...OPEN_TASK_STATUSES] } },
            orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
            take: LIMITS.tasks,
          }),
          tx.toolInvocation.findMany({
            where: { orgId, status: { in: [...ACTIVE_INVOCATION_STATUSES] } },
          }),
          tx.toolInvocation.findMany({
            where: { orgId, status: { notIn: [...ACTIVE_INVOCATION_STATUSES] } },
            orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
            take: LIMITS.invocations,
          }),
          tx.eventLog.findMany({
            where: { orgId },
            orderBy: { seq: 'desc' },
            take: LIMITS.timeline,
          }),
        ]);
      // Coûts : imputés au snapshot quand le run est terminé (même règle que le réducteur).
      const [approvalsOpen, approvalsDone, meetingsOpen, meetingsDone] = await Promise.all([
        tx.approvalRequest.findMany({ where: { orgId, status: 'pending' } }),
        tx.approvalRequest.findMany({
          where: { orgId, status: { not: 'pending' } },
          orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
          take: LIMITS.approvals,
        }),
        tx.meeting.findMany({
          where: { orgId, status: 'in_progress' },
          include: { participants: true },
        }),
        tx.meeting.findMany({
          where: { orgId, status: { not: 'in_progress' } },
          orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
          take: LIMITS.meetings,
          include: { participants: true },
        }),
      ]);
      const [alertsOpen, alertsDone] = await Promise.all([
        tx.alert.findMany({ where: { orgId, ackedAt: null } }),
        tx.alert.findMany({
          where: { orgId, ackedAt: { not: null } },
          orderBy: { eventSeq: 'desc' },
          take: LIMITS.alerts,
        }),
      ]);
      const [costAgg, estimatedRuns, budgets] = await Promise.all([
        tx.agentRun.aggregate({
          where: { orgId, status: { not: 'running' } },
          _sum: { llmCalls: true, inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.agentRun.count({
          where: { orgId, status: { not: 'running' }, costSource: 'estimated' },
        }),
        tx.budget.findMany({
          where: { orgId },
          orderBy: [{ scopeType: 'asc' }, { scopeId: 'asc' }],
        }),
      ]);
      return {
        org: { id: org.id, name: org.name, mode: org.mode },
        lastSeq: Number(org.lastSeq),
        serverTime: new Date().toISOString(),
        worldMap: { id: HQ_MAP.id, version: HQ_MAP.version },
        departments: departments.map((d) => ({
          id: d.id,
          roomId: d.roomId,
          name: d.name,
          color: d.color,
          capacity: d.capacity,
          managerAgentId: d.managerAgentId,
        })),
        agents: agents.map(agentView),
        tools: tools.map(toolView),
        tasks: trimTasks([...openTasks, ...doneTasks].map(taskView)),
        invocations: trimInvocations([...activeInv, ...doneInv].map(invocationView)),
        costs: {
          llmCalls: costAgg._sum.llmCalls ?? 0,
          inputTokens: costAgg._sum.inputTokens ?? 0,
          outputTokens: costAgg._sum.outputTokens ?? 0,
          costMicros: costAgg._sum.costMicros ?? 0,
          estimated: estimatedRuns > 0,
        },
        budgets: budgets.map((b) => ({
          id: b.id,
          scopeType: b.scopeType === 'agent' ? ('agent' as const) : ('org' as const),
          scopeId: b.scopeId,
          limitMicros: b.limitMicros,
          usedMicros: b.usedMicros,
          hardStop: b.hardStop,
          alertThreshold: b.alertThreshold,
        })),
        system: { paused: org.killSwitch },
        approvals: trimApprovals([...approvalsOpen, ...approvalsDone].map(approvalView)),
        meetings: trimMeetings([...meetingsOpen, ...meetingsDone].map(meetingView)),
        alerts: trimAlerts([...alertsOpen, ...alertsDone].map(alertView)),
        timeline: events.map(rowToEvent),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
