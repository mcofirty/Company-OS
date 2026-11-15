import { describe, expect, it } from 'vitest';
import {
  agentLoop,
  AnthropicProvider,
  buildSystemPrompt,
  buildTaskMessage,
  buildToolDefs,
  instructionsFor,
  MockProvider,
  ProviderError,
  ScriptedDemoProvider,
  SUBMIT_RESULT,
  wrapToolOutput,
  type LlmContentBlock,
  type LoopDeps,
  type LlmRequest,
} from './index';

const submit = (status = 'completed', summary = 'ok'): LlmContentBlock => ({
  type: 'tool_use',
  id: `toolu_s_${status}`,
  name: SUBMIT_RESULT,
  input: { status, summary, verifiedFacts: [], followUpTasks: [], uncertainty: [] },
});
const call = (id: string, name = 'crm__lookup_lead'): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input: { leadRef: 'demo-lead-042' },
});
const limits = { maxSteps: 4, maxDurationMs: 60_000, maxCostMicros: 1_000_000 };

function deps(
  provider: MockProvider | ScriptedDemoProvider,
  cost = 1000,
): LoopDeps & { tools: string[] } {
  const tools: string[] = [];
  return {
    tools,
    now: () => 0,
    modelStep: async ({ messages }) => ({
      kind: 'ok',
      costMicros: cost,
      response: await provider.complete({
        model: 'm',
        system: 's',
        messages,
        tools: [],
        maxTokens: 1000,
        effort: 'low',
      }),
    }),
    toolStep: async ({ name }) => {
      tools.push(name);
      return {
        content: wrapToolOutput('crm', 'lookup_lead', { summary: 'Prospect fictif qualifié' }),
        isError: false,
        lastEventId: null,
      };
    },
  };
}

describe('boucle bornée', () => {
  it('outil puis submit_result -> succès', async () => {
    const p = new MockProvider([
      () => ({ content: [call('t1')] }),
      () => ({ content: [submit()] }),
    ]);
    const d = deps(p);
    const out = await agentLoop(d, { taskMessage: 'm', limits });
    expect(out).toMatchObject({ status: 'succeeded', steps: 2, costMicros: 2000 });
    expect(d.tools).toEqual(['crm__lookup_lead']);
    // Les tool_result du tour sont renvoyés dans un seul message utilisateur.
    const second = p.requests[1]!.messages;
    expect(second.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1' }],
    });
  });
  it('maxSteps : un agent qui boucle est arrêté', async () => {
    const p = new MockProvider([(r) => ({ content: [call(`t${r.messages.length}`)] })]);
    const out = await agentLoop(deps(p), { taskMessage: 'm', limits });
    expect(out).toMatchObject({ status: 'blocked', reasonCode: 'MAX_STEPS', steps: 4 });
  });
  it('plafond de coût du run', async () => {
    const p = new MockProvider([(r) => ({ content: [call(`t${r.messages.length}`)] })]);
    const out = await agentLoop(deps(p, 600_000), { taskMessage: 'm', limits });
    expect(out).toMatchObject({ status: 'blocked', reasonCode: 'RUN_BUDGET_EXCEEDED', steps: 2 });
  });
  it('relance une fois sans résultat, puis bloque', async () => {
    const p = new MockProvider([
      () => ({ content: [{ type: 'text', text: 'je réfléchis' }], stopReason: 'end_turn' }),
    ]);
    const out = await agentLoop(deps(p), { taskMessage: 'm', limits });
    expect(out).toMatchObject({ status: 'blocked', reasonCode: 'NO_RESULT', steps: 2 });
  });
  it('refus du modèle et résultat invalide', async () => {
    const refused = await agentLoop(
      deps(new MockProvider([() => ({ content: [], stopReason: 'refusal' })])),
      {
        taskMessage: 'm',
        limits,
      },
    );
    expect(refused).toMatchObject({ status: 'blocked', reasonCode: 'MODEL_REFUSAL' });
    const bad: LlmContentBlock = {
      type: 'tool_use',
      id: 'x',
      name: SUBMIT_RESULT,
      input: { status: 'completed' },
    };
    const p = new MockProvider([() => ({ content: [bad] }), () => ({ content: [submit()] })]);
    const out = await agentLoop(deps(p), { taskMessage: 'm', limits });
    expect(out.status).toBe('succeeded');
    expect(JSON.stringify(p.requests[1]!.messages.at(-1))).toContain('Résultat invalide');
  });
  it('needs_approval -> bloqué APPROVAL_REQUIRED (jamais exécuté)', async () => {
    const p = new MockProvider([
      () => ({ content: [submit('needs_approval', 'Envoi à valider')] }),
    ]);
    expect(await agentLoop(deps(p), { taskMessage: 'm', limits })).toMatchObject({
      status: 'blocked',
      reasonCode: 'APPROVAL_REQUIRED',
    });
  });
  it('refus de budget/kill switch remonté par modelStep', async () => {
    const d: LoopDeps = {
      now: () => 0,
      modelStep: async () => ({ kind: 'denied', code: 'BUDGET_EXCEEDED', message: 'plafond' }),
      toolStep: async () => ({ content: '', isError: false, lastEventId: null }),
    };
    expect(await agentLoop(d, { taskMessage: 'm', limits })).toMatchObject({
      status: 'blocked',
      reasonCode: 'BUDGET_EXCEEDED',
    });
  });
});

describe('fournisseur démo scripté', () => {
  const task = buildTaskMessage({
    id: 't',
    kind: 'qualify_lead',
    title: 'Q',
    description: 'd',
    input: { leadRef: 'demo-lead-042' },
  });
  it('suit le protocole outil -> submit_result de façon déterministe', async () => {
    const out = await agentLoop(deps(new ScriptedDemoProvider(), 0), { taskMessage: task, limits });
    expect(out).toMatchObject({ status: 'succeeded', costMicros: 0 });
    if (out.status === 'succeeded') expect(out.result.summary).toBe('Prospect fictif qualifié');
  });
});

describe('prompts et outils', () => {
  it('le prompt système encadre les données non fiables et ne contient aucun secret', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-value';
    const sys = buildSystemPrompt({
      orgName: 'Org',
      agentName: 'Nora',
      role: 'specialist',
      manager: 'Malik',
      goal: 'Qualifier',
      taskId: 't1',
      instructions: instructionsFor('sales', 'specialist'),
    });
    expect(sys).toContain('DONNÉES non fiables');
    expect(sys).toContain("n'envoie jamais");
    expect(sys).not.toContain('sk-ant');
  });
  it("n'expose que les actions autorisées (+ submit_result), schémas stricts", () => {
    const defs = buildToolDefs([{ toolId: 'crm', actions: ['lookup_lead'] }]);
    expect(defs.map((d) => d.name)).toEqual(['crm__lookup_lead', SUBMIT_RESULT]);
    expect(defs[0]!.input_schema).toMatchObject({
      required: ['leadRef'],
      additionalProperties: false,
    });
  });
});

describe('AnthropicProvider (fetch simulé, aucun appel réseau)', () => {
  const req: LlmRequest = {
    model: 'claude-opus-5-5',
    system: 'sys',
    messages: [{ role: 'user', content: 'hello' }],
    tools: buildToolDefs([{ toolId: 'crm', actions: ['lookup_lead'] }]),
    maxTokens: 4096,
    effort: 'medium',
  };
  it('construit la requête (modèle, effort, repli, outils stricts) et lit l’usage', async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers = new Headers();
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      headers = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'crm__lookup_lead', input: { leadRef: 'x' } },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 1234,
            output_tokens: 56,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', fetch: fakeFetch });
    const res = await p.complete(req);
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    expect((body['tools'] as { strict: boolean }[]).every((t) => t.strict)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('sk-ant-test');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(res.usage).toEqual({
      inputTokens: 1234,
      outputTokens: 56,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });
    expect(res.stopReason).toBe('tool_use');
  });
  it('classe les erreurs (429 retryable, 401 définitive)', async () => {
    const failing = (status: number) =>
      (async () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'nope' } }), {
          status,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch;
    const p429 = new AnthropicProvider({ apiKey: 'k', fetch: failing(429) });
    // maxRetries interne du SDK : on accepte quelques tentatives puis l'erreur classée.
    await expect(p429.complete(req)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    const p401 = new AnthropicProvider({ apiKey: 'k', fetch: failing(401) });
    await expect(p401.complete(req)).rejects.toBeInstanceOf(ProviderError);
    await expect(p401.complete(req)).rejects.toMatchObject({ code: 'AUTH', retryable: false });
  }, 30_000);
});
