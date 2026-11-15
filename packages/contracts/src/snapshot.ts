import { z } from 'zod';
import {
  AgentActivitySchema,
  AgentRoleSchema,
  AgentStatusSchema,
  InvocationStatusSchema,
  ModeSchema,
  ApprovalKindSchema,
  ApprovalStatusSchema,
  MeetingStatusSchema,
  ProvenanceSchema,
  TaskKindSchema,
  TaskStatusSchema,
  ToolActionKindSchema,
  ToolRiskSchema,
} from './domain';
import { DomainEventSchema } from './events';

export const DepartmentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  capacity: z.number().int(),
  managerAgentId: z.string().nullable(),
});
export type DepartmentView = z.infer<typeof DepartmentViewSchema>;

export const AgentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  role: AgentRoleSchema,
  departmentId: z.string(),
  managerId: z.string().nullable(),
  avatarId: z.string(),
  deskAnchor: z.string(),
  status: AgentStatusSchema,
  activity: AgentActivitySchema,
  currentTaskId: z.string().nullable(),
  /** Fin de la dernière tâche : sert uniquement à la projection visuelle (pause café). */
  lastTaskEndedAt: z.iso.datetime().nullable(),
  provenance: ProvenanceSchema,
});
export type AgentView = z.infer<typeof AgentViewSchema>;

export const TaskViewSchema = z.object({
  id: z.string(),
  kind: TaskKindSchema,
  title: z.string(),
  status: TaskStatusSchema,
  agentId: z.string(),
  correlationId: z.string(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  resultSummary: z.string().nullable(),
  failureCode: z.string().nullable(),
  provenance: ProvenanceSchema,
  parentTaskId: z.string().nullable(),
  depth: z.number().int(),
});
export type TaskView = z.infer<typeof TaskViewSchema>;

export const InvocationViewSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  action: z.string(),
  actionKind: ToolActionKindSchema,
  risk: ToolRiskSchema,
  status: InvocationStatusSchema,
  attempt: z.number().int(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nullable(),
  safeSummary: z.string().nullable(),
  errorCode: z.string().nullable(),
  correlationId: z.string(),
  provenance: ProvenanceSchema,
});
export type InvocationView = z.infer<typeof InvocationViewSchema>;

export const ToolViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  category: z.string(),
  color: z.string(),
  status: z.enum(['healthy', 'degraded', 'down']),
  actions: z.array(
    z.object({
      action: z.string(),
      kind: ToolActionKindSchema,
      risk: ToolRiskSchema,
      label: z.string(),
    }),
  ),
});
export type ToolView = z.infer<typeof ToolViewSchema>;

export const ApprovalViewSchema = z.object({
  id: z.string(),
  kind: ApprovalKindSchema,
  status: ApprovalStatusSchema,
  agentId: z.string(),
  taskId: z.string().nullable(),
  invocationId: z.string().nullable(),
  toolId: z.string().nullable(),
  action: z.string().nullable(),
  riskReason: z.string(),
  safePreview: z.record(z.string(), z.unknown()),
  requestedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  decisionReason: z.string().nullable(),
});
export type ApprovalView = z.infer<typeof ApprovalViewSchema>;

export const MeetingViewSchema = z.object({
  id: z.string(),
  topic: z.string(),
  status: MeetingStatusSchema,
  roomId: z.string(),
  initiatorAgentId: z.string(),
  taskId: z.string().nullable(),
  participantAgentIds: z.array(z.string()),
  seats: z.record(z.string(), z.string()),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  summary: z.string().nullable(),
  decisions: z.array(z.object({ decision: z.string(), ownerAgentId: z.string() })),
  taskIdsCreated: z.array(z.string()),
});
export type MeetingView = z.infer<typeof MeetingViewSchema>;

export const AlertLevelSchema = z.enum(['info', 'warning', 'error', 'critical']);
export type AlertLevel = z.infer<typeof AlertLevelSchema>;
/** Alerte persistée (docs/10 §5). Une alerte par événement source : id = eventId. */
export const AlertViewSchema = z.object({
  id: z.string(),
  level: AlertLevelSchema,
  title: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  eventSeq: z.number().int(),
  createdAt: z.iso.datetime(),
  ackedAt: z.iso.datetime().nullable(),
  ackedBy: z.string().nullable(),
});
export type AlertView = z.infer<typeof AlertViewSchema>;

export const WorldSnapshotSchema = z.object({
  org: z.object({ id: z.uuid(), name: z.string(), mode: ModeSchema }),
  lastSeq: z.number().int().min(0),
  serverTime: z.iso.datetime(),
  worldMap: z.object({ id: z.string(), version: z.number().int() }),
  departments: z.array(DepartmentViewSchema),
  agents: z.array(AgentViewSchema),
  tools: z.array(ToolViewSchema),
  /** Tâches ouvertes + dernières terminées (bornées). */
  tasks: z.array(TaskViewSchema),
  /** Invocations actives + dernières terminées (bornées). */
  invocations: z.array(InvocationViewSchema),
  /** Totaux d'usage LLM de l'org (agrégés depuis agent.run.completed). */
  costs: z.object({
    llmCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costMicros: z.number().int(),
    estimated: z.boolean(),
  }),
  budgets: z.array(
    z.object({
      id: z.string(),
      scopeType: z.enum(['org', 'agent']),
      scopeId: z.string(),
      limitMicros: z.number().int(),
      usedMicros: z.number().int(),
      hardStop: z.boolean(),
      alertThreshold: z.number(),
    }),
  ),
  system: z.object({ paused: z.boolean() }),
  /** Approbations en attente + dernières décidées (bornées). */
  approvals: z.array(ApprovalViewSchema),
  /** Réunions en cours + dernières terminées (bornées). */
  meetings: z.array(MeetingViewSchema),
  /** Alertes non acquittées + dernières acquittées (bornées). */
  alerts: z.array(AlertViewSchema),
  /** Derniers événements (plus récents en premier). */
  timeline: z.array(DomainEventSchema),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

export const LIMITS = {
  tasks: 60,
  invocations: 60,
  timeline: 80,
  approvals: 30,
  meetings: 20,
  alerts: 40,
} as const;
