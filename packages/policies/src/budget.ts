/**
 * Arithmétique de budget (docs/05 §6) : réserve avant l'appel modèle, réconciliation après.
 * Montants en micro-dollars. Fonctions pures, testées unitairement.
 */
export interface BudgetState {
  limitMicros: number;
  usedMicros: number;
  reservedMicros: number;
  hardStop: boolean;
  alertThreshold: number; // 0..1
}

export type ReserveDecision =
  { ok: true } | { ok: false; code: 'BUDGET_EXCEEDED'; remainingMicros: number };

export function canReserve(b: BudgetState, amountMicros: number): ReserveDecision {
  const remaining = b.limitMicros - b.usedMicros - b.reservedMicros;
  if (!b.hardStop) return { ok: true };
  if (amountMicros > remaining)
    return { ok: false, code: 'BUDGET_EXCEEDED', remainingMicros: Math.max(0, remaining) };
  return { ok: true };
}

/** Pourcentage atteint (entier, borné) ; 0 si limite nulle (jamais de division par zéro). */
export function usagePercent(usedMicros: number, limitMicros: number): number {
  if (limitMicros <= 0) return 0;
  return Math.min(1000, Math.floor((usedMicros * 100) / limitMicros));
}

/** Vrai si la réconciliation fait franchir le seuil d'alerte. */
export function crossesThreshold(
  before: number,
  after: number,
  limitMicros: number,
  threshold: number,
): boolean {
  if (limitMicros <= 0) return false;
  const t = limitMicros * threshold;
  return before < t && after >= t;
}
