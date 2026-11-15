import { z } from 'zod';

/** Mode d'exécution. `demo` = simulation déterministe sans appel externe ; `live` = activité réelle. */
export const ModeSchema = z.enum(['demo', 'live']);
export type Mode = z.infer<typeof ModeSchema>;

export const TilePositionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type TilePosition = z.infer<typeof TilePositionSchema>;

export const AgentStatusSchema = z.enum(['idle', 'walking', 'working', 'meeting', 'offline']);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentRoleSchema = z.enum([
  'ceo',
  'engineering',
  'marketing',
  'sales',
  'hr',
  'finance',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ActorSchema = z.object({
  kind: z.enum(['system', 'agent', 'human']),
  id: z.string().min(1).nullable(),
});
export type Actor = z.infer<typeof ActorSchema>;

// ---------- Payloads d'événements ----------

export const AgentSpawnedPayload = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).max(80),
  role: AgentRoleSchema,
  position: TilePositionSchema,
});

export const AgentMovedPayload = z.object({
  agentId: z.string().min(1),
  from: TilePositionSchema,
  to: TilePositionSchema,
});

export const AgentStatusChangedPayload = z.object({
  agentId: z.string().min(1),
  status: AgentStatusSchema,
  /** Résumé lisible de l'activité (jamais un raisonnement interne de LLM). */
  activity: z.string().max(200).nullable(),
});

const envelopeBase = {
  id: z.uuid(),
  /** Numéro de séquence global, strictement croissant, attribué par PostgreSQL. */
  seq: z.number().int().positive(),
  companyId: z.string().min(1),
  mode: ModeSchema,
  occurredAt: z.iso.datetime(),
  actor: ActorSchema,
};

export const DomainEventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelopeBase, type: z.literal('agent.spawned'), payload: AgentSpawnedPayload }),
  z.object({ ...envelopeBase, type: z.literal('agent.moved'), payload: AgentMovedPayload }),
  z.object({
    ...envelopeBase,
    type: z.literal('agent.status_changed'),
    payload: AgentStatusChangedPayload,
  }),
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent['type'];
export const DOMAIN_EVENT_TYPES = DomainEventSchema.options.map(
  (o) => o.shape.type.value,
) as DomainEventType[];

/** Événement avant persistance : `id`, `seq` et `occurredAt` sont attribués par la couche DB. */
export type NewDomainEvent = DomainEvent extends infer E
  ? E extends DomainEvent
    ? Omit<E, 'id' | 'seq' | 'occurredAt'>
    : never
  : never;

// ---------- Projection monde ----------

export const AgentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: AgentRoleSchema,
  status: AgentStatusSchema,
  activity: z.string().nullable(),
  position: TilePositionSchema,
  mode: ModeSchema,
  spawnedAtSeq: z.number().int(),
  updatedAtSeq: z.number().int(),
});
export type AgentView = z.infer<typeof AgentViewSchema>;

export const WorldSnapshotSchema = z.object({
  companyId: z.string(),
  mode: ModeSchema,
  lastSeq: z.number().int().min(0),
  agents: z.array(AgentViewSchema),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

// ---------- Protocole temps réel (Socket.IO) ----------

export const SubscribeRequestSchema = z.object({
  companyId: z.string().min(1),
  afterSeq: z.number().int().min(0),
});
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;

export interface ServerToClientEvents {
  'world:event': (event: DomainEvent) => void;
}
export interface ClientToServerEvents {
  'world:subscribe': (
    req: SubscribeRequest,
    ack: (res: { ok: true; replayed: number } | { ok: false; error: string }) => void,
  ) => void;
}

export const WORLD_SIZE = { width: 14, height: 10 } as const;

/** Plan du bureau (coordonnées de tuiles), partagé par la simulation et le rendu. */
export const OFFICE_LAYOUT = {
  desks: [
    { x: 2, y: 2 },
    { x: 6, y: 2 },
    { x: 10, y: 2 },
    { x: 2, y: 7 },
    { x: 10, y: 7 },
  ],
  meeting: { x: 6, y: 6 },
  coffee: { x: 12, y: 5 },
  /** Emplacements où se tiennent les agents (devant le mobilier, pas dessus). */
  meetingSpot: { x: 7, y: 7 },
  coffeeSpot: { x: 11, y: 6 },
} as const satisfies {
  desks: readonly TilePosition[];
  meeting: TilePosition;
  coffee: TilePosition;
  meetingSpot: TilePosition;
  coffeeSpot: TilePosition;
};
