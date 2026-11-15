import { DEMO_TASK_CATALOG, isDemoTaskKind, TaskKindSchema } from '@company-os/contracts';
import { SUBMIT_RESULT, toolName } from '../tools';
import type { LLMProvider, LlmContentBlock, LlmMessage, LlmRequest, LlmResponse } from '../types';

/**
 * Fournisseur DÉMO déterministe : suit le même protocole qu'un modèle (tool_use puis
 * submit_result) sans aucun appel externe ni coût. Étiqueté `demo` partout dans l'UI.
 */
export class ScriptedDemoProvider implements LLMProvider {
  readonly providerClass = 'demo' as const;
  readonly name = 'demo-scripted';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const first = typeof req.messages[0]?.content === 'string' ? req.messages[0].content : '';
    const kind = TaskKindSchema.safeParse(/kind="([a-z_]+)"/.exec(first)?.[1]);
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const toolResult = Array.isArray(lastUser?.content)
      ? (lastUser.content as LlmContentBlock[]).find((b) => b.type === 'tool_result')
      : undefined;
    const step = req.messages.filter((m: LlmMessage) => m.role === 'assistant').length;

    const respond = (content: LlmContentBlock[]): LlmResponse => ({
      content,
      stopReason: 'tool_use',
      model: 'demo-scripted',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });

    // Fournisseur scripté : seulement les scénarios du catalogue (une mission libre exige un vrai modèle).
    if (!kind.success || !isDemoTaskKind(kind.data)) {
      return respond([submit(`demo-${step}`, 'failed', 'Mission démo inconnue.')]);
    }
    const spec = DEMO_TASK_CATALOG[kind.data];
    if (!toolResult) {
      return respond([
        { type: 'text', text: `Je consulte ${spec.toolId} (${spec.action}).` },
        {
          type: 'tool_use',
          id: `toolu_demo_${step}`,
          name: toolName(spec.toolId, spec.action),
          input: spec.input,
        },
      ]);
    }
    const text = typeof toolResult.content === 'string' ? toolResult.content : '';
    const summary = /"summary":"([^"]+)"/.exec(text)?.[1];
    if (toolResult.is_error || !summary) {
      const code = /code=([A-Z_0-9]+)/.exec(text)?.[1] ?? 'TOOL_ERROR';
      return respond([
        submit(
          `demo-${step}`,
          'blocked',
          `L'outil ${spec.toolId} n'a pas abouti (${code}). Intervention requise.`,
        ),
      ]);
    }
    return respond([submit(`demo-${step}`, 'completed', summary, `${spec.toolId}.${spec.action}`)]);
  }
}

function submit(id: string, status: string, summary: string, source?: string): LlmContentBlock {
  return {
    type: 'tool_use',
    id: `toolu_${id}`,
    name: SUBMIT_RESULT,
    input: {
      status,
      summary,
      verifiedFacts: source ? [{ claim: summary, sourceRef: source }] : [],
      followUpTasks: [],
      uncertainty: status === 'completed' ? [] : ['Données fictives (démo)'],
    },
  };
}
