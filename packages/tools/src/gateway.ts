import { toolAction, type InvocationView } from '@company-os/contracts';
import {
  completeInvocation,
  hasGrant,
  rejectInvocation,
  requestInvocation,
  startInvocation,
  type Db,
} from '@company-os/db';
import { redactJson, redactText } from '@company-os/policies';
import { findAdapter, ToolError } from './adapters';

export interface GatewayOptions {
  /** Facteur appliqué aux latences simulées (0 en test). */
  latencyScale?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface InvokeRequest {
  orgId: string;
  runId: string;
  agentId: string;
  toolId: string;
  action: string;
  input: Record<string, string>;
  /** Clé logique : la même action d'un même run n'est jamais exécutée deux fois. */
  idempotencyKey: string;
  causationId: string | null;
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
  | { status: 'rejected'; invocation: InvocationView; reasonCode: string; lastEventId: string };

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

  constructor(
    private readonly db: Db,
    opts: GatewayOptions = {},
  ) {
    this.scale = opts.latencyScale ?? 1;
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => new Date());
  }

  async invoke(req: InvokeRequest): Promise<InvokeResult> {
    const spec = toolAction(req.toolId, req.action);
    const adapter = findAdapter(req.toolId, req.action);
    const parsed = adapter?.inputSchema.safeParse(req.input);

    const requested = await requestInvocation(this.db, {
      orgId: req.orgId,
      runId: req.runId,
      toolId: req.toolId,
      action: req.action,
      redactedInput: redactJson(req.input),
      idempotencyKey: req.idempotencyKey,
      causationId: req.causationId,
      now: this.now(),
    });
    let invocation = requested.invocation;
    let lastEventId = requested.eventId ?? req.causationId ?? '';
    if (requested.existing && !['requested', 'authorized', 'running'].includes(invocation.status)) {
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
    if (!(await hasGrant(this.db, req.agentId, req.toolId, req.action)))
      return reject('POLICY_DENIED');
    if (spec.risk === 'high_impact') return reject('POLICY_DENIED');
    // Pas encore de circuit d'approbation (M3) : toute écriture externe est refusée.
    if (spec.risk === 'external_write') return reject('APPROVAL_REQUIRED');
    if (!adapter) return reject('TOOL_UNAVAILABLE');
    if (!parsed?.success) return reject('VALIDATION_ERROR');
    // Échec fermé : en démo, seul un adaptateur démo peut s'exécuter.
    if (org.mode === 'demo' && adapter.kind !== 'demo') return reject('POLICY_DENIED');

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
          adapter.invoke({ mode: org.mode, invocationId: invocation.id, attempt }, parsed.data),
          this.timeoutMs,
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
