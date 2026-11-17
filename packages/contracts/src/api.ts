import { z } from 'zod';
import { ErrorCodeSchema, SlugIdSchema, TaskKindSchema } from './domain';
import type { DomainEvent } from './events';

export const ApiErrorSchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string(), requestId: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const MissionSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    /** Consignes de l'humain (données confiées à l'agent, jamais des droits supplémentaires). */
    instructions: z.string().trim().min(10).max(4000),
  })
  .strict();
export type Mission = z.infer<typeof MissionSchema>;

export const CreateTaskRequestSchema = z
  .object({
    kind: TaskKindSchema,
    /** Optionnel : sinon le serveur choisit un agent disponible du département. */
    agentId: SlugIdSchema.optional(),
    /** Obligatoire pour `custom` (avec agentId), interdit sinon. */
    mission: MissionSchema.optional(),
  })
  .strict()
  .refine((r) => (r.kind === 'custom') === (r.mission !== undefined), {
    message: 'mission requise pour kind=custom, et seulement pour lui',
    path: ['mission'],
  })
  .refine((r) => r.kind !== 'custom' || r.agentId !== undefined, {
    message: 'agentId requis pour une mission',
    path: ['agentId'],
  });

export const AgentSkillsSchema = z.array(z.string().trim().min(1).max(30)).max(8);
export const AgentRoutinesSchema = z.array(z.string().trim().min(1).max(120)).max(6);
/** Mise à jour de la fiche d'un agent (administrateur). */
export const UpdateAgentProfileRequestSchema = z
  .object({ skills: AgentSkillsSchema, routines: AgentRoutinesSchema })
  .strict();
export type UpdateAgentProfileRequest = z.infer<typeof UpdateAgentProfileRequestSchema>;

/** Hiérarchie : rattachement (null = directement à l'administrateur) et rôle. */
export const UpdateReportingRequestSchema = z
  .object({
    managerId: z.string().min(1).max(64).nullable(),
    role: z.enum(['manager', 'specialist']),
  })
  .strict();
export type UpdateReportingRequest = z.infer<typeof UpdateReportingRequestSchema>;

/** Création d'un agent par un administrateur (organisation live). Droits listés explicitement. */
export const CreateAgentRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    title: z.string().trim().min(2).max(60),
    departmentId: z.string().min(1).max(64),
    role: z.enum(['manager', 'specialist']).default('specialist'),
    /** toolId -> actions autorisées (validées contre le catalogue ; `high_impact` refusé). */
    grants: z.record(z.string(), z.array(z.string()).min(1)).default({}),
    goal: z.string().trim().min(5).max(300),
    instructions: z.string().trim().min(20).max(4000),
    /** Budget mensuel plafonné (plafond dur). */
    monthlyBudgetUsd: z.number().min(0.5).max(50).default(5),
    avatarId: z
      .string()
      .regex(/^avatar-\d{2}$/)
      .default('avatar-01'),
    /** Fiche : compétences (étiquettes) et tâches habituelles (affichage seulement). */
    skills: AgentSkillsSchema.default([]),
    routines: AgentRoutinesSchema.default([]),
  })
  .strict();
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const IdempotencyKeySchema = z.string().min(8).max(128);

// ---------- Socket.IO ----------
export const ResumeRequestSchema = z.object({ afterSeq: z.number().int().min(0) });
export type ResumeAck =
  { accepted: true; lastSeq: number; replayed: number } | { accepted: false; error: string };

export interface ServerToClientEvents {
  'domain:event': (event: DomainEvent) => void;
  /** Le client est trop en retard : il doit recharger le snapshot. */
  'sync:required': (info: { lastSeq: number }) => void;
}
export interface ClientToServerEvents {
  'events:resume': (req: { afterSeq: number }, ack: (res: ResumeAck) => void) => void;
}

/** Au-delà de cet écart, le serveur demande un rechargement du snapshot plutôt qu'un rejeu. */
export const MAX_REPLAY_EVENTS = 1000;

export const SystemControlRequestSchema = z.object({ reason: z.string().min(3).max(200) }).strict();

/** Annulation (tâche en file ou bloquée) : motif obligatoire, conservé dans le journal. */
export const CancelTaskRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(200) })
  .strict();
