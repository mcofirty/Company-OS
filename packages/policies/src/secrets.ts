import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des secrets de connecteurs au repos (AES-256-GCM, authentifié).
 * Clé : `CONNECTOR_SECRET_KEY` = 32 octets en base64 (`openssl rand -base64 32`), jamais en base.
 * Format stocké : `v1:<iv>:<tag>:<données>` (base64). Toute altération fait échouer le déchiffrement.
 */
export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretKeyError';
  }
}

export function parseSecretKey(b64: string | undefined): Buffer | null {
  if (!b64) return null;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new SecretKeyError('CONNECTOR_SECRET_KEY doit faire 32 octets encodés en base64');
  }
  return key;
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64'),
    c.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function openSecret(sealed: string, key: Buffer): string {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new SecretKeyError('Secret illisible');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new SecretKeyError('Secret illisible (clé différente ou donnée altérée)');
  }
}
