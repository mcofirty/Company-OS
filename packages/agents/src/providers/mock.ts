import type { LLMProvider, LlmContentBlock, LlmRequest, LlmResponse } from '../types';

/** Fournisseur de test : rejoue une suite de réponses et enregistre les requêtes reçues. */
export class MockProvider implements LLMProvider {
  readonly providerClass = 'llm' as const;
  readonly name = 'mock';
  readonly requests: LlmRequest[] = [];
  private i = 0;

  constructor(
    private readonly script: ((req: LlmRequest) => {
      content: LlmContentBlock[];
      stopReason?: string;
    })[],
    private readonly usage = {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    private readonly model = 'claude-opus-5-5',
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(req));
    const fn = this.script[Math.min(this.i, this.script.length - 1)];
    this.i += 1;
    if (!fn) throw new Error('MockProvider sans script');
    const r = fn(req);
    return {
      content: r.content,
      stopReason: r.stopReason ?? 'tool_use',
      model: this.model,
      usage: this.usage,
    };
  }
}
