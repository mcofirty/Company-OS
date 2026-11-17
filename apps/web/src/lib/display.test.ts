import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY, parseDisplay } from './display';

describe('préférences d’affichage', () => {
  it('3D par défaut, valeurs invalides ignorées', () => {
    expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay('pas du json')).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplay('{"renderer":"vr","glass":"x"}')).toEqual(DEFAULT_DISPLAY);
  });
  it('bornes de transparence et choix 2D', () => {
    expect(parseDisplay('{"renderer":"2d","glass":5,"night":true}')).toEqual({
      renderer: '2d',
      glass: 0.95,
      night: true,
      motion: 'eco',
    });
    expect(parseDisplay('{"glass":0}').glass).toBe(0.3);
  });
});
