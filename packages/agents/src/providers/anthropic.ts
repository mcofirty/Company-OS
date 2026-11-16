import Anthropic from '@anthropic-ai/sdk';
import {
  ProviderError,
  type LLMProvider,
  type LlmContentBlock,
  type LlmRequest,
  type LlmResponse,
} from '../types';

export interface AnthropicProviderOptions {
  /** Clé lue côté serveur uniquement (jamais transmise au navigateur, jamais journalisée). */
  apiKey?: string;
  /** Injection pour les tests (aucun appel réseau). */
  fetch?: ConstructorParameters<typeof Anthropic>[0] extends infer O
    ? O extends { fetch?: infer F }
      ? F
      : never
    : never;
  baseURL?: string;
  timeoutMs?: number;
}

/**
 * Adaptateur Anthropic (API Messages + tool use, boucle pilotée par notre runtime).
 * - réflexion adaptative par défaut du modèle (jamais affichée : seuls les blocs sont renvoyés tels quels) ;
 * - effort explicite depuis la politique de version ;
 * - repli serveur en cas de refus (`fallbacks: "default"`) ;
 * - erreurs classées retryable / définitive pour la politique de reprise.
 */
export class AnthropicProvider implements LLMProvider {
  readonly providerClass = 'llm' as const;
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      timeout: opts.timeoutMs ?? 120_000,
      maxRetries: 2,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!req.model)
      throw new ProviderError('BAD_REQUEST', false, 'Modèle requis pour le fournisseur Anthropic');
    try {
      const res = await this.client.beta.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: req.effort },
        system: req.system,
        tools: [
          ...req.tools.map((t) => ({ ...t, strict: true })),
          // Outils serveur (exécutés par Anthropic) : recherche 10 $/1 000, lecture sans surcoût.
          ...(req.webTools?.search
            ? [{ type: 'web_search_20260318' as const, name: 'web_search' as const, max_uses: 5 }]
            : []),
          ...(req.webTools?.fetch
            ? [
                {
                  type: 'web_fetch_20260318' as const,
                  name: 'web_fetch' as const,
                  max_uses: 5,
                  max_content_tokens: 20_000,
                },
              ]
            : []),
        ],
        messages: req.messages,
      });
      return {
        content: res.content as unknown as LlmContentBlock[],
        stopReason: res.stop_reason ?? 'end_turn',
        model: res.model,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          webSearchRequests: res.usage.server_tool_use?.web_search_requests ?? 0,
          webFetchRequests: res.usage.server_tool_use?.web_fetch_requests ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError)
        throw new ProviderError('RATE_LIMITED', true, 'Limite de débit du fournisseur');
      if (
        err instanceof Anthropic.AuthenticationError ||
        err instanceof Anthropic.PermissionDeniedError
      ) {
        throw new ProviderError('AUTH', false, 'Authentification fournisseur refusée');
      }
      if (err instanceof Anthropic.BadRequestError)
        throw new ProviderError('BAD_REQUEST', false, `Requête refusée : ${err.message}`);
      if (
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError
      ) {
        throw new ProviderError('UNAVAILABLE', true, 'Fournisseur indisponible');
      }
      if (err instanceof Anthropic.APIError)
        throw new ProviderError('UNKNOWN', (err.status ?? 500) >= 500, err.message);
      throw err;
    }
  }
}
