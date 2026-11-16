import type { LlmContentBlock } from '@company-os/agents';
import { completeInvocation, requestInvocation, startInvocation, type Db } from '@company-os/db';
import { redactText } from '@company-os/policies';

const ACTION: Record<string, 'search' | 'fetch'> = { web_search: 'search', web_fetch: 'fetch' };

/**
 * Les recherches et lectures web s'exécutent chez Anthropic, hors de la passerelle d'outils.
 * Pour que le cockpit les montre comme les autres outils (mur des outils, timeline, audit), chaque
 * appel serveur est enregistré a posteriori : demandé → démarré → réussi/échoué. Idempotent par
 * (run, identifiant du bloc) : une réponse rejouée n'enregistre rien deux fois.
 */
export async function recordServerToolCalls(
  db: Db,
  input: { orgId: string; runId: string; content: LlmContentBlock[] },
): Promise<number> {
  const blocks = input.content as unknown as Record<string, unknown>[];
  let recorded = 0;
  for (const b of blocks) {
    if (b['type'] !== 'server_tool_use') continue;
    const action = ACTION[String(b['name'])];
    if (!action) continue;
    const id = String(b['id']);
    const args = (b['input'] ?? {}) as Record<string, unknown>;
    const target = String(action === 'search' ? (args['query'] ?? '') : (args['url'] ?? ''));
    const result = blocks.find(
      (r) =>
        (r['type'] === 'web_search_tool_result' || r['type'] === 'web_fetch_tool_result') &&
        r['tool_use_id'] === id,
    );
    const resultContent = result?.['content'] as Record<string, unknown> | unknown[] | undefined;
    const error =
      resultContent &&
      !Array.isArray(resultContent) &&
      String(resultContent['type']).endsWith('_error')
        ? String(resultContent['error_code'] ?? 'unavailable')
        : null;
    const req = await requestInvocation(db, {
      orgId: input.orgId,
      runId: input.runId,
      toolId: 'web',
      action,
      redactedInput: { [action === 'search' ? 'query' : 'url']: redactText(target).slice(0, 300) },
      idempotencyKey: `${input.runId}:${id}`,
      causationId: null,
    });
    if (req.existing) continue;
    const started = await startInvocation(db, {
      orgId: input.orgId,
      invocationId: req.invocation.id,
      attempt: 1,
      causationId: req.eventId,
    });
    const label = redactText(target).slice(0, 140);
    const count = Array.isArray(resultContent) ? resultContent.length : null;
    await completeInvocation(db, {
      orgId: input.orgId,
      invocationId: req.invocation.id,
      causationId: started.eventId,
      ...(error || !result
        ? { ok: false as const, errorCode: (error ?? 'NO_RESULT').toUpperCase(), attempt: 1 }
        : {
            ok: true as const,
            safeSummary:
              action === 'search'
                ? `Recherche « ${label} »${count !== null ? ` : ${count} résultat(s)` : ''}`
                : `Page lue : ${label}`,
          }),
    });
    recorded++;
  }
  return recorded;
}
