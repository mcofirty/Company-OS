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

describe('connexion propriétaire (ADR-053)', () => {
  it('TOTP : vecteur de test RFC 6238 (SHA-1, T=59 s => 94287082, 6 chiffres 287082)', async () => {
    const { base32Encode, totpCode, totpStep, verifyTotp } = await import('./owner-login');
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, totpStep(59_000))).toBe('287082');
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe('081804');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(1);
    expect(verifyTotp(secret, '287082', 59_000 + 30_000)).toBe(1); // tolérance -1 pas
    expect(verifyTotp(secret, '287082', 59_000 + 90_000)).toBeNull();
    expect(verifyTotp(secret, '287082', 59_000, 1)).toBeNull(); // déjà utilisé
    expect(verifyTotp(secret, 'abcdef', 59_000)).toBeNull();
  });
  it('base32 : aller-retour', async () => {
    const { base32Decode, base32Encode, generateTotpSecret } = await import('./owner-login');
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(base32Decode(s)).toHaveLength(20);
  });
  it('mot de passe : empreinte scrypt sans « $ », vérification, longueur minimale', async () => {
    const { hashPassword, verifyPassword, isPasswordHash } = await import('./owner-login');
    const h = await hashPassword('un-long-mot-de-passe');
    expect(h).not.toContain('$');
    expect(isPasswordHash(h)).toBe(true);
    expect(await verifyPassword('un-long-mot-de-passe', h)).toBe(true);
    expect(await verifyPassword('un-long-mot-de-passE', h)).toBe(false);
    expect(await hashPassword('un-long-mot-de-passe')).not.toBe(h); // sel aléatoire
    await expect(hashPassword('court')).rejects.toThrow(/trop court/);
  });
  it('freins : 5 essais libres, puis attente doublée ; plafond global', async () => {
    const { LoginThrottle } = await import('./owner-login');
    const t = new LoginThrottle(5, 30);
    for (let i = 0; i < 4; i++) t.fail('a', 0);
    expect(t.retryAfter('a', 0)).toBe(0);
    t.fail('a', 0);
    expect(t.retryAfter('a', 0)).toBe(60_000);
    t.fail('a', 0);
    expect(t.retryAfter('a', 0)).toBe(120_000);
    expect(t.retryAfter('b', 0)).toBe(0);
    t.succeed('a');
    expect(t.retryAfter('a', 0)).toBe(0);
    const g = new LoginThrottle(5, 3);
    g.fail('x', 0);
    g.fail('y', 0);
    g.fail('z', 0);
    expect(g.retryAfter('nouvelle', 0)).toBe(15 * 60_000);
  });
});
