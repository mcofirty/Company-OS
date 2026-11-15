import { z } from 'zod';

/** Erreur d'outil classée : `retryable` pilote la politique de retry (docs/05 §7). */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolExecutionContext {
  mode: 'demo' | 'live';
  invocationId: string;
  attempt: number;
}

export interface ToolAdapter<I = unknown, O = unknown> {
  toolId: string;
  action: string;
  /** `demo` : adaptateur fictif sans réseau. Un adaptateur `live` est refusé en mode démo. */
  kind: 'demo' | 'live';
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Latence simulée (démo) pour que l'activité soit observable ; mise à l'échelle par la gateway. */
  simulatedLatencyMs: number;
  invoke(ctx: ToolExecutionContext, input: I): Promise<O>;
  /** Résumé sûr pour l'UI et les logs (aucune donnée sensible). */
  summarize(output: O): string;
}

const Summary = z.object({ summary: z.string().max(200) });
type Summary = z.infer<typeof Summary>;

function demoAdapter<I>(
  toolId: string,
  action: string,
  inputSchema: z.ZodType<I>,
  latency: number,
  run: (input: I) => Summary,
): ToolAdapter<I, Summary> {
  return {
    toolId,
    action,
    kind: 'demo',
    inputSchema,
    outputSchema: Summary,
    simulatedLatencyMs: latency,
    invoke: async (_ctx, input) => run(input),
    summarize: (o) => o.summary,
  };
}

const ref = (k: string) => z.object({ [k]: z.string().min(1).max(64) }).strict();

/** Adaptateurs démo : résultats fictifs déterministes, jamais d'appel réseau. */
export const DEMO_ADAPTERS: ToolAdapter[] = [
  demoAdapter('crm', 'lookup_lead', ref('leadRef'), 3200, (i) => ({
    summary: `Prospect ${i['leadRef']} trouvé (fictif) : secteur SaaS, demande de démo, score 82/100.`,
  })),
  demoAdapter('crm', 'add_note', ref('leadRef'), 1500, (i) => ({
    summary: `Note interne ajoutée sur ${i['leadRef']} (fictif).`,
  })),
  demoAdapter('email', 'draft_email', ref('ticketRef'), 2600, (i) => ({
    summary: `Brouillon de réponse préparé pour ${i['ticketRef']} (non envoyé).`,
  })),
  demoAdapter('analytics', 'query_metrics', ref('metric'), 2400, (i) => ({
    summary: `Métrique ${i['metric']} consolidée (données fictives).`,
  })),
  demoAdapter('docs', 'draft_doc', ref('topic'), 3600, (i) => ({
    summary: `Brouillon « ${i['topic']} » rédigé (interne).`,
  })),
  demoAdapter('ats', 'list_candidates', ref('jobRef'), 2800, (i) => ({
    summary: `7 candidatures fictives listées pour ${i['jobRef']}, 3 présélectionnées.`,
  })),
  demoAdapter('search', 'search', ref('query'), 2000, (i) => ({
    summary: `5 résultats issus des fixtures pour « ${i['query']} ».`,
  })),
  demoAdapter('drive', 'read_file', ref('fileRef'), 1200, (i) => ({
    summary: `Fichier ${i['fileRef']} lu (fictif).`,
  })),
  {
    // Scénario d'erreur déterministe : l'ERP démo est indisponible (503).
    toolId: 'erp',
    action: 'fetch_invoice',
    kind: 'demo',
    inputSchema: ref('invoiceRef'),
    outputSchema: Summary,
    simulatedLatencyMs: 2200,
    invoke: async () => {
      throw new ToolError('UPSTREAM_503', true, 'ERP démo indisponible (503 simulé)');
    },
    summarize: (o: Summary) => o.summary,
  } as ToolAdapter,
];

export function findAdapter(toolId: string, action: string): ToolAdapter | undefined {
  return DEMO_ADAPTERS.find((a) => a.toolId === toolId && a.action === action);
}
