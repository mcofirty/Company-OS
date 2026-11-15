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
