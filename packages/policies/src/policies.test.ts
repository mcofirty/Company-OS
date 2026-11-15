import { describe, expect, it } from 'vitest';
import {
  canReserve,
  containsSensitive,
  costMicros,
  crossesThreshold,
  loadPricing,
  redactJson,
  redactText,
  usagePercent,
} from './index';

describe('rédaction', () => {
  it('masque emails, téléphones, IBAN, cartes et secrets', () => {
    const raw =
      'Contact: jean.dupont@client.example, tel 06 12 34 56 78, IBAN FR76 3000 6000 0112 3456 7890 189, carte 4111 1111 1111 1111, clé sk-ant-api03-abcdefghijkl, Bearer abc.def.ghijklmnop';
    const out = redactText(raw);
    for (const leak of ['jean.dupont', '06 12 34', 'FR76', '4111', 'sk-ant', 'abc.def'])
      expect(out).not.toContain(leak);
    expect(out).toContain('[EMAIL]');
    expect(containsSensitive(out)).toBe(false);
    expect(containsSensitive(raw)).toBe(true);
  });
  it('rédige récursivement un objet', () => {
    expect(redactJson({ a: ['x@y.fr'], b: { c: 'ok' }, n: 3 })).toEqual({
      a: ['[EMAIL]'],
      b: { c: 'ok' },
      n: 3,
    });
  });
});

describe('budget', () => {
  const b = {
    limitMicros: 1_000_000,
    usedMicros: 900_000,
    reservedMicros: 50_000,
    hardStop: true,
    alertThreshold: 0.8,
  };
  it('refuse une réserve au-delà du plafond dur', () => {
    expect(canReserve(b, 40_000)).toEqual({ ok: true });
    expect(canReserve(b, 60_000)).toEqual({
      ok: false,
      code: 'BUDGET_EXCEEDED',
      remainingMicros: 50_000,
    });
    expect(canReserve({ ...b, hardStop: false }, 10_000_000)).toEqual({ ok: true });
  });
  it('pourcentages sans division par zéro et franchissement de seuil', () => {
    expect(usagePercent(5, 0)).toBe(0);
    expect(usagePercent(850_000, 1_000_000)).toBe(85);
    expect(crossesThreshold(790_000, 810_000, 1_000_000, 0.8)).toBe(true);
    expect(crossesThreshold(810_000, 820_000, 1_000_000, 0.8)).toBe(false);
  });
});

describe('tarification', () => {
  const pricing = loadPricing();
  it('calcule le coût en micro-dollars depuis la grille versionnée', () => {
    // 1000 in * $4/M + 500 out * $20/M = 4000 + 10000 micros
    expect(
      costMicros(pricing, 'claude-opus-5-5', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(14_000);
  });
  it("n'invente pas de coût pour un modèle non tarifé", () => {
    expect(
      costMicros(pricing, 'modele-inconnu', {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });
});
