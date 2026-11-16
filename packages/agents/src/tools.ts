import { z } from 'zod';
import { toolAction, toolById } from '@company-os/contracts';
import type { LlmToolDef } from './types';

export const SUBMIT_RESULT = 'submit_result';
const SEP = '__';

export const toolName = (toolId: string, action: string): string => `${toolId}${SEP}${action}`;
export function parseToolName(name: string): { toolId: string; action: string } | null {
  const i = name.indexOf(SEP);
  if (i <= 0) return null;
  return { toolId: name.slice(0, i), action: name.slice(i + SEP.length) };
}

/** Résultat structuré attendu de l'agent (docs/13 §8). */
export const AgentResultSchema = z
  .object({
    status: z.enum(['completed', 'blocked', 'needs_approval', 'failed']),
    summary: z.string().min(1).max(3000),
    verifiedFacts: z
      .array(z.object({ claim: z.string().max(500), sourceRef: z.string().max(200) }).strict())
      .max(20),
    followUpTasks: z
      .array(
        z.object({ title: z.string().max(200), assigneeCapability: z.string().max(100) }).strict(),
      )
      .max(5),
    uncertainty: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type AgentResult = z.infer<typeof AgentResultSchema>;

const submitResultDef: LlmToolDef = {
  name: SUBMIT_RESULT,
  description:
    'Termine la mission avec un résultat structuré. À appeler exactement une fois, à la fin.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'blocked', 'needs_approval', 'failed'] },
      summary: { type: 'string', description: 'Résumé factuel (pas de raisonnement interne).' },
      verifiedFacts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { claim: { type: 'string' }, sourceRef: { type: 'string' } },
          required: ['claim', 'sourceRef'],
          additionalProperties: false,
        },
      },
      followUpTasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, assigneeCapability: { type: 'string' } },
          required: ['title', 'assigneeCapability'],
          additionalProperties: false,
        },
      },
      uncertainty: { type: 'array', items: { type: 'string' } },
    },
    required: ['status', 'summary', 'verifiedFacts', 'followUpTasks', 'uncertainty'],
    additionalProperties: false,
  },
};

/**
 * Outils exposés au modèle : uniquement les actions explicitement autorisées à l'agent.
 * (La gateway revérifie de toute façon chaque appel.)
 */
export function buildToolDefs(
  grants: { toolId: string; actions: string[] }[],
  /** Outils de connecteurs MCP accordés (schéma fourni par le serveur, validé par lui). */
  connectorTools: ConnectorToolDefInput[] = [],
): LlmToolDef[] {
  const defs: LlmToolDef[] = [];
  for (const g of [...grants].sort((a, b) => a.toolId.localeCompare(b.toolId))) {
    for (const action of [...g.actions].sort()) {
      const spec = toolAction(g.toolId, action);
      // Outils exécutés côté serveur par Anthropic (web) : déclarés autrement par le fournisseur.
      if (!spec || toolById(g.toolId)?.serverSide) continue;
      const fields = [spec.input, ...(spec.moreInputs ?? [])];
      defs.push({
        name: toolName(g.toolId, action),
        description: `${spec.label} (outil ${g.toolId}, risque ${spec.risk}).`,
        input_schema: {
          type: 'object',
          properties: Object.fromEntries(
            fields.map((f) => [f.field, { type: 'string', description: f.description }]),
          ),
          required: fields.map((f) => f.field),
          additionalProperties: false,
        },
      });
    }
  }
  for (const t of [...connectorTools].sort((a, b) =>
    toolName(a.toolId, a.action).localeCompare(toolName(b.toolId, b.action)),
  )) {
    const schema = t.inputSchema;
    defs.push({
      name: toolName(t.toolId, t.action),
      description:
        `[Connecteur ${t.connectorName}${t.policy === 'read' ? '' : ' · chaque appel exige une validation humaine'}] ${t.description}`.slice(
          0,
          1024,
        ),
      input_schema: {
        type: 'object',
        properties:
          schema['properties'] && typeof schema['properties'] === 'object'
            ? (schema['properties'] as Record<string, unknown>)
            : {},
        required: Array.isArray(schema['required'])
          ? (schema['required'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
        additionalProperties: false,
      },
    });
  }
  defs.push(submitResultDef);
  return defs;
}

export interface ConnectorToolDefInput {
  toolId: string;
  action: string;
  connectorName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  policy: 'read' | 'approval' | 'disabled';
}
