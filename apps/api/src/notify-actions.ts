import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Liens d'action des notifications (« Valider » / « Refuser » depuis le téléphone).
 * Jeton = charge utile + HMAC-SHA256 (clé dérivée de CONNECTOR_SECRET_KEY). Il ne vaut que pour
 * UNE demande, UNE décision et jusqu'à l'échéance de la demande ; la décision étant idempotente,
 * un second clic n'a aucun effet.
 */
export interface ActionClaim {
  orgId: string;
  approvalId: string;
  decision: 'approve' | 'reject';
  /** Échéance (epoch ms). */
  exp: number;
}

const b64 = (b: Buffer | string): string => Buffer.from(b).toString('base64url');
const keyOf = (secret: Buffer): Buffer =>
  createHmac('sha256', secret).update('notification-actions/v1').digest();

export function signAction(secret: Buffer, c: ActionClaim): string {
  const body = b64(JSON.stringify([c.orgId, c.approvalId, c.decision, c.exp]));
  const sig = b64(createHmac('sha256', keyOf(secret)).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyAction(secret: Buffer, token: string, now = Date.now()): ActionClaim | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || token.length > 600) return null;
  const expected = createHmac('sha256', keyOf(secret)).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const [orgId, approvalId, decision, exp] = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as [string, string, string, number];
    if (decision !== 'approve' && decision !== 'reject') return null;
    if (typeof exp !== 'number' || exp < now) return null;
    return { orgId, approvalId, decision, exp };
  } catch {
    return null;
  }
}
