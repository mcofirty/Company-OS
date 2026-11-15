import { agentLoop, type LoopOutcome } from '@company-os/agents';
import type { Activities } from './activities';

/**
 * Exécution sans Temporal (tests, CI e2e, `ORCHESTRATOR=inline`) : mêmes Activities,
 * même boucle que le workflow. La reprise après crash repose alors sur l'idempotence
 * des étapes (outils) et sur `finishRun`.
 */
export async function runAgentTaskInline(acts: Activities, runId: string): Promise<LoopOutcome> {
  const prepared = await acts.prepareRun({ runId });
  const outcome = await agentLoop(
    {
      now: () => Date.now(),
      modelStep: (i) => acts.modelStep({ runId, ...i }),
      toolStep: (i) => acts.toolStep({ runId, ...i }),
    },
    { taskMessage: prepared.taskMessage, limits: prepared.limits },
  );
  await acts.finishRun({ runId, outcome });
  return outcome;
}
