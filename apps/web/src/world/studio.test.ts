import { describe, expect, it } from 'vitest';
import type { AgentView } from '@company-os/contracts';
import { HQ_MAP, visualIntent } from '@company-os/world';
import { appearanceOf, bubbleFor, pastel, stateLabel, studioPath } from './studio';

const agent = (over: Partial<AgentView> = {}): AgentView =>
  ({
    id: 'a-1',
    name: 'Léo',
    title: 'Dev',
    departmentId: 'operations',
    avatarId: 'av-1',
    deskAnchor: 'operations-desk-01',
    status: 'active',
    activity: 'idle',
    currentTaskId: null,
    lastTaskEndedAt: null,
    ...over,
  }) as AgentView;

describe('rendu 3D studio : fonctions pures', () => {
  it('apparence stable et déterministe', () => {
    expect(appearanceOf('av-1')).toEqual(appearanceOf('av-1'));
    expect(appearanceOf('av-1').skin).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('pastel : éclaircit une couleur de pôle, valeur sûre si invalide', () => {
    expect(pastel('#000000', 0.5)).toBe('#808080');
    expect(pastel('pas une couleur')).toBe('#e9e4dc');
  });

  it('bulle : le travail réel prime, la vie de bureau seulement si inoccupé', () => {
    const titles = new Map([['t1', 'Rapport hebdo des ventes']]);
    const tools = new Map([['crm', { name: 'CRM' }]]);
    const working = agent({ activity: 'working', currentTaskId: 't1' });
    expect(bubbleFor(working, null, undefined, tools, titles)).toEqual({
      text: '📊 Rapport hebdo des ventes',
      kind: 'work',
    });
    expect(
      bubbleFor(agent({ activity: 'waiting_approval' }), null, undefined, tools, titles).kind,
    ).toBe('alert');
    const idle = agent();
    const intent = visualIntent(idle, 0, 0, HQ_MAP);
    const life = intent ? { ...intent, life: 'coffee' as const } : null;
    expect(bubbleFor(idle, life, undefined, tools, titles)).toEqual({
      text: '☕ Pause café',
      kind: 'life',
    });
    // Un agent au travail n'affiche jamais de bulle de vie de bureau.
    expect(bubbleFor(working, life, undefined, tools, titles).kind).toBe('work');
  });

  it('libellé d’état court', () => {
    expect(stateLabel(agent({ activity: 'using_tool' }), null)).toBe('au travail');
    expect(stateLabel(agent(), null)).toBe('disponible');
  });

  it('trajet : contourne les cloisons et arrive exactement à destination', () => {
    const seat = HQ_MAP.anchors['operations-desk-01']!;
    const cafe = HQ_MAP.anchors['cafe-spot-01']!;
    const to = { x: cafe.x + 0.5, z: cafe.y + 0.5 };
    const path = studioPath({ x: seat.x + 0.5, z: seat.y + 0.5 }, to, HQ_MAP);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
    for (const p of path)
      expect(HQ_MAP.isWalkable({ x: Math.floor(p.x), y: Math.floor(p.z) })).toBe(true);
    expect(studioPath(to, to, HQ_MAP)).toEqual([]);
  });
});
