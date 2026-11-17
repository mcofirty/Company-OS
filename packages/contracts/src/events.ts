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
  ApprovalKindSchema,
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
  'task.cancelled',
  'task.retry_scheduled',
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
  'tool.connector.updated',
  'agent.grants.updated',
  'agent.profile.updated',
  'agent.reporting.updated',
  'agent.deleted',
  'agent.version.updated',
  'budget.updated',
  'schedule.updated',
  'department.updated',
] as const;
export type AnyEventType = (typeof ALL_EVENT_TYPES)[number];

const SafeText = z.string().max(280);

/**
 * Usage LLM d'un run. Les tokens viennent du fournisseur (mesurés) ; le coût est calculé à
 * partir d'une grille tarifaire versionnée (`estimated`), ou `none` sans appel LLM.
 * Unité : micro-dollars (1e-6 USD) pour ne pas perdre les fractions de centime.
 */
export const RunUsageSchema = z.object({
  llmCalls: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costMicros: z.number().int().min(0),
  costSource: z.enum(['none', 'estimated', 'measured']),
  model: z.string().max(64).nullable(),
});
export type RunUsage = z.infer<typeof RunUsageSchema>;
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
    /** Délégation : tâche parente et profondeur (0 = tâche racine). */
    parentTaskId: Uuid.nullable().default(null),
    depth: z.number().int().min(0).max(3).default(0),
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
  /** Erreur technique passagère : la mission est remise en file pour un nouvel essai automatique. */
  'task.retry_scheduled': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    reasonCode: z.string().max(64),
    /** Numéro de l'essai automatique (1 ou 2). */
    attempt: z.number().int().min(1).max(5),
    notBefore: z.iso.datetime(),
  }),
  /** Annulation humaine d'une tâche en file ou bloquée ; `retriedAs` = tâche qui la remplace. */
  'task.cancelled': z.object({
    taskId: Uuid,
    agentId: SlugIdSchema,
    reason: z.string().min(3).max(200),
    retriedAs: Uuid.nullable(),
  }),
  'agent.run.started': z.object({
    runId: Uuid,
    agentId: SlugIdSchema,
    taskId: Uuid,
    providerClass: z.enum(['demo', 'llm']),
    /** Modèle demandé (null pour le fournisseur démo scripté, sans LLM). */
    model: z.string().max(64).nullable().default(null),
    agentVersion: z.number().int().min(1).nullable().default(null),
    /** Choix du modèle pour cette mission (optimisation automatique ou niveau fixé). */
    routing: z
      .object({
        tier: z.enum(['economy', 'balanced', 'quality']),
        auto: z.boolean(),
        reason: z.string().max(200),
      })
      .nullable()
      .default(null),
  }),
  'agent.run.completed': z.object({
    runId: Uuid,
    agentId: SlugIdSchema,
    taskId: Uuid,
    status: z.enum(['succeeded', 'failed', 'blocked']),
    stepCount: z.number().int().min(0),
    usage: RunUsageSchema.default({
      llmCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      costSource: 'none',
      model: null,
    }),
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
  'budget.threshold_reached': z.object({
    budgetId: Uuid,
    scopeType: z.enum(['org', 'agent']),
    scopeId: z.string().min(1).max(64),
    percent: z.number().int().min(0).max(1000),
    usedMicros: z.number().int().min(0),
    limitMicros: z.number().int().min(0),
    hardStop: z.boolean(),
  }),
  'approval.requested': z.object({
    approvalId: Uuid,
    kind: ApprovalKindSchema,
    /** Agent à l'origine de la demande (jamais l'approbateur). */
    agentId: SlugIdSchema,
    taskId: Uuid.nullable(),
    invocationId: Uuid.nullable(),
    toolId: SlugIdSchema.nullable(),
    action: z.string().max(64).nullable(),
    riskReason: SafeText,
    /** Aperçu rédigé, sans secret ni donnée sensible. */
    safePreview: z.record(
      z.string(),
      z.union([z.string().max(300), z.number(), z.boolean(), z.array(z.string().max(80)).max(20)]),
    ),
    deadlineAt: z.iso.datetime(),
  }),
  'approval.decided': z.object({
    approvalId: Uuid,
    decision: z.enum(['approved', 'rejected', 'expired']),
    reviewerId: z.string().min(1).max(128),
    reason: z.string().max(280),
  }),
  'meeting.started': z.object({
    meetingId: Uuid,
    roomId: z.string().min(1).max(64),
    topic: z.string().min(1).max(160),
    initiatorAgentId: SlugIdSchema,
    taskId: Uuid.nullable(),
    participantAgentIds: z.array(SlugIdSchema).min(2).max(8),
    /** Siège réservé par participant (aucun chevauchement). */
    seats: z.record(z.string(), z.string().max(64)),
    /** Réunion convoquée par un humain : fin prévue (clôture automatique). */
    endsAt: z.iso.datetime().nullable().default(null),
  }),
  'meeting.completed': z.object({
    meetingId: Uuid,
    summary: SafeText,
    decisions: z
      .array(z.object({ decision: z.string().max(200), ownerAgentId: SlugIdSchema }))
      .max(10),
    taskIdsCreated: z.array(Uuid).max(5),
  }),
  'agent.paused': z.object({ agentId: SlugIdSchema, reason: z.string().min(1).max(200) }),
  'agent.resumed': z.object({ agentId: SlugIdSchema, reason: z.string().min(1).max(200) }),
  'agent.deactivated': z.object({ agentId: SlugIdSchema, reason: z.string().min(1).max(200) }),
  'system.paused': z.object({ reason: z.string().min(1).max(200) }),
  'system.resumed': z.object({ reason: z.string().min(1).max(200) }),
  'tool.invocation.rejected': z.object({
    invocationId: Uuid,
    toolId: SlugIdSchema,
    agentId: SlugIdSchema,
    taskId: Uuid,
    reasonCode: z.string().max(64),
  }),
  /**
   * Connecteur MCP ajouté, synchronisé, modifié ou retiré par un administrateur : la machine-outil
   * correspondante apparaît, change ou disparaît du QG. Aucun secret, aucune URL complète.
   */
  'tool.connector.updated': z.object({
    toolId: SlugIdSchema,
    name: z.string().min(1).max(60),
    code: z.string().min(1).max(4),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Application du catalogue (logo) ; null = serveur MCP libre. */
    app: z.string().max(40).nullable().default(null),
    status: z.enum(['healthy', 'degraded', 'down']),
    removed: z.boolean(),
    actions: z
      .array(
        z.object({
          action: z.string().min(1).max(64),
          kind: ToolActionKindSchema,
          risk: ToolRiskSchema,
          label: z.string().min(1).max(80),
        }),
      )
      .max(200),
    change: z.enum(['added', 'synced', 'policy', 'removed', 'error']),
  }),
  /** Droits d'outils d'un agent remplacés par un administrateur humain (jamais par un agent). */
  'agent.grants.updated': z.object({
    agentId: SlugIdSchema,
    grants: z.record(z.string().max(64), z.array(z.string().max(64)).max(200)),
  }),
  /** Fiche d'un agent modifiée par un administrateur (affichage seulement, aucun droit). */
  'agent.profile.updated': z.object({
    agentId: SlugIdSchema,
    skills: z.array(z.string().min(1).max(30)).max(8),
    routines: z.array(z.string().min(1).max(120)).max(6),
  }),
  /** Hiérarchie modifiée par un administrateur humain : rattachement et/ou rôle de manager. */
  'agent.reporting.updated': z.object({
    agentId: SlugIdSchema,
    managerId: SlugIdSchema.nullable(),
    role: AgentRoleSchema,
    reason: z.string().max(200),
  }),
  /**
   * Agent supprimé par un administrateur : il quitte le QG et l'organigramme ; son historique
   * (tâches, invocations, journal) reste consultable. Ses subordonnés sont rattachés à son manager.
   */
  'agent.deleted': z.object({
    agentId: SlugIdSchema,
    reason: z.string().min(1).max(200),
    reportsReassignedTo: SlugIdSchema.nullable(),
  }),
  /** Nouvelle version d'un agent (objectif, consignes, modèle) décidée par un administrateur. */
  'agent.version.updated': z.object({
    agentId: SlugIdSchema,
    version: z.number().int().min(2),
    model: z.string().max(64),
    note: z.string().max(200),
  }),
  /** Budget modifié : nouveau plafond (admin) ou nouvelle période mensuelle (remise à zéro). */
  'budget.updated': z.object({
    budgetId: Uuid,
    scopeType: z.enum(['org', 'agent']),
    scopeId: z.string().min(1).max(64),
    limitMicros: z.number().int().min(0),
    previousLimitMicros: z.number().int().min(0),
    usedMicros: z.number().int().min(0),
    reason: z.enum(['limit_changed', 'new_period']),
  }),
  /** Mission récurrente créée / modifiée / suspendue / supprimée / déclenchée (audit). */
  'schedule.updated': z.object({
    scheduleId: Uuid,
    agentId: SlugIdSchema,
    title: z.string().min(1).max(120),
    change: z.enum(['created', 'updated', 'paused', 'resumed', 'deleted', 'triggered', 'skipped']),
    nextRunAt: z.iso.datetime().nullable(),
    taskId: Uuid.nullable(),
  }),
  /** Pôle créé (local de l'aile d'extension) ou modifié (nom, couleur) par un administrateur. */
  'department.updated': z.object({
    departmentId: z.string().min(1).max(64),
    roomId: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    capacity: z.number().int().min(0).max(50),
    change: z.enum(['created', 'updated']),
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
  variant('budget.threshold_reached'),
  variant('system.paused'),
  variant('system.resumed'),
  variant('approval.requested'),
  variant('approval.decided'),
  variant('meeting.started'),
  variant('meeting.completed'),
  variant('agent.paused'),
  variant('agent.resumed'),
  variant('agent.deactivated'),
  variant('task.cancelled'),
  variant('task.retry_scheduled'),
  variant('tool.connector.updated'),
  variant('agent.grants.updated'),
  variant('agent.profile.updated'),
  variant('agent.reporting.updated'),
  variant('agent.deleted'),
  variant('agent.version.updated'),
  variant('budget.updated'),
  variant('schedule.updated'),
  variant('department.updated'),
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
