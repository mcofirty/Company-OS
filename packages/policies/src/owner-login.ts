import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Connexion « propriétaire unique » (ADR-053) : mot de passe (scrypt) + code à 6 chiffres d'une
 * application d'authentification (TOTP RFC 6238, SHA-1, 30 s), puis jeton de session signé
 * (HMAC-SHA256). Aucune dépendance externe ; aucun `$` dans les formats (fichiers .env Compose).
 */

// ── Mot de passe ────────────────────────────────────────────────────────────
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(
  password: string,
  salt: Buffer,
  p: { N: number; r: number; p: number; keylen: number },
) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, p.keylen, { N: p.N, r: p.r, p: p.p, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export const MIN_PASSWORD_LENGTH = 10;

/** `scrypt:N:r:p:<sel base64url>:<empreinte base64url>` */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum)`);
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join(':');
}

export function isPasswordHash(v: string): boolean {
  return /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}$/.test(v);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, salt, hash] = stored.split(':') as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  });
  return timingSafeEqual(key, expected);
}

// ── Code à 6 chiffres (TOTP) ────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Clé TOTP invalide (base32 attendu)');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export const TOTP_STEP_SECONDS = 30;
export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** Code à 6 chiffres pour un pas de temps donné (RFC 4226 / 6238). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/**
 * Vérifie un code (tolérance ±1 pas = horloge du téléphone décalée de 30 s). Retourne le pas
 * accepté, ou null. `notBefore` : dernier pas déjà utilisé => un code ne sert qu'une fois.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  notBefore = -1,
): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const now = totpStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (step <= notBefore) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** Lien à scanner (QR) par Google Authenticator, Microsoft Authenticator, 1Password… */
export function otpauthUri(secret: string, label: string, issuer = 'Living HQ'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

// ── Jeton de session ────────────────────────────────────────────────────────
export const SESSION_PREFIX = 's1.';
export const SESSION_SHORT_SECONDS = 12 * 3600;
export const SESSION_LONG_SECONDS = 30 * 24 * 3600;

interface SessionPayload {
  sub: 'owner';
  iat: number;
  exp: number;
}

/**
 * La clé de signature dépend du secret de session ET de l'empreinte du mot de passe :
 * changer le mot de passe (ou le secret) déconnecte immédiatement tous les appareils.
 */
const signingKey = (sessionSecret: string, passwordHash: string): Buffer =>
  createHmac('sha256', sessionSecret).update(`owner-session:${passwordHash}`).digest();

export function issueSession(
  sessionSecret: string,
  passwordHash: string,
  nowMs: number,
  ttlSeconds: number,
): { token: string; expiresAt: number } {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionPayload = { sub: 'owner', iat, exp: iat + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingKey(sessionSecret, passwordHash))
    .update(body)
    .digest('base64url');
  return { token: `${SESSION_PREFIX}${body}.${sig}`, expiresAt: payload.exp * 1000 };
}

export function verifySession(
  token: string,
  sessionSecret: string,
  passwordHash: string,
  nowMs: number,
): boolean {
  if (!token.startsWith(SESSION_PREFIX)) return false;
  const [body, sig] = token.slice(SESSION_PREFIX.length).split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', signingKey(sessionSecret, passwordHash))
    .update(body)
    .digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const p = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as Partial<SessionPayload>;
    const now = Math.floor(nowMs / 1000);
    return (
      p.sub === 'owner' &&
      typeof p.exp === 'number' &&
      typeof p.iat === 'number' &&
      p.exp > now &&
      p.iat <= now + 60 &&
      p.exp - p.iat <= SESSION_LONG_SECONDS
    );
  } catch {
    return false;
  }
}

// ── Freins contre les essais répétés ───────────────────────────────────────
/**
 * Après 5 échecs pour une même adresse : attente de 1 min, doublée à chaque nouvel échec
 * (plafond 30 min). Au-delà de 30 échecs toutes adresses confondues en 1 h : connexion fermée
 * 15 min pour tout le monde (attaque distribuée). Un succès remet le compteur de l'adresse à zéro.
 */
export class LoginThrottle {
  private perKey = new Map<string, { fails: number; lockedUntil: number }>();
  private globalFails: number[] = [];
  private globalLockedUntil = 0;

  constructor(
    private readonly freeAttempts = 5,
    private readonly globalMaxPerHour = 30,
  ) {}

  /** Millisecondes d'attente restantes (0 = essai autorisé). */
  retryAfter(key: string, nowMs: number): number {
    const k = this.perKey.get(key);
    return Math.max(0, this.globalLockedUntil - nowMs, (k?.lockedUntil ?? 0) - nowMs);
  }

  fail(key: string, nowMs: number): void {
    const k = this.perKey.get(key) ?? { fails: 0, lockedUntil: 0 };
    k.fails += 1;
    if (k.fails >= this.freeAttempts) {
      const minutes = Math.min(30, 2 ** (k.fails - this.freeAttempts));
      k.lockedUntil = nowMs + minutes * 60_000;
    }
    this.perKey.set(key, k);
    this.globalFails = this.globalFails.filter((t) => t > nowMs - 3_600_000);
    this.globalFails.push(nowMs);
    if (this.globalFails.length >= this.globalMaxPerHour) {
      this.globalLockedUntil = nowMs + 15 * 60_000;
      this.globalFails = [];
    }
    if (this.perKey.size > 10_000) this.perKey.clear(); // borne mémoire
  }

  succeed(key: string): void {
    this.perKey.delete(key);
  }
}
