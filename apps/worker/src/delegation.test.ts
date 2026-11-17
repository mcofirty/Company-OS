import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider, SUBMIT_RESULT, type LlmContentBlock } from '@company-os/agents';
import {
  createAgentByAdmin,
  createFollowUp,
  createTask,
  DEV_ADMIN,
  initLiveOrg,
  saveDocument,
  startNextTask,
  updateReporting,
} from '@company-os/db';
import { loadPricing } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';

const db = testDb();
const admin = { kind: 'user', id: DEV_ADMIN.id } as const;
let orgId = '';
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
});
afterAll(() => db.$disconnect());

const hire = (name: string, role: 'manager' | 'specialist', grants: Record<string, string[]>) =>
  createAgentByAdmin(db, {
    orgId,
    actor: admin,
    req: {
      name,
      title: role === 'manager' ? 'Directrice' : 'Analyste',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      role,
      grants,
      goal: 'Piloter',
      instructions: 'Être factuel et concis dans chaque rapport.',
      monthlyBudgetUsd: 2,
      modelTier: 'quality',
      avatarId: 'avatar-01',
      skills: [],
      routines: [],
    },
  });
const use = (id: string, name: string, input: Record<string, unknown>): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const submit = (summary: string) =>
  use('s', SUBMIT_RESULT, {
    status: 'completed',
    summary,
    verifiedFacts: [],
    followUpTasks: [],
    uncertainty: [],
  });
const acts = (llm: MockProvider) =>
  createActivities({
    db,
    gateway: new ToolGateway(db, { latencyScale: 0 }),
    pricing: loadPricing(),
    liveProvider: llm,
  });

describe('Délégation, mémoire, suite de mission', () => {
  it('le manager délègue, ATTEND le résultat de son subordonné, puis fait la synthèse', async () => {
    const { agentId: boss } = await hire('Iris', 'manager', { team: ['assign', 'wait'] });
    const { agentId: sub } = await hire('Hugo', 'specialist', { company: ['status'] });
    await updateReporting(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      agentId: sub,
      managerId: boss,
      role: 'specialist',
    });
    await createTask(db, {
      orgId,
      kind: 'custom',
      agentId: boss,
      mission: {
        title: 'Rapport consolidé',
        instructions: 'Fais faire l’analyse puis synthétise.',
      },
      requester: admin,
    });
    const bossRun = (await startNextTask(db, orgId))!.runId;
    const bossLlm = new MockProvider([
      () => ({
        content: [
          use('a', 'team__assign', {
            assigneeAgentId: sub,
            title: 'Analyse des ventes',
            instructions: 'Analyse les ventes de la semaine et donne trois chiffres clés.',
          }),
        ],
      }),
      () => ({ content: [use('w', 'team__wait', { taskIds: 'toutes' })] }),
      () => ({ content: [submit('Synthèse : ventes en hausse de 12 %.')] }),
    ]);
    const bossDone = runAgentTaskInline(acts(bossLlm), bossRun, 20);

    // Pendant que la manager attend : le subordonné reçoit et termine sa mission.
    let subTask = null;
    for (let i = 0; i < 100 && !subTask; i++) {
      subTask = await db.task.findFirst({ where: { orgId, agentId: sub } });
      if (!subTask) await new Promise((r) => setTimeout(r, 50));
    }
    expect(subTask).not.toBeNull();
    const subRun = (await startNextTask(db, orgId))!.runId;
    const subLlm = new MockProvider([
      () => ({ content: [submit('Ventes +12 %, panier 48 €, 31 clients.')] }),
    ]);
    expect(await runAgentTaskInline(acts(subLlm), subRun)).toMatchObject({ status: 'succeeded' });

    expect(await bossDone).toMatchObject({ status: 'succeeded' });
    // La manager a reçu le résultat réel de son subordonné (pas un appel de plus pour patienter).
    expect(bossLlm.requests).toHaveLength(3);
    const received = JSON.stringify(bossLlm.requests[2]!.messages.at(-1));
    expect(received).toContain('Ventes +12 %');
    expect(received).toContain('Hugo');
  });

  it('mémoire du pôle injectée ; « Demander une suite » transmet le résultat précédent', async () => {
    const { agentId } = await hire('Iris', 'manager', { company: ['status'] });
    await createTask(db, {
      orgId,
      kind: 'custom',
      agentId,
      mission: {
        title: 'Rapport de juin',
        instructions: 'Rapport mensuel de juin, sources citées.',
      },
      requester: admin,
    });
    const run1 = (await startNextTask(db, orgId))!;
    await saveDocument(db, {
      orgId,
      agentId,
      taskId: run1.task.id,
      title: 'Rapport juin',
      content: 'Chiffres de juin.',
    });
    await runAgentTaskInline(
      acts(new MockProvider([() => ({ content: [submit('Juin : CA 42 k€, 3 risques.')] })])),
      run1.runId,
    );
    const next = await createFollowUp(db, {
      orgId,
      taskId: run1.task.id,
      instructions: 'Détaille les 3 risques avec un plan d’action.',
      actor: admin,
    });
    expect(next.title).toBe('Suite — Rapport de juin');
    const row = await db.task.findUniqueOrThrow({ where: { id: next.id } });
    expect(row.followUpOf).toBe(run1.task.id);
    expect(row.description).toContain('Juin : CA 42 k€');
    expect(row.description).toContain('Rapport juin');

    const run2 = (await startNextTask(db, orgId))!;
    const llm = new MockProvider([() => ({ content: [submit('Plan prêt.')] })]);
    await runAgentTaskInline(acts(llm), run2.runId);
    const first = JSON.stringify(llm.requests[0]!.messages[0]);
    expect(first).toContain('memoire_entreprise');
    expect(first).toContain('Rapport juin'); // document du pôle
    expect(first).toContain('Rapport de juin'); // mission terminée du pôle
  });
});
