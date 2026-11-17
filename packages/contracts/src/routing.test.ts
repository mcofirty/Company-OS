import { describe, expect, it } from 'vitest';
import { choiceOfPolicy, policyForChoice, routeModel } from './routing';

describe('optimisation automatique du modèle (Haiku / Sonnet / Opus)', () => {
  it('tâche courte et simple : Tier 1 (Haiku)', () => {
    const d = routeModel({
      title: 'Reformule ce mail',
      instructions: 'Reformule poliment, 3 lignes.',
    });
    expect(d.tier).toBe('economy');
    expect(d.model).toContain('haiku');
    expect(d.effort).toBe('low');
    expect(d.reason).toMatch(/^Tier 1/);
  });
  it('mission standard : Tier 2 (Sonnet)', () => {
    const d = routeModel({
      title: 'Brouillon de newsletter',
      instructions:
        'Rédige la newsletter de novembre à partir des trois articles du blog, ton chaleureux, avec un appel à l’action vers la page produit.',
    });
    expect(d.tier).toBe('balanced');
  });
  it('mission lourde (stratégie, analyse, consignes longues) : Tier 3 (Opus)', () => {
    const d = routeModel({
      title: 'Stratégie commerciale 2027',
      instructions: `Analyse approfondie du marché, benchmark des concurrents et plan d’action. ${'Détails. '.repeat(100)}`,
    });
    expect(d.tier).toBe('quality');
    expect(d.effort).toBe('high');
  });
  it('nouvel essai : un cran au-dessus ; budget presque épuisé : retour au Tier 1', () => {
    const base = {
      title: 'Brouillon de post',
      instructions:
        'Rédige un post LinkedIn sur notre lancement, avec deux variantes de titre et des hashtags pertinents pour la cible.',
    };
    expect(routeModel(base).tier).toBe('balanced');
    expect(routeModel({ ...base, attempt: 2 }).tier).toBe('quality');
    expect(routeModel({ ...base, attempt: 2, budgetLeft: 0.1 }).tier).toBe('balanced');
    expect(routeModel({ ...base, budgetLeft: 0.02 }).tier).toBe('economy');
  });
  it('niveau imposé pour la mission : respecté (sauf garde-fou budget)', () => {
    const d = routeModel({ title: 'Reformule', instructions: 'Court.', forced: 'quality' });
    expect(d.tier).toBe('quality');
    expect(d.reason).toContain('niveau choisi pour cette mission');
  });
  it('politique stockée : auto ou niveau fixe', () => {
    expect(choiceOfPolicy(policyForChoice('auto'))).toBe('auto');
    expect(choiceOfPolicy(policyForChoice('economy'))).toBe('economy');
    expect(choiceOfPolicy({ model: 'inconnu' })).toBe('quality');
  });
});
