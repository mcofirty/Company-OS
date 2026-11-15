/**
 * Rédaction des données sensibles avant stockage UI/logs et avant envoi au modèle
 * (docs/05 §4). Volontairement conservatrice : mieux vaut masquer trop que pas assez.
 */
const RULES: [RegExp, string][] = [
  // Secrets et jetons (clés API, bearer, JWT)
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[SECRET]'],
  [/\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '[SECRET]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[SECRET]'],
  [/\b(?:api[_-]?key|password|passwd|secret)\s*[:=]\s*\S+/gi, '[SECRET]'],
  // Coordonnées
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]'],
  [/\bFR\d{2}(?:\s?[A-Z0-9]{4}){5}\s?[A-Z0-9]{3}\b/g, '[IBAN]'],
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, '[IBAN]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARTE]'],
  [/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g, '[TEL]'],
];

export function redactText(input: string): string {
  let out = input;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

/** Rédige récursivement les chaînes d'une valeur JSON. */
export function redactJson<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactJson(v)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v)])) as T;
  }
  return value;
}

/** Vrai si une chaîne contient encore un motif sensible (tests d'audit des payloads). */
export function containsSensitive(input: string): boolean {
  return RULES.some(([re]) => new RegExp(re.source, re.flags.replace('g', '')).test(input));
}
