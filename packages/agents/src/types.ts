import type Anthropic from '@anthropic-ai/sdk';

/**
 * Format de conversation du runtime d'agents : les types de l'API Messages d'Anthropic
 * (JSON sérialisable, donc compatible avec l'historique Temporal). Le fournisseur démo
 * produit le même format sans appeler de modèle.
 */
export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmContentBlock = Anthropic.Beta.BetaContentBlockParam;

export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface LlmRequest {
  /** null pour le fournisseur démo scripté. */
  model: string | null;
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  maxTokens: number;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface LlmUsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmResponse {
  /** Blocs à renvoyer tels quels au tour suivant (dont les blocs de réflexion, jamais affichés). */
  content: LlmContentBlock[];
  stopReason: string;
  /** Modèle qui a réellement servi la réponse (peut différer en cas de repli serveur). */
  model: string;
  usage: LlmUsageCounts;
}

export interface LLMProvider {
  readonly providerClass: 'demo' | 'llm';
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Erreur fournisseur classée pour la politique de retry (docs/04 §5.8). */
export class ProviderError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_REQUEST' | 'AUTH' | 'UNKNOWN',
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
