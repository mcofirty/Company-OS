import { z } from 'zod';
import {
  ActorSchema,
  ClassificationSchema,
  ProvenanceSchema,
  SlugIdSchema,
  TaskKindSchema,
  ToolActionKindSchema,
  ToolRiskSchema,
  AgentRoleSchema,
} from './domain';

/** Tous les types de l'enveloppe v1 (doit rester égal à l'enum de specs/events.schema.json). */
export const ALL_EVENT_TYPES = [
  'agent.created',
  'agent.activated',
  'agent.paused',
  'agent.resumed',
  'agent.deactivated',
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',
  'task.blocked',
  'agent.run.started',
  'agent.run.completed',
  'tool.invocation.requested',
  'tool.invocation.started',
  'tool.invocation.succeeded',
  'tool.invocation.failed',
  'tool.invocation.rejected',
  'meeting.started',
  'meeting.completed',
  'approval.requested',
  'approval.decided',
  'budget.threshold_reached',
  'system.paused',
  'system.resumed',
  'world.layout.updated',
] as const;
export type AnyEventType = (typeof ALL_EVENT_TYPES)[number];

const SafeText = z.string().max(280);
const Uuid = z.uuid();

// ---------- Payloads implémentés (M1) ----------
export const Payloads = {
  'agent.created': z.object({
    agentId: SlugIdSchema,
    name: z.string().min(1).max(60),
    title: z.string().min(1).max(80),
    role: AgentRoleSchema,
    departmentId: SlugIdSchema,
    managerId: SlugIdSchema.nullable(),
    avatarId: z.string().min(1).max(40),
    deskAnchor: z.string().min(1).max(64),
  }),
  'agent.activated': z.object({ agentId: SlugIdSchema, assignedAnchor: z.string().min(1).max(64) }),
  'task.created': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    kind: TaskKindSchema,
    title: z.string().min(1).max(120),
  }),
  'task.started': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    targetAnchor: z.string().min(1).max(64),
  }),
  'task.completed': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    resultRef: z.string().max(200),
    safeSummary: SafeText,
  }),
  'task.failed': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    reasonCode: z.string().max(64),
    safeSummary: SafeText,
  }),
  'task.blocked': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    reasonCode: z.string().max(64),
    safeSummary: SafeText,
  }),
  'agent.run.started': z.object({
    runId: Uuid,
    agentId: SlugIdSchema,
    taskId: Uuid,
    providerClass: z.enum(['demo', 'llm']),
  }),
  'agent.run.completed': z.object({
    runId: Uuid,
    agentId: SlugIdSchema,
    taskId: Uuid,
    status: z.enum(['succeeded', 'failed', 'blocked']),
    stepCount: z.number().int().min(0),
  }),
  'tool.invocation.requested': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    action: z.string().min(1).max(64),
    actionKind: ToolActionKindSchema,
    risk: ToolRiskSchema,
  }),
  'tool.invocation.started': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    action: z.string().min(1).max(64),
    attempt: z.number().int().min(1),
  }),
  'tool.invocation.succeeded': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    durationMs: z.number().int().min(0),
    safeSummary: SafeText,
  }),
  'tool.invocation.failed': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    durationMs: z.number().int().min(0),
    errorCode: z.string().max(64),
    attempt: z.number().int().min(1),
  }),
  'tool.invocation.rejected': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    reasonCode: z.string().max(64),
  }),
} as const;

export type ImplementedEventType = keyof typeof Payloads;
export type PayloadOf<T extends ImplementedEventType> = z.infer<(typeof Payloads)[T]>;

/** Champs communs de l'enveloppe (specs/events.schema.json). */
export const EnvelopeBase = z.object({
  schemaVersion: z.literal(1),
  eventId: Uuid,
  orgId: Uuid,
  seq: z.number().int().min(1),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().min(1).max(128),
  aggregateVersion: z.number().int().min(1),
  correlationId: Uuid,
  causationId: Uuid.nullable(),
  actor: ActorSchema,
  provenance: ProvenanceSchema,
  occurredAt: z.iso.datetime(),
  classification: ClassificationSchema,
});

const variant = <T extends ImplementedEventType>(type: T) =>
  EnvelopeBase.extend({ type: z.literal(type), payload: Payloads[type] }).strict();

export const DomainEventSchema = z.discriminatedUnion('type', [
  variant('agent.created'),
  variant('agent.activated'),
  variant('task.created'),
  variant('task.started'),
  variant('task.completed'),
  variant('task.failed'),
  variant('task.blocked'),
  variant('agent.run.started'),
  variant('agent.run.completed'),
  variant('tool.invocation.requested'),
  variant('tool.invocation.started'),
  variant('tool.invocation.succeeded'),
  variant('tool.invocation.failed'),
  variant('tool.invocation.rejected'),
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;

/** Événement à écrire : seq, eventId, occurredAt et orgId sont attribués par la couche DB. */
export type NewEvent = {
  [T in DomainEventType]: Omit<
    EventOf<T>,
    'schemaVersion' | 'eventId' | 'orgId' | 'seq' | 'occurredAt'
  >;
}[DomainEventType];
