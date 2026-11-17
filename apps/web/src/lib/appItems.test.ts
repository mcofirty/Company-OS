import { describe, expect, it } from 'vitest';
import type { AgentView, InvocationView, ToolView, WorldSnapshot } from '@company-os/contracts';
import { appItems, isAppActive } from './appItems';

const tool = (t: Partial<ToolView> & { id: string }): ToolView =>
  ({
    name: t.id,
    code: 'X',
    category: 'connector',
    color: '#123456',
    status: 'healthy',
    actions: [],
    ...t,
  }) as ToolView;
const inv = (toolId: string, action: string, status: InvocationView['status']): InvocationView =>
  ({
    id: `${toolId}-${action}`,
    toolId,
    action,
    status,
    agentId: 'a1',
    taskId: 't1',
  }) as InvocationView;
const world = (tools: ToolView[]): WorldSnapshot =>
  ({ tools, agents: [] }) as unknown as WorldSnapshot;

describe('Barre d’applications', () => {
  it('Claude, outils intégrés, connecteurs ; une passerelle se déplie en applications', () => {
    const w = world([
      tool({ id: 'web', category: 'recherche' }),
      tool({ id: 'mcp-aaaa', app: 'notion', name: 'Notion' }),
      tool({
        id: 'mcp-zzzz',
        app: 'zapier',
        name: 'Zapier',
        actions: [
          {
            action: 'gmail_send_email',
            label: 'gmail_send_email',
            kind: 'execute',
            risk: 'external_write',
          },
          { action: 'gmail_find_email', label: 'gmail_find_email', kind: 'read', risk: 'read' },
          {
            action: 'whatsapp_send',
            label: 'whatsapp_send',
            kind: 'execute',
            risk: 'external_write',
          },
          { action: 'weather_today', label: 'weather_today', kind: 'read', risk: 'read' },
        ],
      }),
    ]);
    const items = appItems(w);
    expect(items.map((i) => i.key)).toEqual([
      'claude',
      'web',
      'mcp-aaaa',
      'mcp-zzzz:gmail',
      'mcp-zzzz:whatsapp',
      'mcp-zzzz', // actions non reconnues
    ]);
    const gmail = items.find((i) => i.key === 'mcp-zzzz:gmail')!;
    const whatsapp = items.find((i) => i.key === 'mcp-zzzz:whatsapp')!;
    // S'illumine seulement quand un agent utilise une action Gmail EN COURS.
    const running = [inv('mcp-zzzz', 'gmail_send_email', 'running')];
    expect(isAppActive(gmail, running, [])).toBe(true);
    expect(isAppActive(whatsapp, running, [])).toBe(false);
    expect(isAppActive(gmail, [inv('mcp-zzzz', 'gmail_send_email', 'succeeded')], [])).toBe(false);
    const claude = items[0]!;
    expect(isAppActive(claude, [], [{ activity: 'working' } as AgentView])).toBe(true);
    expect(isAppActive(claude, [], [{ activity: 'idle' } as AgentView])).toBe(false);
  });
});
