import { z } from 'zod';
import {
  AgentActivitySchema,
  AgentRoleSchema,
  AgentStatusSchema,
  InvocationStatusSchema,
  ModeSchema,
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
  /** Derniers événements (plus récents en premier). */
  timeline: z.array(DomainEventSchema),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

export const LIMITS = { tasks: 60, invocations: 60, timeline: 80 } as const;
