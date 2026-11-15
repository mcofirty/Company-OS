import { fileURLToPath } from 'node:url';
import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import type { Activities } from './activities';
import type { RunLauncher } from './worker';

export const TASK_QUEUE = 'agent-tasks';
export const workflowIdFor = (taskId: string): string => `agent-task-${taskId}`;

/** Worker Temporal : exécute le workflow agentTask et ses activities. */
export async function createTemporalWorker(
  address: string,
  activities: Activities,
  opts: { namespace?: string; taskQueue?: string } = {},
): Promise<Worker> {
  const connection = await NativeConnection.connect({ address });
  return Worker.create({
    connection,
    namespace: opts.namespace ?? 'default',
    taskQueue: opts.taskQueue ?? TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows/agentTask.ts', import.meta.url)),
    activities,
  });
}

/** Lanceur Temporal : workflowId = tâche, donc un démarrage répété est sans effet. */
export async function temporalLauncher(
  address: string,
  log: (m: string, x?: Record<string, unknown>) => void,
  namespace = 'default',
): Promise<RunLauncher & { client: Client }> {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  return {
    client,
    async launch(runId, taskId) {
      try {
        await client.workflow.start('agentTaskWorkflow', {
          taskQueue: TASK_QUEUE,
          workflowId: workflowIdFor(taskId),
          args: [{ runId }],
          workflowExecutionTimeout: '10 minutes',
        });
        log('workflow started', { taskId, runId });
      } catch (err) {
        if (err instanceof WorkflowExecutionAlreadyStartedError) return;
        throw err;
      }
    },
    async stop() {
      await connection.close();
    },
  };
}
