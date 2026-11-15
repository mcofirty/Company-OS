import { TaskKindSchema, type TaskKind } from '@company-os/contracts';
import { createTask, listRunningTasks, startNextTask, type Db } from '@company-os/db';
import type { Activities } from './activities';
import { runAgentTaskInline } from './inline';

/** PRNG déterministe (mulberry32) : l'autopilote démo est reproductible pour un même historique. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pondération de l'autopilote : le scénario d'erreur ERP reste rare. */
const AUTOPILOT_WEIGHTS: [TaskKind, number][] = [
  ['qualify_lead', 4],
  ['draft_campaign', 2],
  ['screen_candidates', 2],
  ['answer_ticket', 2],
  ['forecast_cashflow', 2],
  ['weekly_review', 1],
  ['check_invoice', 1],
];
export function pickAutopilotKind(seed: number): TaskKind {
  const r = prng(seed)();
  const total = AUTOPILOT_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [k, w] of AUTOPILOT_WEIGHTS) {
    acc += w / total;
    if (r < acc) return k;
  }
  return 'qualify_lead';
}

/** Lance l'exécution d'un run : workflow Temporal (durable) ou exécution inline. */
export interface RunLauncher {
  /** Idempotent : relancer un run déjà démarré ne crée pas de seconde exécution. */
  launch(runId: string, taskId: string): Promise<void>;
  stop(): Promise<void>;
}

export function inlineLauncher(
  acts: Activities,
  log: (m: string, x?: Record<string, unknown>) => void,
): RunLauncher {
  const inflight = new Map<string, Promise<void>>();
  return {
    async launch(runId) {
      if (inflight.has(runId)) return;
      const p = runAgentTaskInline(acts, runId)
        .then((o) => log('run finished', { runId, status: o.status }))
        .catch((err: unknown) => log('run error', { runId, err: String(err) }))
        .finally(() => inflight.delete(runId));
      inflight.set(runId, p);
    },
    async stop() {
      await Promise.allSettled([...inflight.values()]);
    },
  };
}

export interface DispatcherOptions {
  orgId: string;
  pollMs?: number;
  autopilot?: { enabled: boolean; intervalMs: number; maxOpenTasks: number };
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/**
 * Dispatcher : démarre les tâches `queued` (une par agent) et confie chaque run au lanceur.
 * Indépendant du navigateur. Au démarrage, relance les runs `running` (idempotent).
 */
export function startDispatcher(
  db: Db,
  launcher: RunLauncher,
  opts: DispatcherOptions,
): { stop: () => Promise<void> } {
  const log = opts.log ?? (() => undefined);
  const pollMs = opts.pollMs ?? 300;
  let stopped = false;

  const loop = async (): Promise<void> => {
    for (const t of await listRunningTasks(db, opts.orgId)) {
      const run = t.runs[0];
      if (run) {
        log('resuming run', { runId: run.id, taskId: t.id });
        await launcher.launch(run.id, t.id);
      }
    }
    while (!stopped) {
      try {
        const started = await startNextTask(db, opts.orgId);
        if (started) {
          await launcher.launch(started.runId, started.task.id);
          continue;
        }
      } catch (err) {
        log('poll error', { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };

  let autopilotTimer: NodeJS.Timeout | undefined;
  if (opts.autopilot?.enabled) {
    const ap = opts.autopilot;
    autopilotTimer = setInterval(() => {
      void (async () => {
        try {
          const org = await db.organization.findUniqueOrThrow({ where: { id: opts.orgId } });
          if (org.mode !== 'demo' || org.killSwitch) return;
          const open = await db.task.count({
            where: { orgId: opts.orgId, status: { in: ['queued', 'running'] } },
          });
          if (open >= ap.maxOpenTasks) return;
          await createTask(db, {
            orgId: opts.orgId,
            kind: TaskKindSchema.parse(pickAutopilotKind(Number(org.lastSeq))),
            requester: { kind: 'system', id: 'demo-autopilot' },
            idempotencyKey: `autopilot:${org.lastSeq}`,
          });
        } catch (err) {
          log('autopilot error', { err: String(err) });
        }
      })();
    }, ap.intervalMs);
  }

  const done = loop();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(autopilotTimer);
      await done;
      await launcher.stop();
    },
  };
}
