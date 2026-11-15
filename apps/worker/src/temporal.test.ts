import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Connection } from '@temporalio/client';
import type { Worker } from '@temporalio/worker';
import { createTask, DEMO_ORG, listEventsByCorrelation, startNextTask } from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { createTemporalWorker } from './temporal';

/**
 * Intégration avec un vrai serveur Temporal (docker compose : service `temporal`, ou
 * `docker run temporalio/temporal server start-dev` en CI). Pas de saut silencieux :
 * si le serveur est absent, le test échoue avec un message explicite.
 */
const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const db = testDb();
const taskQueue = `test-${randomUUID()}`;
let worker: Worker;
let running: Promise<void>;
let client: Client;
let connection: Connection;

beforeAll(async () => {
  await resetAndSeed(db);
  connection = await Connection.connect({ address, connectTimeout: '5s' }).catch((e: unknown) => {
    throw new Error(
      `Serveur Temporal injoignable sur ${address} (docker compose up -d) : ${String(e)}`,
    );
  });
  client = new Client({ connection });
  worker = await createTemporalWorker(
    address,
    createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: null,
    }),
    { taskQueue },
  );
  running = worker.run();
}, 60_000);

afterAll(async () => {
  worker?.shutdown();
  await running;
  await connection?.close();
  await db.$disconnect();
});

describe('workflow Temporal agentTask', () => {
  it('exécute une tâche démo de bout en bout et un second démarrage est refusé (idempotence)', async () => {
    const { task } = await createTask(db, {
      orgId: DEMO_ORG.id,
      kind: 'qualify_lead',
      requester: { kind: 'user', id: 'test' },
    });
    const started = (await startNextTask(db, DEMO_ORG.id))!;
    const workflowId = `agent-task-${task.id}`;
    const handle = await client.workflow.start('agentTaskWorkflow', {
      taskQueue,
      workflowId,
      args: [{ runId: started.runId }],
    });
    await expect(
      client.workflow.start('agentTaskWorkflow', {
        taskQueue,
        workflowId,
        args: [{ runId: started.runId }],
      }),
    ).rejects.toThrow();
    const outcome = (await handle.result()) as { status: string };
    expect(outcome.status).toBe('succeeded');
    const types = (await listEventsByCorrelation(db, DEMO_ORG.id, task.correlationId)).map(
      (e) => e.type,
    );
    expect(types.at(-1)).toBe('task.completed');
    expect(types.filter((t) => t === 'tool.invocation.succeeded')).toHaveLength(1);
    const history = await handle.fetchHistory();
    const activities = (history.events ?? []).filter(
      (e) => e.activityTaskScheduledEventAttributes,
    ).length;
    expect(activities).toBeGreaterThanOrEqual(4); // prepareRun, modelStep×2, toolStep, finishRun
  }, 60_000);
});

describe('validation humaine via signal Temporal', () => {
  it('le workflow attend durablement puis reprend au signal approvalDecided', async () => {
    const { decideApproval } = await import('@company-os/db');
    const { task } = await createTask(db, {
      orgId: DEMO_ORG.id,
      kind: 'send_followup',
      agentId: 'sdr-01',
      requester: { kind: 'user', id: 'test' },
    });
    const started = (await startNextTask(db, DEMO_ORG.id))!;
    const handle = await client.workflow.start('agentTaskWorkflow', {
      taskQueue,
      workflowId: `agent-task-${task.id}`,
      args: [{ runId: started.runId }],
    });
    await expect
      .poll(() => db.approvalRequest.count({ where: { taskId: task.id, status: 'pending' } }), {
        timeout: 15_000,
      })
      .toBe(1);
    const a = await db.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    await decideApproval(db, {
      orgId: DEMO_ORG.id,
      approvalId: a.id,
      decision: 'approved',
      reviewer: { kind: 'user', id: 'test-admin' },
      reason: 'ok',
    });
    await handle.signal('approvalDecided', { approvalId: a.id, decision: 'approved' });
    const outcome = (await handle.result()) as { status: string };
    expect(outcome.status).toBe('succeeded');
    const inv = await db.toolInvocation.findFirstOrThrow({ where: { taskId: task.id } });
    expect(inv.status).toBe('succeeded');
  }, 60_000);
});
