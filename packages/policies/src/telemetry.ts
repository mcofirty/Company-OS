import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

/**
 * Traces OpenTelemetry (docs/10 §2). Sans SDK configuré, l'API OTel est un no-op (coût nul).
 *
 * Règle de protection des données : seuls les attributs de cette liste sortent. Ce sont des
 * identifiants techniques et des mesures, jamais un prompt, un email, un contenu métier ni un
 * secret. Tout autre attribut est ignoré.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST = new Set([
  'org.id',
  'org.mode',
  'request.id',
  'correlation.id',
  'http.method',
  'http.route',
  'http.status_code',
  'agent.id',
  'task.id',
  'run.id',
  'run.step',
  'workflow.id',
  'tool.id',
  'tool.action',
  'tool.risk',
  'tool.invocation_id',
  'tool.status',
  'tool.attempts',
  'tool.reason_code',
  'llm.provider_class',
  'llm.model',
  'llm.input_tokens',
  'llm.output_tokens',
  'llm.cost_micros',
  'llm.estimated',
  'llm.outcome',
]);

export function safeAttributes(attrs: Record<string, unknown>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (!SPAN_ATTRIBUTE_ALLOWLIST.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 128);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const tracer = () => trace.getTracer('company-os');

/** Exécute `fn` dans un span ; les erreurs sont marquées (type seulement, pas de message brut). */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: (span: SafeSpan) => Promise<T>,
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes: safeAttributes(attrs) }, async (span) => {
    try {
      return await fn(wrap(span));
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.name : 'error',
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

export interface SafeSpan {
  set(attrs: Record<string, unknown>): void;
  fail(code: string): void;
}
const wrap = (span: Span): SafeSpan => ({
  set: (attrs) => span.setAttributes(safeAttributes(attrs)),
  fail: (code) => span.setStatus({ code: SpanStatusCode.ERROR, message: code.slice(0, 64) }),
});

/** Span manuel (début/fin séparés), ex. requêtes HTTP Fastify. */
export function startSpan(
  name: string,
  attrs: Record<string, unknown>,
): SafeSpan & { end(): void } {
  const span = tracer().startSpan(name, { attributes: safeAttributes(attrs) });
  return { ...wrap(span), end: () => span.end() };
}
