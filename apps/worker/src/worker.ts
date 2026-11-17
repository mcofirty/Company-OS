import { TaskKindSchema, type TaskKind } from '@company-os/contracts';
import {
  createTask,
  listRunningTasks,
  rollBudgetPeriods,
  runDueSchedules,
  startNextTask,
  type Db,
} from '@company-os/db';
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
    // Erreurs répétées (base non initialisée, coupure) : attente exponentielle bornée à 30 s et
    // journalisation au changement de cause seulement, pour ne pas noyer les logs d'exploitation.
    let failures = 0;
    let lastError = '';
    while (!stopped) {
      try {
        const started = await startNextTask(db, opts.orgId);
        if (failures > 0) log('poll recovered', { afterFailures: failures });
        failures = 0;
        lastError = '';
        if (started) {
          await launcher.launch(started.runId, started.task.id);
          continue;
        }
      } catch (err) {
        failures++;
        const msg = String(err);
        if (msg !== lastError) log('poll error', { err: msg, retryingWithBackoff: true });
        lastError = msg;
      }
      const wait = failures === 0 ? pollMs : Math.min(30_000, pollMs * 2 ** Math.min(failures, 7));
      await new Promise((r) => setTimeout(r, wait));
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

/**
 * Un dispatcher par organisation, y compris celles créées après le démarrage (vérification
 * périodique). L'autopilote n'invente du travail QUE pour les organisations démo : en live,
 * seules les missions demandées par un humain sont exécutées.
 */
export function startOrgDispatchers(
  db: Db,
  launcher: RunLauncher,
  opts: {
    autopilot: { enabled: boolean; intervalMs: number; maxOpenTasks: number };
    log?: (msg: string, extra?: Record<string, unknown>) => void;
    rescanMs?: number;
  },
): { stop: () => Promise<void>; orgIds: () => string[] } {
  const running = new Map<string, { stop: () => Promise<void> }>();
  let stopped = false;
  const scan = async (): Promise<void> => {
    const orgs = await db.organization.findMany({ select: { id: true, mode: true, name: true } });
    for (const org of orgs) {
      if (running.has(org.id) || stopped) continue;
      running.set(
        org.id,
        startDispatcher(db, launcher, {
          orgId: org.id,
          autopilot: { ...opts.autopilot, enabled: opts.autopilot.enabled && org.mode === 'demo' },
          log: (msg, extra) => opts.log?.(msg, { org: org.id, ...extra }),
        }),
      );
      opts.log?.('dispatcher started', { org: org.id, mode: org.mode, name: org.name });
    }
  };
  void scan().catch((err: unknown) => opts.log?.('org scan failed', { err: String(err) }));
  const timer = setInterval(
    () => void scan().catch((err: unknown) => opts.log?.('org scan failed', { err: String(err) })),
    opts.rescanMs ?? 10_000,
  );
  return {
    orgIds: () => [...running.keys()],
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await Promise.all([...running.values()].map((d) => d.stop()));
    },
  };
}

/**
 * Horloge du worker (toutes les 30 s) : missions récurrentes échues et remise à zéro mensuelle
 * des budgets. Les tâches créées sont ensuite prises par les dispatchers habituels.
 */
export function startClock(
  db: Db,
  opts: { intervalMs?: number; log: (msg: string, extra?: Record<string, unknown>) => void },
): { stop: () => Promise<void> } {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await runDueSchedules(db, new Date());
      if (r.triggered + r.skipped > 0) opts.log('schedules', r);
      const rolled = await rollBudgetPeriods(db, new Date());
      if (rolled > 0) opts.log('budgets new period', { rolled });
    } catch (err) {
      opts.log('clock error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 30_000);
  void tick();
  return {
    stop: async () => {
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
  };
}
