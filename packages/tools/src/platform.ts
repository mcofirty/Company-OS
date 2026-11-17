import { z } from 'zod';
import { TaskKindSchema } from '@company-os/contracts';
import {
  companyStatus,
  completeMeeting,
  createTask,
  DomainError,
  getDocument,
  listDocuments,
  saveDocument,
  proposeAgentHire,
  proposeSubordinate,
  assignToReport,
  teamOf,
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
    kind: 'internal',
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
    kind: 'internal',
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
    kind: 'internal',
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

/** Outils internes RÉELS des organisations live : état de l'entreprise et bibliothèque. */
PLATFORM_ADAPTERS.push(
  {
    toolId: 'company',
    action: 'status',
    kind: 'internal',
    inputSchema: z.object({ focus: str(80) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    async invoke(ctx, input) {
      const status = await companyStatus(ctx.db, ctx.orgId, input['focus']);
      return {
        summary: `État lu : ${status.agents.length} agent(s), ${status.openMissions.length} mission(s) ouverte(s)`,
        data: status as unknown as Record<string, unknown>,
      };
    },
    summarize: (o) => (o as Out).summary,
  },
  {
    toolId: 'library',
    action: 'save_document',
    kind: 'internal',
    inputSchema: z.object({ title: str(200), content: z.string().min(1).max(200_000) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    async invoke(ctx, input) {
      try {
        // Identifiant = invocation : un rejeu après reprise n'enregistre pas de doublon.
        const doc = await saveDocument(ctx.db, {
          id: ctx.invocationId,
          orgId: ctx.orgId,
          agentId: ctx.agentId,
          taskId: ctx.taskId,
          title: input['title']!,
          content: input['content']!,
        });
        return {
          summary: `Document enregistré : « ${doc.title.slice(0, 120)} »`,
          data: { documentId: doc.id, title: doc.title, size: doc.size },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
    summarize: (o) => (o as Out).summary,
  },
  {
    toolId: 'library',
    action: 'list_documents',
    kind: 'internal',
    inputSchema: z.object({ query: str(120) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    async invoke(ctx, input) {
      const docs = await listDocuments(ctx.db, ctx.orgId, { query: input['query'], limit: 30 });
      return {
        summary: `${docs.length} document(s) trouvé(s)`,
        data: { documents: docs },
      };
    },
    summarize: (o) => (o as Out).summary,
  },
  {
    toolId: 'library',
    action: 'read_document',
    kind: 'internal',
    inputSchema: z.object({ documentId: z.uuid() }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    async invoke(ctx, input) {
      try {
        const doc = await getDocument(ctx.db, ctx.orgId, input['documentId']!);
        return {
          summary: `Document lu : « ${doc.title.slice(0, 120)} »`,
          data: {
            title: doc.title,
            createdAt: doc.createdAt,
            content: doc.content.slice(0, 50_000),
          },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
    summarize: (o) => (o as Out).summary,
  },
);

export const findPlatformAdapter = (toolId: string, action: string): PlatformAdapter | undefined =>
  PLATFORM_ADAPTERS.find((a) => a.toolId === toolId && a.action === action);

/** Garde-fou d'exécution : l'outil Équipe n'agit que pour un agent manager (revérifié ici). */
async function assertManager(ctx: PlatformContext): Promise<void> {
  const me = await ctx.db.agent.findUnique({ where: { id: ctx.agentId } });
  if (!me || me.role !== 'manager') {
    throw new ToolError('POLICY_DENIED', false, 'Outil Équipe réservé aux managers');
  }
}

/** Outil Équipe (organisations live) : un manager pilote ses subordonnés directs. */
PLATFORM_ADAPTERS.push(
  {
    toolId: 'team',
    action: 'list',
    kind: 'internal',
    inputSchema: z.object({ focus: str(80) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      await assertManager(ctx);
      const t = await teamOf(ctx.db, ctx.orgId, ctx.agentId, input['focus']);
      return {
        summary: `Équipe : ${t.reports.length} subordonné(s), ${t.pendingHires} recrutement(s) en attente`,
        data: t,
      };
    },
  },
  {
    toolId: 'team',
    action: 'assign',
    kind: 'internal',
    inputSchema: z
      .object({ assigneeAgentId: str(64), title: str(120), instructions: str(4000) })
      .strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      await assertManager(ctx);
      try {
        const { task } = await assignToReport(ctx.db, {
          orgId: ctx.orgId,
          managerId: ctx.agentId,
          assigneeAgentId: input['assigneeAgentId']!,
          title: input['title']!,
          instructions: input['instructions']!,
          parentTaskId: ctx.taskId,
          idempotencyKey: `inv:${ctx.invocationId}`,
          causationId: ctx.causationId,
        });
        return {
          summary: `Mission « ${task.title} » confiée à ${task.agentId}`.slice(0, 200),
          data: { taskId: task.id, status: task.status },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
  },
  {
    toolId: 'team',
    action: 'wait',
    kind: 'internal',
    inputSchema: z.object({ taskIds: str(2000) }).strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      await assertManager(ctx);
      // Seulement des missions déléguées par CETTE mission (sous-tâches directes).
      const children = await ctx.db.task.findMany({
        where: { orgId: ctx.orgId, parentTaskId: ctx.taskId },
        select: { id: true },
      });
      const own = new Set(children.map((c) => c.id));
      const raw = (input['taskIds'] ?? '').trim();
      const asked =
        raw === '' || /^tout/i.test(raw)
          ? [...own]
          : raw
              .split(',')
              .map((x) => x.trim())
              .filter((x) => own.has(x));
      if (asked.length === 0) {
        throw new ToolError('NO_DELEGATED_TASK', false, 'Aucune mission confiée à attendre');
      }
      return {
        summary: `Attente des résultats de ${asked.length} mission(s) confiée(s)`,
        data: { taskIds: asked },
      };
    },
  },
  {
    toolId: 'team',
    action: 'recruit',
    kind: 'internal',
    inputSchema: z
      .object({
        name: str(40),
        title: str(60),
        goal: str(300),
        instructions: str(3000),
        tools: z.string().max(1000),
        justification: str(300),
      })
      .strict(),
    outputSchema: Out,
    simulatedLatencyMs: 0,
    summarize: (o: unknown) => (o as Out).summary,
    async invoke(ctx, input) {
      await assertManager(ctx);
      try {
        const { approval } = await proposeSubordinate(ctx.db, {
          orgId: ctx.orgId,
          managerAgentId: ctx.agentId,
          taskId: ctx.taskId,
          name: input['name']!,
          title: input['title']!,
          goal: input['goal']!,
          instructions: input['instructions']!,
          tools: input['tools'] ?? '',
          justification: input['justification']!,
          idempotencyKey: `inv:${ctx.invocationId}`,
          correlationId: ctx.correlationId,
          causationId: ctx.causationId,
        });
        return {
          summary: `Recrutement de ${input['name']} proposé : en attente de décision humaine`.slice(
            0,
            200,
          ),
          data: { approvalId: approval.id, status: approval.status },
        };
      } catch (e) {
        return asToolError(e);
      }
    },
  },
);
