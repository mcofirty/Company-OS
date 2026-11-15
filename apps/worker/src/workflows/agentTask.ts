import { proxyActivities } from '@temporalio/workflow';
import { agentLoop, type LoopOutcome } from '@company-os/agents/loop';
import type { Activities } from '../activities';

/**
 * Workflow Temporal d'une tâche d'agent (docs/02 §5) : la boucle bornée est déterministe,
 * toutes les E/S (modèle, outils, base) sont des Activities avec timeouts et retries.
 * Aucune modification irréversible n'est faite directement depuis ce code.
 */
// Timeouts courts pour les activités brèves : si un worker meurt en plein appel, Temporal
// relance l'activité sur un autre worker après ce délai (reprise rapide, sans double effet).
const { prepareRun, finishRun } = proxyActivities<Activities>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 5, initialInterval: '1 second' },
});
const { modelStep } = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3, initialInterval: '2 seconds', backoffCoefficient: 2 },
});
const { toolStep } = proxyActivities<Activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3, initialInterval: '1 second' },
});

export async function agentTaskWorkflow(input: { runId: string }): Promise<LoopOutcome> {
  const prepared = await prepareRun(input);
  const outcome = await agentLoop(
    {
      now: () => Date.now(), // horloge déterministe dans un workflow Temporal
      modelStep: (i) => modelStep({ runId: input.runId, ...i }),
      toolStep: (i) => toolStep({ runId: input.runId, ...i }),
    },
    { taskMessage: prepared.taskMessage, limits: prepared.limits },
  );
  await finishRun({ runId: input.runId, outcome });
  return outcome;
}
