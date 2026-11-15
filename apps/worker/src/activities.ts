import { DEMO_TASK_CATALOG, TaskKindSchema } from '@company-os/contracts';
import {
  AnthropicProvider,
  buildSystemPrompt,
  buildTaskMessage,
  buildToolDefs,
  parseToolName,
  ProviderError,
  ScriptedDemoProvider,
  wrapToolOutput,
  type LLMProvider,
  type LlmMessage,
  type LoopLimits,
  type LoopOutcome,
  type ModelStepResult,
  type ToolStepResult,
} from '@company-os/agents';
import {
  expireApprovalIfDue,
  getApprovalStatus,
  finishTask,
  loadRunContext,
  recordLlmCall,
  releaseBudget,
  reserveBudget,
  type Db,
  type TaskOutcome,
} from '@company-os/db';
import { costMicros, maxCallCostMicros, withSpan, type Pricing } from '@company-os/policies';
import type { ToolGateway } from '@company-os/tools';

export interface ActivityDeps {
  db: Db;
  gateway: ToolGateway;
  pricing: Pricing;
  /** Fournisseur LLM pour le mode live (null si non configuré : échec fermé). */
  liveProvider: LLMProvider | null;
  /** Fournisseur démo (scripté, sans appel externe). */
  demoProvider?: LLMProvider;
}

export interface PreparedRun {
  runId: string;
  taskMessage: string;
  limits: LoopLimits;
  providerClass: 'demo' | 'llm';
}

/**
 * Activities Temporal (E/S) du workflow d'agent. Chacune est idempotente :
 * - modelStep : un appel modèle compté une seule fois par (run, étape) ;
 * - toolStep : clé d'idempotence `run:<runId>:tool:<toolUseId>` dans la ToolGateway ;
 * - finishRun : transition de tâche vérifiée (rejeu sans effet).
 */
export function createActivities(deps: ActivityDeps) {
  const { db, gateway, pricing } = deps;
  const demoProvider = deps.demoProvider ?? new ScriptedDemoProvider();

  const providerFor = (mode: 'demo' | 'live'): LLMProvider | null =>
    // Échec fermé : en démo, jamais de fournisseur réel.
    mode === 'demo' ? demoProvider : deps.liveProvider;

  const modelStepInner = async (input: {
    runId: string;
    step: number;
    messages: LlmMessage[];
  }): Promise<ModelStepResult> => {
    const ctx = await loadRunContext(db, input.runId);
    if (ctx.org.killSwitch)
      return { kind: 'denied', code: 'KILL_SWITCH', message: 'Système en pause (kill switch).' };
    const provider = providerFor(ctx.org.mode);
    if (!provider) {
      return {
        kind: 'denied',
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Aucun fournisseur LLM configuré pour le mode live.',
      };
    }
    const policy = ctx.version.modelPolicy;
    const system = buildSystemPrompt({
      orgName: ctx.org.name,
      agentName: ctx.agent.name,
      role: `${ctx.agent.title} (${ctx.agent.role})`,
      manager: ctx.manager ? `${ctx.manager.name}, ${ctx.manager.title}` : 'administrateur humain',
      goal: ctx.version.goal,
      taskId: ctx.task.id,
      instructions: ctx.version.instructions,
    });
    const tools = buildToolDefs(ctx.grants);
    const request = {
      model: provider.providerClass === 'demo' ? null : policy.model,
      system,
      messages: input.messages,
      tools,
      maxTokens: policy.maxTokens,
      effort: policy.effort,
    };

    if (provider.providerClass === 'demo') {
      const response = await provider.complete(request);
      return { kind: 'ok', response, costMicros: 0 };
    }

    // Réserve budgétaire avant l'appel (estimation : ~3 caractères par token en entrée).
    const estInput = Math.ceil(
      (system.length + JSON.stringify(input.messages).length + JSON.stringify(tools).length) / 3,
    );
    const reserve = maxCallCostMicros(pricing, policy.model, estInput, policy.maxTokens) ?? 0;
    const remainingRun = ctx.version.limits.maxCostMicros - ctx.run.costMicros;
    if (reserve > remainingRun) {
      return {
        kind: 'denied',
        code: 'BUDGET_EXCEEDED',
        message: 'Plafond de coût du run insuffisant pour un nouvel appel.',
      };
    }
    const r = await reserveBudget(db, {
      orgId: ctx.org.id,
      agentId: ctx.agent.id,
      amountMicros: reserve,
    });
    if (!r.ok)
      return {
        kind: 'denied',
        code: 'BUDGET_EXCEEDED',
        message: `Budget ${r.scope} épuisé (plafond dur).`,
      };

    let response;
    try {
      response = await provider.complete(request);
    } catch (err) {
      await releaseBudget(db, {
        orgId: ctx.org.id,
        agentId: ctx.agent.id,
        amountMicros: reserve,
      });
      // Erreur transitoire : on laisse Temporal réessayer l'activité (backoff + jitter).
      if (err instanceof ProviderError && err.retryable) throw err;
      return {
        kind: 'denied',
        code: 'PROVIDER_ERROR',
        message: err instanceof Error ? err.message : 'Erreur fournisseur',
      };
    }
    const cost = costMicros(pricing, response.model, response.usage);
    await recordLlmCall(db, {
      orgId: ctx.org.id,
      runId: input.runId,
      agentId: ctx.agent.id,
      step: input.step,
      provider: provider.name,
      model: response.model,
      ...response.usage,
      costMicros: cost,
      reservedMicros: reserve,
      pricingVersion: pricing.version,
      stopReason: response.stopReason,
      correlationId: ctx.task.correlationId,
    });
    return { kind: 'ok', response, costMicros: cost ?? 0 };
  };

  return {
    async prepareRun(input: { runId: string }): Promise<PreparedRun> {
      const ctx = await loadRunContext(db, input.runId);
      const kind = TaskKindSchema.parse(ctx.task.kind);
      const spec = DEMO_TASK_CATALOG[kind];
      return {
        runId: input.runId,
        taskMessage: buildTaskMessage({
          id: ctx.task.id,
          kind,
          title: ctx.task.title,
          description: ctx.task.description,
          input: spec.input,
        }),
        limits: ctx.version.limits,
        providerClass: ctx.org.mode === 'demo' ? 'demo' : 'llm',
      };
    },

    /** Span `llm.invoke` : fournisseur, modèle, tokens, coût. Jamais le prompt ni la réponse. */
    async modelStep(input: {
      runId: string;
      step: number;
      messages: LlmMessage[];
    }): Promise<ModelStepResult> {
      return withSpan(
        'llm.invoke',
        { 'run.id': input.runId, 'run.step': input.step },
        async (span) => {
          const r = await modelStepInner(input);
          span.set({
            'llm.outcome': r.kind === 'ok' ? 'ok' : r.code,
            ...(r.kind === 'ok'
              ? {
                  'llm.model': r.response.model ?? 'demo',
                  'llm.input_tokens': r.response.usage.inputTokens,
                  'llm.output_tokens': r.response.usage.outputTokens,
                  'llm.cost_micros': r.costMicros,
                }
              : {}),
          });
          if (r.kind !== 'ok') span.fail(r.code);
          return r;
        },
      );
    },

    async toolStep(input: {
      runId: string;
      step: number;
      toolUseId: string;
      name: string;
      input: unknown;
      causationId: string | null;
      approvalId?: string;
    }): Promise<ToolStepResult> {
      const ctx = await loadRunContext(db, input.runId);
      const parsed = parseToolName(input.name);
      const args =
        input.input && typeof input.input === 'object' && !Array.isArray(input.input)
          ? Object.fromEntries(
              Object.entries(input.input).map(([k, v]) => [
                k,
                typeof v === 'string' ? v : JSON.stringify(v),
              ]),
            )
          : {};
      if (!parsed) {
        return {
          content: `Outil inconnu « ${input.name} ». Utilise uniquement les outils fournis.`,
          isError: true,
          lastEventId: null,
        };
      }
      // Tout appel (même non autorisé) passe par la gateway : il est audité et refusé si besoin.
      const r = await gateway.invoke({
        orgId: ctx.org.id,
        runId: input.runId,
        agentId: ctx.agent.id,
        toolId: parsed.toolId,
        action: parsed.action,
        input: args,
        idempotencyKey: `run:${input.runId}:tool:${input.toolUseId}`,
        causationId: input.causationId ?? ctx.run.startEventId,
        ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      });
      if (r.status === 'waiting_approval') {
        return {
          content: '',
          isError: false,
          lastEventId: r.lastEventId,
          approvalId: r.approvalId,
        };
      }
      if (r.status === 'succeeded') {
        return {
          content: wrapToolOutput(parsed.toolId, parsed.action, r.output),
          isError: false,
          lastEventId: r.lastEventId,
        };
      }
      if (r.status === 'failed') {
        return {
          content: `Erreur outil code=${r.errorCode} après nouvelle tentative.`,
          isError: true,
          lastEventId: r.lastEventId,
        };
      }
      return {
        content: `Refusé par la politique de la plateforme code=${r.reasonCode}. Ce refus est définitif pour cette mission.`,
        isError: true,
        lastEventId: r.lastEventId,
      };
    },

    /** Lecture de l'état d'une validation (filet de sécurité si un signal est perdu). */
    async checkApproval(input: { approvalId: string }): Promise<string> {
      return getApprovalStatus(db, input.approvalId);
    },

    /** Expire la demande si l'échéance est passée ; retourne le statut final. */
    async expireApproval(input: { approvalId: string }): Promise<string> {
      return expireApprovalIfDue(db, input.approvalId);
    },

    async finishRun(input: { runId: string; outcome: LoopOutcome }): Promise<{ status: string }> {
      const run = await db.agentRun.findUniqueOrThrow({
        where: { id: input.runId },
        include: { task: true },
      });
      if (run.task.status !== 'running') return { status: run.task.status }; // déjà clôturée (rejeu)
      const o = input.outcome;
      const outcome: TaskOutcome =
        o.status === 'succeeded'
          ? {
              status: 'succeeded',
              resultRef: `artifact://run/${run.id}`,
              safeSummary: truncate(o.result.summary),
            }
          : { status: o.status, reasonCode: o.reasonCode, safeSummary: truncate(o.summary) };
      await finishTask(db, {
        orgId: run.orgId,
        taskId: run.taskId,
        runId: run.id,
        causationId: o.lastEventId ?? run.startEventId,
        outcome,
      });
      return { status: outcome.status };
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;

const truncate = (s: string): string => (s.length > 270 ? `${s.slice(0, 267)}…` : s);

export function liveProviderFromEnv(env: NodeJS.ProcessEnv): LLMProvider | null {
  const key = env['ANTHROPIC_API_KEY'];
  return key ? new AnthropicProvider({ apiKey: key }) : null;
}
