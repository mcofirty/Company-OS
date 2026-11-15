import { z } from 'zod';

export const ModeSchema = z.enum(['demo', 'live']);
export type Mode = z.infer<typeof ModeSchema>;

export const ProvenanceSchema = z.enum(['demo', 'live', 'imported']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const ClassificationSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);
export type Classification = z.infer<typeof ClassificationSchema>;

/** Statut administratif d'un agent (docs/03 §4). */
export const AgentStatusSchema = z.enum(['draft', 'active', 'paused', 'deactivated']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Activité dérivée (docs/01 §10). `walking` n'existe pas ici : c'est un état d'animation
 * purement local, les déplacements ne modifient jamais le statut métier.
 */
export const AgentActivitySchema = z.enum([
  'idle',
  'queued',
  'thinking',
  'working',
  'using_tool',
  'in_meeting',
  'waiting_approval',
  'blocked',
  'paused',
  'offline',
]);
export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const AgentRoleSchema = z.enum(['manager', 'specialist', 'operator']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const TaskStatusSchema = z.enum([
  'created',
  'queued',
  'running',
  'waiting_approval',
  'blocked',
  'succeeded',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Transitions autorisées (docs/03 §4). Toute autre transition est rejetée côté serveur. */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waiting_approval', 'blocked', 'succeeded', 'failed', 'cancelled'],
  waiting_approval: ['running', 'blocked', 'failed', 'cancelled'],
  blocked: ['queued', 'cancelled'],
  failed: ['queued'],
  succeeded: [],
  cancelled: [],
};
export const canTransitionTask = (from: TaskStatus, to: TaskStatus): boolean =>
  TASK_TRANSITIONS[from].includes(to);
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'created',
  'queued',
  'running',
  'waiting_approval',
  'blocked',
];

export const InvocationStatusSchema = z.enum([
  'requested',
  'authorized',
  'waiting_approval',
  'running',
  'rejected',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
]);
export type InvocationStatus = z.infer<typeof InvocationStatusSchema>;

export const INVOCATION_TRANSITIONS: Record<InvocationStatus, readonly InvocationStatus[]> = {
  requested: ['authorized', 'rejected'],
  authorized: ['waiting_approval', 'running', 'rejected'],
  waiting_approval: ['running', 'rejected', 'cancelled'],
  running: ['succeeded', 'failed', 'timed_out', 'cancelled'],
  rejected: [],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};
export const canTransitionInvocation = (from: InvocationStatus, to: InvocationStatus): boolean =>
  INVOCATION_TRANSITIONS[from].includes(to);
export const ACTIVE_INVOCATION_STATUSES: readonly InvocationStatus[] = [
  'requested',
  'authorized',
  'waiting_approval',
  'running',
];

export const ToolRiskSchema = z.enum(['read', 'internal_write', 'external_write', 'high_impact']);
export type ToolRisk = z.infer<typeof ToolRiskSchema>;

/** Type d'opération affiché dans le mur des outils (docs/01 §7). */
export const ToolActionKindSchema = z.enum(['read', 'write', 'search', 'draft', 'send', 'execute']);
export type ToolActionKind = z.infer<typeof ToolActionKindSchema>;

export const TaskKindSchema = z.enum([
  'qualify_lead',
  'check_invoice',
  'forecast_cashflow',
  'draft_campaign',
  'screen_candidates',
  'answer_ticket',
  'weekly_review',
  'send_followup',
  'propose_hire',
  'pricing_review',
  'prepare_offer',
  /** Mission libre rédigée par un humain : organisations live uniquement (la démo reste scriptée). */
  'custom',
]);
export type TaskKind = z.infer<typeof TaskKindSchema>;
/** Tâches du catalogue démo (déterministes) : toutes sauf la mission libre. */
export type DemoTaskKind = Exclude<TaskKind, 'custom'>;
export const isDemoTaskKind = (k: TaskKind): k is DemoTaskKind => k !== 'custom';

export const ActorSchema = z.object({
  kind: z.enum(['user', 'agent', 'system', 'tool']),
  id: z.string().min(1).max(128),
});
export type Actor = z.infer<typeof ActorSchema>;

/** Identifiants lisibles et stables (agents, départements, outils). */
export const SlugIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const ErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'BUDGET_EXCEEDED',
  'RATE_LIMITED',
  'CONFLICT',
  'TOOL_UNAVAILABLE',
  'WORKFLOW_FAILED',
  'EVENT_GAP',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export const ApprovalKindSchema = z.enum(['tool_action', 'agent_hire']);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const MeetingStatusSchema = z.enum([
  'proposed',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
]);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

/** Limites de délégation (docs/04 §6). */
export const DELEGATION_LIMITS = { maxDepth: 3, maxPerRun: 5 } as const;
