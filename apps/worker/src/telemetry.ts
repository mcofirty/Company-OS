import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * Export OTLP/HTTP des traces si OTEL_EXPORTER_OTLP_ENDPOINT est défini (Jaeger, Tempo, Honeycomb…).
 * Sinon rien n'est installé : les spans restent des no-op. Les attributs sont filtrés à la source
 * (liste blanche de @company-os/policies).
 */
export function initTelemetry(env: NodeJS.ProcessEnv): (() => Promise<void>) | null {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'company-os-worker',
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  return () => provider.shutdown();
}
