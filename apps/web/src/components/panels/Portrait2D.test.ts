import { describe, expect, it } from 'vitest';
import { portraitSvg, shadeColor } from './Portrait2D';

const base = { avatarId: 'av-1', agentId: 'agent-1', deptColor: '#76C69A', crop: 'bust' } as const;

describe('portrait 2D', () => {
  it("l'expression suit l'humeur (bouche et yeux différents)", () => {
    const moods = ['neutral', 'focus', 'happy', 'worried'] as const;
    const svgs = moods.map((mood) => portraitSvg({ ...base, mood }));
    expect(new Set(svgs).size).toBe(4);
    expect(portraitSvg({ ...base, mood: 'worried' })).toContain('#8ec5ff'); // goutte de sueur
  });
  it('même agent : même portrait (déterministe) ; recadrage tête', () => {
    expect(portraitSvg({ ...base, mood: 'focus' })).toBe(portraitSvg({ ...base, mood: 'focus' }));
    expect(portraitSvg({ ...base, mood: 'focus', crop: 'head' })).toContain(
      'viewBox="24 16 72 72"',
    );
  });
  it('une couleur de pôle invalide ne peut pas injecter de balisage', () => {
    const svg = portraitSvg({ ...base, deptColor: '"><script>alert(1)</script>', mood: 'neutral' });
    expect(svg).not.toContain('<script');
    expect(shadeColor('#ffffff', 0.5)).toBe('#808080');
  });
});
