import {
  toolAction,
  type InvocationView,
  type ToolActionKind,
  type ToolRisk,
} from '@company-os/contracts';
import {
  completeInvocation,
  connectorForCall,
  isConnectorToolId,
  invocationView,
  requestInvocationApproval,
  hasGrant,
  rejectInvocation,
  requestInvocation,
  startInvocation,
  type Db,
} from '@company-os/db';
import { openSecret, redactJson, redactText, withSpan } from '@company-os/policies';
import { z } from 'zod';
import { findAdapter, ToolError, type ToolAdapter } from './adapters';
import { callMcpTool } from './mcp';
import { findPlatformAdapter } from './platform';

export interface GatewayOptions {
  /** Facteur appliqué aux latences simulées (0 en test). */
  latencyScale?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Clé de déchiffrement des jetons de connecteurs (CONNECTOR_SECRET_KEY). */
  connectorKey?: Buffer | null;
  /** Autorise les serveurs MCP en http:// ou sur réseau privé (tests, réseau interne voulu). */
  allowPrivateNetwork?: boolean;
}

type Connector = NonNullable<Awaited<ReturnType<typeof connectorForCall>>>;
const McpOutput = z.object({
  summary: z.string().max(300),
  data: z.object({ text: z.string(), truncated: z.boolean(), isError: z.boolean() }),
});
type McpOutput = z.infer<typeof McpOutput>;

/** Prévisualisation sûre (validation humaine) : valeurs rédigées, aplaties et tronquées. */
const previewOf = (input: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(redactJson(input))
      .slice(0, 20)
      .map(([k, v]) => [k, (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 300)]),
  );
/** Entrée stockée dans le journal : primitives seulement (objets sérialisés, tronqués). */
const storedInput = (input: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(redactJson(input))
      .slice(0, 30)
      .map(([k, v]) => [
        k,
        v === null || ['string', 'number', 'boolean'].includes(typeof v)
          ? (v as string | number | boolean | null)
          : JSON.stringify(v).slice(0, 1000),
      ]),
  );

export interface InvokeRequest {
  orgId: string;
  runId: string;
  agentId: string;
  toolId: string;
  action: string;
  /** Champs texte pour le catalogue ; JSON libre pour un connecteur MCP (validé par son schéma). */
  input: Record<string, unknown>;
  /** Clé logique : la même action d'un même run n'est jamais exécutée deux fois. */
  idempotencyKey: string;
  causationId: string | null;
  /** Reprise après validation humaine d'une action externe. */
  approvalId?: string;
}

export type InvokeResult =
  | {
      status: 'succeeded';
      invocation: InvocationView;
      summary: string;
      output: unknown;
      lastEventId: string;
    }
  | { status: 'failed'; invocation: InvocationView; errorCode: string; lastEventId: string }
  | { status: 'rejected'; invocation: InvocationView; reasonCode: string; lastEventId: string }
  | {
      status: 'waiting_approval';
      invocation: InvocationView;
      approvalId: string;
      lastEventId: string;
    };

/**
 * Point de passage unique de tous les appels d'outils (docs/05 §2) : validation Zod,
 * autorisation explicite, politique de risque, mode, kill switch, timeout, retries,
 * persistance de chaque transition (donc visible dans le cockpit).
 */
export class ToolGateway {
  private readonly scale: number;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly connectorKey: Buffer | null;
  private readonly allowPrivateNetwork: boolean;

  constructor(
    private readonly db: Db,
    opts: GatewayOptions = {},
  ) {
    this.scale = opts.latencyScale ?? 1;
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => new Date());
    this.connectorKey = opts.connectorKey ?? null;
    this.allowPrivateNetwork = opts.allowPrivateNetwork ?? false;
  }

  /** Adaptateur d'un outil de connecteur : appel MCP réel, jeton déchiffré le temps de l'appel. */
  private mcpAdapter(c: Connector): ToolAdapter<Record<string, unknown>, McpOutput> {
    return {
      toolId: 'mcp',
      action: c.remoteName,
      kind: 'live',
      inputSchema: z.record(z.string(), z.unknown()),
      outputSchema: McpOutput,
      simulatedLatencyMs: 0,
      invoke: async (_ctx, input) => {
        const headers: Record<string, string> = {};
        if (c.secretSealed) {
          if (!this.connectorKey) {
            throw new ToolError(
              'CONNECTOR_SECRET_UNAVAILABLE',
              false,
              'Clé de déchiffrement absente',
            );
          }
          const token = openSecret(c.secretSealed, this.connectorKey);
          if (c.authHeader === 'authorization') headers['Authorization'] = `Bearer ${token}`;
          else headers[c.authHeader] = token;
        }
        try {
          const r = await callMcpTool(
            {
              url: c.url,
              headers,
              allowPrivateNetwork: this.allowPrivateNetwork,
              timeoutMs: 30_000,
            },
            c.remoteName,
            input,
          );
          const head = r.isError ? 'Erreur renvoyée par' : 'Réponse de';
          return {
            summary:
              `${head} ${c.name} · ${c.remoteName} (${r.text.length} car.${r.truncated ? ', tronqué' : ''})`.slice(
                0,
                300,
              ),
            data: r,
          };
        } catch (err) {
          const te =
            err instanceof ToolError ? err : new ToolError('ADAPTER_ERROR', false, 'Erreur');
          // Écriture possible côté distant : jamais de nouvelle tentative automatique.
          throw new ToolError(te.code, c.policy === 'read' && te.retryable, te.message);
        }
      },
      summarize: (o) => o.summary,
    };
  }

  /** Span `tool.invoke` (docs/10 §2) : identifiants et statut seulement, jamais les arguments. */
  async invoke(req: InvokeRequest): Promise<InvokeResult> {
    return withSpan(
      'tool.invoke',
      {
        'org.id': req.orgId,
        'run.id': req.runId,
        'agent.id': req.agentId,
        'tool.id': req.toolId,
        'tool.action': req.action,
        'tool.risk': toolAction(req.toolId, req.action)?.risk ?? 'unknown',
      },
      async (span) => {
        const r = await this.invokeInner(req);
        span.set({
          'tool.status': r.status,
          'tool.invocation_id': r.invocation.id,
          'tool.attempts': r.invocation.attempt,
          'tool.reason_code':
            r.status === 'rejected'
              ? r.reasonCode
              : r.status === 'failed'
                ? r.errorCode
                : undefined,
        });
        if (r.status === 'failed' || r.status === 'rejected') {
          span.fail(r.status === 'failed' ? r.errorCode : r.reasonCode);
        }
        return r;
      },
    );
  }

  private async invokeInner(req: InvokeRequest): Promise<InvokeResult> {
    // Connecteur MCP : action, nature et risque résolus en base (politique choisie par l'admin).
    const isConnector = isConnectorToolId(req.toolId);
    const connector = isConnector
      ? await connectorForCall(this.db, req.orgId, req.toolId, req.action)
      : null;
    const known =
      isConnector && !connector
        ? await this.db.tool.findUnique({ where: { id: req.toolId } })
        : null;
    const spec: { kind: ToolActionKind; risk: ToolRisk; label: string } | undefined = connector
      ? {
          kind: connector.readOnlyHint ? 'read' : 'execute',
          risk: connector.policy === 'read' ? 'read' : 'external_write',
          label: `${connector.name} · ${connector.remoteName}`,
        }
      : known
        ? { kind: 'execute', risk: 'external_write', label: req.action } // retiré/inconnu : refusé
        : toolAction(req.toolId, req.action);
    const platform = isConnector ? undefined : findPlatformAdapter(req.toolId, req.action);
    const adapter =
      platform ??
      (connector
        ? (this.mcpAdapter(connector) as ToolAdapter)
        : isConnector
          ? undefined
          : findAdapter(req.toolId, req.action));
    const parsed = adapter?.inputSchema.safeParse(req.input);

    const requested = await requestInvocation(this.db, {
      orgId: req.orgId,
      runId: req.runId,
      toolId: req.toolId,
      action: req.action,
      redactedInput: storedInput(req.input),
      idempotencyKey: req.idempotencyKey,
      causationId: req.causationId,
      now: this.now(),
      ...(isConnector && spec ? { spec: { kind: spec.kind, risk: spec.risk } } : {}),
    });
    let invocation = requested.invocation;
    let lastEventId = requested.eventId ?? req.causationId ?? '';
    if (
      requested.existing &&
      !['requested', 'authorized', 'running', 'waiting_approval'].includes(invocation.status)
    ) {
      // Déjà terminée (reprise après crash) : on ne ré-exécute pas.
      return this.fromTerminal(invocation, lastEventId);
    }

    const reject = async (reasonCode: string): Promise<InvokeResult> => {
      const r = await rejectInvocation(this.db, {
        orgId: req.orgId,
        invocationId: invocation.id,
        reasonCode,
        causationId: lastEventId || null,
        now: this.now(),
      });
      return { status: 'rejected', invocation: r.invocation, reasonCode, lastEventId: r.eventId };
    };

    // ---- Politique (réévaluée à chaque invocation) ----
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: req.orgId } });
    if (org.killSwitch) return reject('KILL_SWITCH');
    if (!spec) return reject('TOOL_UNAVAILABLE');
    if (isConnector && (!connector || connector.policy === 'disabled')) {
      return reject(connector ? 'POLICY_DENIED' : 'TOOL_UNAVAILABLE');
    }
    if (!(await hasGrant(this.db, req.agentId, req.toolId, req.action)))
      return reject('POLICY_DENIED');
    if (spec.risk === 'high_impact') return reject('POLICY_DENIED');
    if (!adapter) return reject('TOOL_UNAVAILABLE');
    if (!parsed?.success) return reject('VALIDATION_ERROR');
    // Écriture externe : validation humaine obligatoire avant toute exécution (docs/05 §3).
    if (spec.risk === 'external_write') {
      const pending = await this.db.approvalRequest.findUnique({
        where: { invocationId: invocation.id },
      });
      if (!pending) {
        const r = await requestInvocationApproval(this.db, {
          orgId: req.orgId,
          invocationId: invocation.id,
          riskReason: `Action externe « ${spec.label} » (${req.toolId}.${req.action}) : validation humaine requise.`,
          safePreview: {
            tool: req.toolId,
            action: req.action,
            ...previewOf(req.input),
            mode:
              org.mode === 'demo'
                ? 'démo : envoi simulé'
                : connector
                  ? `live : action RÉELLE sur ${connector.name}`
                  : 'live',
          },
          causationId: lastEventId || null,
          now: this.now(),
        });
        const inv = await this.db.toolInvocation.findUniqueOrThrow({
          where: { id: invocation.id },
        });
        return {
          status: 'waiting_approval',
          invocation: invocationView(inv),
          approvalId: r.approval.id,
          lastEventId: r.eventId ?? lastEventId,
        };
      }
      if (pending.status === 'pending' || req.approvalId !== pending.id) {
        return { status: 'waiting_approval', invocation, approvalId: pending.id, lastEventId };
      }
      // Revérification au moment de l'exécution (TOCTOU) : grant, kill switch et mode
      // viennent d'être réévalués ci-dessus ; la décision doit être « approved ».
      if (pending.status !== 'approved') return reject('APPROVAL_REJECTED');
    }
    // Échec fermé : en démo, seul un adaptateur démo peut s'exécuter.
    if (org.mode === 'demo' && adapter.kind === 'live') return reject('POLICY_DENIED');
    // Aucune donnée fictive dans une organisation live (sauf autorisation explicite : tests).
    if (org.mode === 'live' && adapter.kind === 'demo' && !org.allowDemoTools) {
      return reject('DEMO_TOOL_DISABLED');
    }

    // ---- Exécution avec retries bornés ----
    for (let attempt = invocation.attempt; attempt <= this.maxAttempts; attempt++) {
      const started = await startInvocation(this.db, {
        orgId: req.orgId,
        invocationId: invocation.id,
        attempt,
        causationId: lastEventId || null,
        now: this.now(),
      });
      invocation = started.invocation;
      lastEventId = started.eventId;
      try {
        await this.sleep(Math.round(adapter.simulatedLatencyMs * this.scale));
        const output = await withTimeout(
          platform
            ? platform.invoke(
                {
                  db: this.db,
                  orgId: req.orgId,
                  runId: req.runId,
                  agentId: req.agentId,
                  taskId: invocation.taskId,
                  invocationId: invocation.id,
                  correlationId: invocation.correlationId,
                  causationId: lastEventId || null,
                  mode: org.mode,
                  sleep: this.sleep,
                  latencyScale: this.scale,
                },
                parsed.data as Record<string, string>,
              )
            : (adapter as ToolAdapter).invoke(
                { mode: org.mode, invocationId: invocation.id, attempt },
                parsed.data,
              ),
          platform ? this.timeoutMs + 20_000 : connector ? 35_000 : this.timeoutMs,
        );
        const parsedOut = adapter.outputSchema.parse(output);
        // Rédaction avant tout stockage (UI/logs) et avant renvoi au modèle.
        const summary = redactText(adapter.summarize(parsedOut));
        const safeOutput = redactJson(parsedOut);
        const done = await completeInvocation(this.db, {
          orgId: req.orgId,
          invocationId: invocation.id,
          causationId: lastEventId,
          ok: true,
          safeSummary: summary,
          now: this.now(),
        });
        return {
          status: 'succeeded',
          invocation: done.invocation,
          summary,
          output: safeOutput,
          lastEventId: done.eventId,
        };
      } catch (err) {
        const te =
          err instanceof ToolError
            ? err
            : new ToolError('ADAPTER_ERROR', false, 'Erreur adaptateur');
        if (te.retryable && attempt < this.maxAttempts) {
          await this.sleep(Math.round(400 * attempt * this.scale)); // backoff
          continue;
        }
        const failed = await completeInvocation(this.db, {
          orgId: req.orgId,
          invocationId: invocation.id,
          causationId: lastEventId,
          ok: false,
          errorCode: te.code,
          attempt,
          now: this.now(),
        });
        return {
          status: 'failed',
          invocation: failed.invocation,
          errorCode: te.code,
          lastEventId: failed.eventId,
        };
      }
    }
    throw new Error('unreachable');
  }

  private fromTerminal(inv: InvocationView, lastEventId: string): InvokeResult {
    if (inv.status === 'succeeded')
      return {
        status: 'succeeded',
        invocation: inv,
        summary: inv.safeSummary ?? '',
        output: { summary: inv.safeSummary ?? '' },
        lastEventId,
      };
    if (inv.status === 'rejected')
      return {
        status: 'rejected',
        invocation: inv,
        reasonCode: inv.errorCode ?? 'REJECTED',
        lastEventId,
      };
    return { status: 'failed', invocation: inv, errorCode: inv.errorCode ?? 'FAILED', lastEventId };
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolError('TIMEOUT', true, 'Délai dépassé')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
