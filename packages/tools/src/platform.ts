import { z } from 'zod';
import { TaskKindSchema } from '@company-os/contracts';
import {
  completeMeeting,
  createTask,
  DomainError,
  proposeAgentHire,
  startMeeting,
  type Db,
} from '@company-os/db';
import { ToolError, type ToolAdapter } from './adapters';

/**
 * Actions internes de la plateforme exposées comme outils (donc visibles dans le mur des
 * outils, soumises aux mêmes autorisations et audits). Toutes idempotentes par invocation.
 */
export interface PlatformContext {
  db: Db;
  orgId: string;
  runId: string;
  agentId: string;
  taskId: string;
  invocationId: string;
  correlationId: string;
  causationId: string | null;
  mode: 'demo' | 'live';
  sleep: (ms: number) => Promise<void>;
  latencyScale: number;
}

const Out = z.object({
  summary: z.string().max(200),
  data: z.record(z.string(), z.unknown()).optional(),
});
type Out = z.infer<typeof Out>;
const str = (max = 200) => z.string().min(1).max(max);

/** Traduit une erreur métier en erreur d'outil (code court, non rejouable). */
function asToolError(err: unknown): never {
  if (err instanceof DomainError) {
    const code = /^[A-Z_]{3,40}$/.test(err.message) ? err.message : err.code;
    throw new ToolError(code, false, err.message);
  }
  throw err;
}

export type PlatformAdapter = Omit<ToolAdapter, 'invoke'> & {
  invoke(ctx: PlatformContext, input: Record<string, string>): Promise<Out>;
};

const MEETING_DURATION_MS = 6000;

export const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  {
    toolId: 'platform',
    action: 'propose_agent',
    kind: 'demo',
    inputSchema: z
      .object({ departmentId: str(64), title: str(60), justification: str(200) })
      .strict(),
    outputSchema: Out,
    simulatedLatencyMs: 1200,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      try {
        const { approval } = await proposeAgentHire(ctx.db, {
          orgId: ctx.orgId,
          requesterAgentId: ctx.agentId,
          taskId: ctx.taskId,
          proposal: {
            departmentId: input['departmentId']!,
            title: input['title']!,
            justification: input['justification']!,
          },
          idempotencyKey: `inv:${ctx.invocationId}`,
          correlationId: ctx.correlationId,
          causationId: ctx.causationId,
        });
        const name = String(approval.safePreview['name'] ?? '');
        return {
          summary: `Proposition « ${name}, ${input['title']} » soumise à un admin (aucun agent créé avant décision).`,
          data: { approvalId: approval.id, status: approval.status },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
  },
  {
    toolId: 'platform',
    action: 'convene_meeting',
    kind: 'demo',
    inputSchema: z.object({ topic: str(160), participants: str(400) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 300,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      try {
        const participants = input['participants']!.split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        const started = await startMeeting(ctx.db, {
          orgId: ctx.orgId,
          invocationId: ctx.invocationId,
          taskId: ctx.taskId,
          initiatorAgentId: ctx.agentId,
          topic: input['topic']!,
          participantIds: participants,
          correlationId: ctx.correlationId,
          causationId: ctx.causationId,
        });
        // Durée visuelle et métier de la réunion (ne bloque que ce run).
        await ctx.sleep(Math.round(MEETING_DURATION_MS * ctx.latencyScale));
        const m = started.meeting;
        const isPricing = /remise|prix|tarif/i.test(m.topic);
        const owner =
          m.participantAgentIds.find((p) => p.startsWith('sales')) ?? m.initiatorAgentId;
        const decisions = isPricing
          ? [
              {
                decision: 'Remise plafonnée à 8 % (au lieu de 12 %), validée par Finance',
                ownerAgentId: m.initiatorAgentId,
              },
              {
                decision: 'Préparer l’offre correspondante (brouillon interne)',
                ownerAgentId: owner,
              },
            ]
          : [
              {
                decision: `Point traité : ${m.topic.slice(0, 120)}`,
                ownerAgentId: m.initiatorAgentId,
              },
            ];
        const prefix = ctx.mode === 'demo' ? 'Synthèse (démo)' : 'Synthèse structurée';
        const done = await completeMeeting(ctx.db, {
          orgId: ctx.orgId,
          meetingId: m.id,
          summary: `${prefix} : ${m.topic} — ${m.participantAgentIds.length} participants${
            started.excluded.length ? `, absents : ${started.excluded.join(', ')}` : ''
          }.`,
          decisions,
          delegations: isPricing ? [{ kind: 'prepare_offer' }] : [],
          causationId: started.eventId,
        });
        return {
          summary: `Réunion terminée : ${done.meeting.decisions.length} décision(s), ${done.meeting.taskIdsCreated.length} tâche(s) déléguée(s).`,
          data: {
            meetingId: m.id,
            decisions: done.meeting.decisions,
            taskIdsCreated: done.meeting.taskIdsCreated,
          },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
  },
  {
    toolId: 'platform',
    action: 'delegate_task',
    kind: 'demo',
    inputSchema: z.object({ kind: str(40), assigneeAgentId: str(64) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 600,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      const kind = TaskKindSchema.safeParse(input['kind']);
      if (!kind.success) throw new ToolError('UNKNOWN_TASK_KIND', false, 'Type de tâche inconnu');
      try {
        const { task } = await createTask(ctx.db, {
          orgId: ctx.orgId,
          kind: kind.data,
          agentId: input['assigneeAgentId'],
          requester: { kind: 'agent', id: ctx.agentId },
          parentTaskId: ctx.taskId,
          idempotencyKey: `inv:${ctx.invocationId}`,
          causationId: ctx.causationId,
        });
        return {
          summary: `Tâche « ${task.title} » déléguée à ${task.agentId}.`,
          data: { taskId: task.id },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
  },
];

export const findPlatformAdapter = (toolId: string, action: string): PlatformAdapter | undefined =>
  PLATFORM_ADAPTERS.find((a) => a.toolId === toolId && a.action === action);
