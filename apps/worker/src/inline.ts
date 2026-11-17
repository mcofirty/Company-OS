import { agentLoop, type LoopOutcome } from '@company-os/agents';
import type { Activities } from './activities';

/**
 * Exécution sans Temporal (tests, CI e2e, `ORCHESTRATOR=inline`) : mêmes Activities,
 * même boucle que le workflow. La reprise après crash repose alors sur l'idempotence
 * des étapes (outils) et sur `finishRun`.
 */
export async function runAgentTaskInline(
  acts: Activities,
  runId: string,
  pollMs = 300,
): Promise<LoopOutcome> {
  const prepared = await acts.prepareRun({ runId });
  const outcome = await agentLoop(
    {
      now: () => Date.now(),
      modelStep: (i) => acts.modelStep({ runId, ...i }),
      toolStep: (i) => acts.toolStep({ runId, ...i }),
      waitForTasks: async ({ taskIds }) => {
        const deadline = Date.now() + 4 * 3600_000;
        for (;;) {
          const r = await acts.checkTasks({ runId, taskIds });
          if (r.done || Date.now() > deadline) return r.content;
          await new Promise((res) => setTimeout(res, pollMs * 10));
        }
      },
      waitForApproval: async ({ approvalId }) => {
        for (;;) {
          const status = await acts.checkApproval({ approvalId });
          if (status === 'approved' || status === 'rejected' || status === 'expired') return status;
          const after = await acts.expireApproval({ approvalId });
          if (after === 'expired') return after;
          await new Promise((r) => setTimeout(r, pollMs));
        }
      },
    },
    { taskMessage: prepared.taskMessage, limits: prepared.limits },
  );
  await acts.finishRun({ runId, outcome });
  return outcome;
}
