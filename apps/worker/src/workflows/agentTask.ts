import { condition, defineSignal, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import { agentLoop, type ApprovalDecision, type LoopOutcome } from '@company-os/agents/loop';
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

const { checkApproval, expireApproval, checkTasks } = proxyActivities<Activities>({
  startToCloseTimeout: '15 seconds',
  retry: { maximumAttempts: 5 },
});

/** Signal envoyé par l'API quand un humain décide (docs/05 §5 : reprise par signal). */
export const approvalDecidedSignal =
  defineSignal<[{ approvalId: string; decision: ApprovalDecision }]>('approvalDecided');

const isDecision = (s: string): s is ApprovalDecision =>
  s === 'approved' || s === 'rejected' || s === 'expired';

export async function agentTaskWorkflow(input: { runId: string }): Promise<LoopOutcome> {
  const decisions = new Map<string, ApprovalDecision>();
  setHandler(approvalDecidedSignal, ({ approvalId, decision }) => {
    decisions.set(approvalId, decision);
  });
  const waitForApproval = async ({
    approvalId,
  }: {
    approvalId: string;
  }): Promise<ApprovalDecision> => {
    for (;;) {
      // Attente durable du signal ; vérification périodique en base si le signal s'est perdu.
      if (await condition(() => decisions.has(approvalId), '20 seconds'))
        return decisions.get(approvalId)!;
      const status = await checkApproval({ approvalId });
      if (isDecision(status)) return status;
      const after = await expireApproval({ approvalId });
      if (isDecision(after)) return after;
    }
  };
  const prepared = await prepareRun(input);
  const outcome = await agentLoop(
    {
      now: () => Date.now(), // horloge déterministe dans un workflow Temporal
      modelStep: (i) => modelStep({ runId: input.runId, ...i }),
      toolStep: (i) => toolStep({ runId: input.runId, ...i }),
      waitForApproval,
      // Attente durable des missions déléguées (4 h max) : aucun appel modèle pendant l'attente.
      waitForTasks: async ({ taskIds }) => {
        const deadline = Date.now() + 4 * 3600_000;
        for (;;) {
          const r = await checkTasks({ runId: input.runId, taskIds });
          if (r.done || Date.now() > deadline) return r.content;
          await sleep('30 seconds');
        }
      },
    },
    { taskMessage: prepared.taskMessage, limits: prepared.limits },
  );
  await finishRun({ runId: input.runId, outcome });
  return outcome;
}
