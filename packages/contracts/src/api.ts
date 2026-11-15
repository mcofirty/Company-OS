import { z } from 'zod';
import { ErrorCodeSchema, SlugIdSchema, TaskKindSchema } from './domain';
import type { DomainEvent } from './events';

export const ApiErrorSchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string(), requestId: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const CreateTaskRequestSchema = z
  .object({
    kind: TaskKindSchema,
    /** Optionnel : sinon le serveur choisit un agent disponible du département. */
    agentId: SlugIdSchema.optional(),
  })
  .strict();
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
