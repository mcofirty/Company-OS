import { TaskKindSchema, type TaskKind } from '@company-os/contracts';
import { createTask, listRunningTasks, startNextTask, type Db } from '@company-os/db';
import { ToolGateway, type GatewayOptions } from '@company-os/tools';
import { runDemoTask } from './workflows/demoTask';

export interface WorkerOptions {
  orgId: string;
  concurrency?: number;
  pollMs?: number;
  autopilot?: { enabled: boolean; intervalMs: number; maxOpenTasks: number };
  gateway?: GatewayOptions;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

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

/**
 * Worker de tâches : indépendant du navigateur. Reprend les tâches `running` au démarrage,
 * puis démarre les tâches `queued` (une par agent à la fois), avec concurrence bornée.
 */
export function startWorker(db: Db, opts: WorkerOptions): { stop: () => Promise<void> } {
  const log = opts.log ?? (() => undefined);
  const gateway = new ToolGateway(db, opts.gateway);
  const concurrency = opts.concurrency ?? 4;
  const pollMs = opts.pollMs ?? 300;
  const inflight = new Set<Promise<void>>();
  let stopped = false;

  const track = (p: Promise<void>): void => {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  };
  const execute = (started: Parameters<typeof runDemoTask>[3]): Promise<void> =>
    runDemoTask(db, gateway, opts.orgId, started)
      .then((o) => log('task finished', { taskId: started.task.id, status: o.status }))
      .catch((err: unknown) => log('task error', { taskId: started.task.id, err: String(err) }));

  const loop = async (): Promise<void> => {
    // Reprise après redémarrage : les étapes déjà terminées ne sont pas rejouées.
    for (const t of await listRunningTasks(db, opts.orgId)) {
      const run = t.runs[0];
      if (!run) continue;
      log('resuming task', { taskId: t.id });
      track(
        execute({
          runId: run.id,
          runEventId: run.startEventId,
          task: { id: t.id, kind: t.kind, agentId: t.agentId },
        }),
      );
    }
    while (!stopped) {
      try {
        if (inflight.size < concurrency) {
          const started = await startNextTask(db, opts.orgId);
          if (started) {
            track(
              execute({
                ...started,
                task: {
                  id: started.task.id,
                  kind: started.task.kind,
                  agentId: started.task.agentId,
                },
              }),
            );
            continue;
          }
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
          const kind = TaskKindSchema.parse(pickAutopilotKind(Number(org.lastSeq)));
          await createTask(db, {
            orgId: opts.orgId,
            kind,
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
      await Promise.allSettled([...inflight]);
    },
  };
}
