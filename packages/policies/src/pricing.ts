import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Grille tarifaire versionnée et horodatée (config/llm-pricing.json), jamais figée dans le code.
 * Les tokens sont mesurés par le fournisseur ; le coût qui en découle est donc « estimé ».
 */
const PricingSchema = z.object({
  version: z.string(),
  effectiveDate: z.string(),
  source: z.string(),
  currency: z.literal('USD'),
  models: z.record(
    z.string(),
    z.object({
      inputPerMTok: z.number().min(0),
      outputPerMTok: z.number().min(0),
      cacheReadPerMTok: z.number().min(0),
      cacheWritePerMTok: z.number().min(0),
    }),
  ),
  /** Outils exécutés par Anthropic, facturés à l'usage en plus des tokens. */
  serverTools: z
    .object({
      webSearchPerRequestUsd: z.number().min(0),
      webFetchPerRequestUsd: z.number().min(0),
      source: z.string(),
    })
    .optional(),
});
export type Pricing = z.infer<typeof PricingSchema>;

export function loadPricing(
  file = path.resolve(import.meta.dirname, '../../../config/llm-pricing.json'),
): Pricing {
  return PricingSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Coût en micro-dollars ; null si le modèle n'est pas tarifé (le coût n'est alors pas inventé). */
export function costMicros(pricing: Pricing, model: string, u: TokenUsage): number | null {
  const p = pricing.models[model];
  if (!p) return null;
  // $/MTok == micro-dollars par token
  return Math.round(
    u.inputTokens * p.inputPerMTok +
      u.outputTokens * p.outputPerMTok +
      u.cacheReadTokens * p.cacheReadPerMTok +
      u.cacheWriteTokens * p.cacheWritePerMTok,
  );
}

/** Réserve maximale pour un appel : entrée estimée + max_tokens de sortie au prix de sortie. */
export function maxCallCostMicros(
  pricing: Pricing,
  model: string,
  estInputTokens: number,
  maxOutputTokens: number,
): number | null {
  const p = pricing.models[model];
  if (!p) return null;
  return Math.ceil(estInputTokens * p.inputPerMTok + maxOutputTokens * p.outputPerMTok);
}

/** Coût des outils serveur (recherche/lecture web) en micro-dollars, selon la grille versionnée. */
export function serverToolCostMicros(
  pricing: Pricing,
  u: { webSearchRequests?: number; webFetchRequests?: number },
): number {
  const p = pricing.serverTools;
  if (!p) return 0;
  return Math.round(
    (u.webSearchRequests ?? 0) * p.webSearchPerRequestUsd * 1_000_000 +
      (u.webFetchRequests ?? 0) * p.webFetchPerRequestUsd * 1_000_000,
  );
}
