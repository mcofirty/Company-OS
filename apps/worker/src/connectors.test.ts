import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider, SUBMIT_RESULT, type LlmContentBlock } from '@company-os/agents';
import {
  createAgentByAdmin,
  createConnector,
  createTask,
  DEV_ADMIN,
  initLiveOrg,
  loadSnapshot,
  setConnectorToolPolicy,
  startNextTask,
} from '@company-os/db';
import { loadPricing, sealSecret } from '@company-os/policies';
import { discoverMcpTools, ToolGateway } from '@company-os/tools';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { startTestMcpServer, type TestMcpServer } from '../../../tests/setup/mcp-server';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';

const db = testDb();
const KEY = Buffer.alloc(32, 3);
const TOKEN = 'secret-mcp-token-abcdef';
let mcp: TestMcpServer;
let orgId = '';
let toolId = '';
let connectorId = '';
const admin = { kind: 'user', id: DEV_ADMIN.id } as const;
const gateway = () =>
  new ToolGateway(db, { latencyScale: 0, connectorKey: KEY, allowPrivateNetwork: true });

beforeAll(async () => {
  mcp = await startTestMcpServer({ token: TOKEN });
});
beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  const discovered = await discoverMcpTools({
    url: mcp.url,
    headers: { Authorization: `Bearer ${TOKEN}` },
    allowPrivateNetwork: true,
  });
  ({ toolId, connectorId } = await createConnector(db, {
    orgId,
    actorId: DEV_ADMIN.id,
    name: 'Notes équipe',
    url: mcp.url,
    secretSealed: sealSecret(TOKEN, KEY),
    authHeader: 'authorization',
    discovered,
  }));
  mcp.calls.length = 0;
});
afterAll(async () => {
  await mcp.close();
  await db.$disconnect();
});

const startMission = async (grants: Record<string, string[]>) => {
  const { agentId } = await createAgentByAdmin(db, {
    orgId,
    actor: admin,
    req: {
      name: 'Nora',
      title: 'Assistante',
      departmentId: `${orgId.slice(0, 8)}-sales`,
      role: 'specialist',
      grants,
      goal: 'Retrouver les notes',
      instructions: 'Toujours citer la note consultée dans la réponse.',
      monthlyBudgetUsd: 2,
      avatarId: 'avatar-02',
      skills: [],
      routines: [],
    },
  });
  const { task } = await createTask(db, {
    orgId,
    kind: 'custom',
    agentId,
    mission: {
      title: 'Prochaine réunion',
      instructions: 'Trouve la date de la prochaine réunion.',
    },
    requester: admin,
  });
  const started = (await startNextTask(db, orgId))!;
  return { agentId, task, runId: started.runId };
};
const use = (id: string, name: string, input: Record<string, unknown>): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const submit = use('toolu_submit', SUBMIT_RESULT, {
  status: 'completed',
  summary: 'Réunion lundi 10h.',
  verifiedFacts: [{ claim: 'Réunion lundi 10h', sourceRef: 'notes' }],
  followUpTasks: [],
  uncertainty: [],
});

describe('Connecteurs MCP — exécution par un agent', () => {
  it('politique « lecture » : appel MCP réel, jeton déchiffré, résultat transmis au modèle', async () => {
    await setConnectorToolPolicy(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      connectorId,
      action: 'search_notes',
      policy: 'read',
    });
    const { task, runId } = await startMission({ [toolId]: ['search_notes'] });
    const llm = new MockProvider([
      () => ({ content: [use('t1', `${toolId}__search_notes`, { query: 'réunion' })] }),
      () => ({ content: [submit] }),
    ]);
    const acts = createActivities({
      db,
      gateway: gateway(),
      pricing: loadPricing(),
      liveProvider: llm,
    });
    expect(await runAgentTaskInline(acts, runId)).toMatchObject({ status: 'succeeded' });
    // Le modèle ne voit que l'outil accordé, avec le schéma fourni par le serveur MCP.
    const def = llm.requests[0]!.tools.find((t) => t.name === `${toolId}__search_notes`)!;
    expect(def.description).toContain('Notes équipe');
    expect(def.input_schema.properties).toHaveProperty('query');
    expect(llm.requests[0]!.tools.map((t) => t.name)).not.toContain(`${toolId}__create_ticket`);
    // Appel réellement reçu par le serveur, avec le jeton.
    expect(mcp.calls).toEqual([
      { name: 'search_notes', args: { query: 'réunion' }, auth: `Bearer ${TOKEN}` },
    ]);
    expect(JSON.stringify(llm.requests[1]!.messages.at(-1))).toContain('Réunion lundi 10h');
    const inv = await db.toolInvocation.findFirstOrThrow({ where: { taskId: task.id } });
    expect(inv).toMatchObject({
      toolId,
      action: 'search_notes',
      status: 'succeeded',
      risk: 'read',
    });
    expect(inv.safeSummary).toContain('Notes équipe');
    // Aucun secret dans le journal d'événements.
    const events = await db.eventLog.findMany({ where: { orgId } });
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain(TOKEN);
    const snap = (await loadSnapshot(db, orgId))!;
    expect(snap.tools.map((t) => t.id)).toContain(toolId);
  });

  it('politique « validation » : rien n’est exécuté avant la décision humaine', async () => {
    const { agentId, runId } = await startMission({ [toolId]: ['create_ticket'] });
    const r = await gateway().invoke({
      orgId,
      runId,
      agentId,
      toolId,
      action: 'create_ticket',
      input: { title: 'Préparer la salle', priority: 2 },
      idempotencyKey: `${runId}:ticket`,
      causationId: null,
    });
    expect(r.status).toBe('waiting_approval');
    expect(mcp.calls).toHaveLength(0);
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { orgId } });
    expect(approval.safePreview).toMatchObject({ title: 'Préparer la salle', priority: '2' });
    expect(JSON.stringify(approval.safePreview)).toContain('action RÉELLE sur Notes équipe');
  });

  it('outil désactivé ou non accordé : refus, aucun appel réseau', async () => {
    const { agentId, runId } = await startMission({ [toolId]: ['search_notes'] });
    const notGranted = await gateway().invoke({
      orgId,
      runId,
      agentId,
      toolId,
      action: 'create_ticket',
      input: { title: 'x' },
      idempotencyKey: `${runId}:a`,
      causationId: null,
    });
    expect(notGranted).toMatchObject({ status: 'rejected', reasonCode: 'POLICY_DENIED' });
    await setConnectorToolPolicy(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      connectorId,
      action: 'search_notes',
      policy: 'disabled',
    });
    const disabled = await gateway().invoke({
      orgId,
      runId,
      agentId,
      toolId,
      action: 'search_notes',
      input: { query: 'x' },
      idempotencyKey: `${runId}:b`,
      causationId: null,
    });
    expect(disabled).toMatchObject({ status: 'rejected', reasonCode: 'POLICY_DENIED' });
    expect(mcp.calls).toHaveLength(0);
  });
});
