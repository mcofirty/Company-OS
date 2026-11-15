import {
  AgentActivitySchema,
  AgentRoleSchema,
  AgentStatusSchema,
  InvocationStatusSchema,
  TaskKindSchema,
  TaskStatusSchema,
  ToolActionKindSchema,
  ToolRiskSchema,
  ToolViewSchema,
  type AgentView,
  type InvocationView,
  type TaskView,
  type ToolView,
} from '@company-os/contracts';
import type { Prisma } from './generated/prisma/client';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function agentView(a: Prisma.AgentGetPayload<object>): AgentView {
  return {
    id: a.id,
    name: a.name,
    title: a.title,
    role: AgentRoleSchema.parse(a.role),
    departmentId: a.departmentId,
    managerId: a.managerId,
    avatarId: a.avatarId,
    deskAnchor: a.deskAnchor,
    status: AgentStatusSchema.parse(a.status),
    activity: AgentActivitySchema.parse(a.activity),
    currentTaskId: a.currentTaskId,
    lastTaskEndedAt: iso(a.lastTaskEndedAt),
    provenance: a.provenance,
  };
}

export function taskView(t: Prisma.TaskGetPayload<object>): TaskView {
  return {
    id: t.id,
    kind: TaskKindSchema.parse(t.kind),
    title: t.title,
    status: TaskStatusSchema.parse(t.status),
    agentId: t.agentId,
    correlationId: t.correlationId,
    createdAt: t.createdAt.toISOString(),
    startedAt: iso(t.startedAt),
    endedAt: iso(t.endedAt),
    resultSummary: t.resultSummary,
    failureCode: t.failureCode,
    provenance: t.provenance,
  };
}

export function invocationView(i: Prisma.ToolInvocationGetPayload<object>): InvocationView {
  return {
    id: i.id,
    toolId: i.toolId,
    agentId: i.agentId,
    taskId: i.taskId,
    action: i.action,
    actionKind: ToolActionKindSchema.parse(i.actionKind),
    risk: ToolRiskSchema.parse(i.risk),
    status: InvocationStatusSchema.parse(i.status),
    attempt: i.attempt,
    requestedAt: i.requestedAt.toISOString(),
    startedAt: iso(i.startedAt),
    endedAt: iso(i.endedAt),
    durationMs: i.durationMs,
    safeSummary: i.safeSummary,
    errorCode: i.errorCode,
    correlationId: i.correlationId,
    provenance: i.provenance,
  };
}

export function toolView(t: Prisma.ToolGetPayload<object>): ToolView {
  return ToolViewSchema.parse({
    id: t.id,
    name: t.name,
    code: t.code,
    category: t.category,
    color: t.color,
    status: t.status,
    actions: t.actions,
  });
}
