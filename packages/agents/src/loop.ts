import { AgentResultSchema, SUBMIT_RESULT, type AgentResult } from './tools';
import type { LlmContentBlock, LlmMessage, LlmResponse } from './types';

/**
 * Boucle d'agent bornée (docs/04 §5), sans effet de bord propre : toutes les E/S passent par
 * `deps` (appel modèle, appel outil). Elle est donc déterministe et peut s'exécuter telle quelle
 * dans un Workflow Temporal (les deps sont alors des Activities) ou en direct (tests, mode inline).
 */

export interface LoopLimits {
  maxSteps: number;
  maxDurationMs: number;
  maxCostMicros: number;
}

export type ModelStepResult =
  | { kind: 'ok'; response: LlmResponse; costMicros: number }
  | {
      kind: 'denied';
      code: 'BUDGET_EXCEEDED' | 'KILL_SWITCH' | 'PROVIDER_ERROR' | 'PROVIDER_UNAVAILABLE';
      message: string;
    };

export interface ToolStepResult {
  /** Contenu renvoyé au modèle (sortie redigée, encapsulée comme donnée non fiable). */
  content: string;
  isError: boolean;
  lastEventId: string | null;
  /** Action externe suspendue : décision humaine attendue avant exécution. */
  approvalId?: string | null;
}

export type ApprovalDecision = 'approved' | 'rejected' | 'expired';

export interface LoopDeps {
  modelStep(input: { step: number; messages: LlmMessage[] }): Promise<ModelStepResult>;
  toolStep(input: {
    step: number;
    toolUseId: string;
    name: string;
    input: unknown;
    causationId: string | null;
    approvalId?: string;
  }): Promise<ToolStepResult>;
  /** Attend la décision humaine (signal Temporal ou interrogation en mode inline). */
  waitForApproval(input: { approvalId: string }): Promise<ApprovalDecision>;
  now(): number;
}

export interface LoopInput {
  taskMessage: string;
  limits: LoopLimits;
}

export type LoopOutcome =
  | {
      status: 'succeeded';
      result: AgentResult;
      steps: number;
      costMicros: number;
      lastEventId: string | null;
    }
  | {
      status: 'blocked' | 'failed';
      reasonCode: string;
      summary: string;
      result: AgentResult | null;
      steps: number;
      costMicros: number;
      lastEventId: string | null;
    };

interface ToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}
const isToolUse = (b: LlmContentBlock): b is LlmContentBlock & ToolUse => b.type === 'tool_use';

export async function agentLoop(deps: LoopDeps, input: LoopInput): Promise<LoopOutcome> {
  const start = deps.now();
  const messages: LlmMessage[] = [{ role: 'user', content: input.taskMessage }];
  let steps = 0;
  let cost = 0;
  let nudged = false;
  let lastEventId: string | null = null;

  const stop = (
    status: 'blocked' | 'failed',
    reasonCode: string,
    summary: string,
    result: AgentResult | null = null,
  ): LoopOutcome => ({
    status,
    reasonCode,
    summary,
    result,
    steps,
    costMicros: cost,
    lastEventId,
  });

  for (;;) {
    if (steps >= input.limits.maxSteps)
      return stop(
        'blocked',
        'MAX_STEPS',
        `Limite de ${input.limits.maxSteps} étapes atteinte sans résultat.`,
      );
    if (deps.now() - start > input.limits.maxDurationMs)
      return stop('blocked', 'TIMEOUT', 'Délai maximal du run dépassé.');
    if (cost >= input.limits.maxCostMicros)
      return stop('blocked', 'RUN_BUDGET_EXCEEDED', 'Plafond de coût du run atteint.');

    const r = await deps.modelStep({ step: steps, messages: [...messages] });
    steps += 1;
    if (r.kind === 'denied') return stop('blocked', r.code, r.message);
    cost += r.costMicros;
    const resp = r.response;
    if (resp.stopReason === 'refusal')
      return stop('blocked', 'MODEL_REFUSAL', 'Le modèle a décliné la requête.');

    messages.push({ role: 'assistant', content: resp.content });
    // Outil serveur (recherche web…) interrompu par la limite d'itérations d'Anthropic : on
    // renvoie le tour tel quel, sans nouveau message, et le serveur reprend (compte une étape).
    if (resp.stopReason === 'pause_turn') continue;
    const toolUses = resp.content.filter(isToolUse);
    if (toolUses.length === 0) {
      if (resp.stopReason === 'max_tokens')
        return stop('blocked', 'MAX_TOKENS', 'Réponse tronquée (max_tokens).');
      if (nudged)
        return stop('blocked', 'NO_RESULT', "L'agent n'a pas produit de résultat structuré.");
      nudged = true;
      messages.push({ role: 'user', content: `Termine maintenant en appelant ${SUBMIT_RESULT}.` });
      continue;
    }

    // Tous les tool_result d'un tour dans UN seul message utilisateur.
    const results: LlmContentBlock[] = [];
    let final: AgentResult | null = null;
    for (const tu of toolUses) {
      if (tu.name === SUBMIT_RESULT) {
        const parsed = AgentResultSchema.safeParse(tu.input);
        if (parsed.success) {
          final = parsed.data;
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: 'Résultat enregistré.',
          });
        } else {
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: true,
            content: `Résultat invalide : ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
          });
        }
        continue;
      }
      let out = await deps.toolStep({
        step: steps,
        toolUseId: tu.id,
        name: tu.name,
        input: tu.input,
        causationId: lastEventId,
      });
      if (out.approvalId) {
        if (out.lastEventId) lastEventId = out.lastEventId;
        const approvalId = out.approvalId;
        const decision = await deps.waitForApproval({ approvalId });
        out =
          decision === 'approved'
            ? await deps.toolStep({
                step: steps,
                toolUseId: tu.id,
                name: tu.name,
                input: tu.input,
                causationId: lastEventId,
                approvalId,
              })
            : {
                content: `Action non exécutée : validation ${decision === 'rejected' ? 'refusée' : 'expirée'} par la plateforme. Ne pas réessayer.`,
                isError: true,
                lastEventId: null,
              };
      }
      if (out.lastEventId) lastEventId = out.lastEventId;
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: out.content,
        ...(out.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });

    if (final) {
      if (final.status === 'completed')
        return { status: 'succeeded', result: final, steps, costMicros: cost, lastEventId };
      if (final.status === 'needs_approval')
        return stop('blocked', 'APPROVAL_REQUIRED', final.summary, final);
      if (final.status === 'blocked') return stop('blocked', 'AGENT_BLOCKED', final.summary, final);
      return stop('failed', 'AGENT_FAILED', final.summary, final);
    }
  }
}
