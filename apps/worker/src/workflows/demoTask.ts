import { DEMO_TASK_CATALOG, TaskKindSchema } from '@company-os/contracts';
import { finishTask, type Db, type StartedTask, type TaskOutcome } from '@company-os/db';
import type { ToolGateway } from '@company-os/tools';

/**
 * Workflow démo borné : 1 étape outil, puis clôture. Les étapes sont idempotentes
 * (clé `run:<runId>:step:1`), ce qui permet de reprendre après un crash sans double effet.
 * Frontière Temporal : cette fonction deviendra un Workflow et `gateway.invoke` une Activity (M2).
 */
export async function runDemoTask(
  db: Db,
  gateway: ToolGateway,
  orgId: string,
  started: Pick<StartedTask, 'runId' | 'runEventId'> & {
    task: { id: string; kind: string; agentId: string };
  },
  now: () => Date = () => new Date(),
): Promise<TaskOutcome> {
  const kind = TaskKindSchema.parse(started.task.kind);
  const spec = DEMO_TASK_CATALOG[kind];
  const result = await gateway.invoke({
    orgId,
    runId: started.runId,
    agentId: started.task.agentId,
    toolId: spec.toolId,
    action: spec.action,
    input: spec.input,
    idempotencyKey: `run:${started.runId}:step:1`,
    causationId: started.runEventId,
  });

  const outcome: TaskOutcome =
    result.status === 'succeeded'
      ? {
          status: 'succeeded',
          resultRef: `artifact://demo/${started.task.id}`,
          safeSummary: result.summary,
        }
      : result.status === 'failed'
        ? {
            status: 'blocked',
            reasonCode: result.errorCode,
            safeSummary: `Outil ${spec.toolId} en échec (${result.errorCode}) après nouvelle tentative. Intervention requise.`,
          }
        : {
            status: 'blocked',
            reasonCode: result.reasonCode,
            safeSummary: `Appel ${spec.toolId}.${spec.action} refusé par la politique (${result.reasonCode}).`,
          };
  await finishTask(db, {
    orgId,
    taskId: started.task.id,
    runId: started.runId,
    causationId: result.lastEventId || null,
    outcome,
    now: now(),
  });
  return outcome;
}
