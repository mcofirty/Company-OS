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
  AlertLevelSchema,
  type AlertView,
  ApprovalKindSchema,
  ApprovalStatusSchema,
  MeetingStatusSchema,
  type ApprovalView,
  type MeetingView,
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
    parentTaskId: t.parentTaskId,
    depth: t.depth,
  };
}

export function approvalView(a: Prisma.ApprovalRequestGetPayload<object>): ApprovalView {
  return {
    id: a.id,
    kind: ApprovalKindSchema.parse(a.kind),
    status: ApprovalStatusSchema.parse(a.status),
    agentId: a.agentId,
    taskId: a.taskId,
    invocationId: a.invocationId,
    toolId: a.toolId,
    action: a.action,
    riskReason: a.riskReason,
    safePreview: a.safePreview as Record<string, unknown>,
    requestedAt: a.requestedAt.toISOString(),
    deadlineAt: a.deadlineAt.toISOString(),
    reviewedBy: a.reviewedBy,
    reviewedAt: iso(a.reviewedAt),
    decisionReason: a.decisionReason,
  };
}

export function meetingView(
  m: Prisma.MeetingGetPayload<{ include: { participants: true } }>,
): MeetingView {
  const ordered = [...m.participants].sort(
    (x, y) => x.joinedAt.getTime() - y.joinedAt.getTime() || x.agentId.localeCompare(y.agentId),
  );
  return {
    id: m.id,
    topic: m.topic,
    status: MeetingStatusSchema.parse(m.status),
    roomId: m.roomId,
    initiatorAgentId: m.initiatorAgentId,
    taskId: m.taskId,
    participantAgentIds: ordered.map((p) => p.agentId),
    seats: Object.fromEntries(ordered.map((p) => [p.agentId, p.seatAnchor])),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    summary: m.summary,
    decisions: (m.decisions ?? []) as MeetingView['decisions'],
    taskIdsCreated: m.taskIdsCreated,
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

export function alertView(a: Prisma.AlertGetPayload<object>): AlertView {
  return {
    id: a.id,
    level: AlertLevelSchema.parse(a.level),
    title: a.title,
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    eventSeq: Number(a.eventSeq),
    createdAt: a.createdAt.toISOString(),
    ackedAt: iso(a.ackedAt),
    ackedBy: a.ackedBy,
  };
}
