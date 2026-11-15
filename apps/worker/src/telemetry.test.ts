import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { MockProvider, SUBMIT_RESULT, type LlmContentBlock } from '@company-os/agents';
import { createTask, startNextTask } from '@company-os/db';
import { loadPricing, SPAN_ATTRIBUTE_ALLOWLIST } from '@company-os/policies';
import { ToolGateway } from '@company-os/tools';
import { LIVE_ORG, resetAndSeed, seedLiveOrg, testDb } from '../../../tests/setup/helpers';
import { createActivities } from './activities';
import { runAgentTaskInline } from './inline';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();

const db = testDb();
beforeEach(async () => {
  exporter.reset();
  await resetAndSeed(db);
  await seedLiveOrg(db);
});
afterAll(async () => {
  await provider.shutdown();
  await db.$disconnect();
});

const tool = (id: string, name: string, input: Record<string, string>): LlmContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

describe('M5 — traces OpenTelemetry (docs/10 §2)', () => {
  it('llm.invoke et tool.invoke liés aux objets métier, sans aucune donnée sensible', async () => {
    const llm = new MockProvider([
      () => ({ content: [tool('t1', 'crm__lookup_lead', { leadRef: 'demo-lead-042' })] }),
      () => ({ content: [tool('t2', 'email__send_email', { ticketRef: 'liste-clients' })] }),
      () => ({
        content: [
          {
            type: 'tool_use',
            id: 't3',
            name: SUBMIT_RESULT,
            input: {
              status: 'completed',
              summary: 'Prospect qualifié.',
              verifiedFacts: [{ claim: 'ok', sourceRef: 'crm.lookup_lead' }],
              followUpTasks: [],
              uncertainty: [],
            },
          },
        ],
      }),
    ]);
    await createTask(db, {
      orgId: LIVE_ORG.id,
      kind: 'qualify_lead',
      requester: { kind: 'user', id: 'u' },
    });
    const started = (await startNextTask(db, LIVE_ORG.id))!;
    const acts = createActivities({
      db,
      gateway: new ToolGateway(db, { latencyScale: 0 }),
      pricing: loadPricing(),
      liveProvider: llm,
    });
    expect((await runAgentTaskInline(acts, started.runId)).status).toBe('succeeded');

    const spans = exporter.getFinishedSpans();
    const llmSpans = spans.filter((s) => s.name === 'llm.invoke');
    const toolSpans = spans.filter((s) => s.name === 'tool.invoke');
    expect(llmSpans).toHaveLength(3);
    expect(llmSpans[0]!.attributes).toMatchObject({
      'run.id': started.runId,
      'llm.model': 'claude-opus-5-5',
      'llm.input_tokens': 1000,
      'llm.outcome': 'ok',
    });
    expect(toolSpans.map((s) => [s.attributes['tool.id'], s.attributes['tool.status']])).toEqual([
      ['crm', 'succeeded'],
      ['email', 'rejected'],
    ]);
    expect(toolSpans[1]!.attributes).toMatchObject({
      'tool.risk': 'external_write',
      'tool.reason_code': 'POLICY_DENIED', // pas de droit d'envoi pour cet agent
      'agent.id': started.task.agentId,
    });
    expect(toolSpans[1]!.status.code).toBe(2); // ERROR

    // Liste blanche respectée et aucune donnée métier : ni PII, ni injection, ni prompt.
    const dump = JSON.stringify(spans.map((s) => ({ n: s.name, a: s.attributes, st: s.status })));
    for (const s of spans) {
      for (const k of Object.keys(s.attributes)) expect(SPAN_ATTRIBUTE_ALLOWLIST.has(k)).toBe(true);
    }
    expect(dump).not.toMatch(/jeanne|rival\.example|IGNORE|demo-lead-042|liste-clients|DONNÉES/i);
  });
});
