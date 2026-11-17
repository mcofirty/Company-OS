import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  issueSession,
  LoginThrottle,
  SESSION_LONG_SECONDS,
  SESSION_SHORT_SECONDS,
  verifyPassword,
  verifyTotp,
} from '@company-os/policies';
import type { OwnerLogin } from './auth';

const LoginBody = z.object({
  password: z.string().min(1).max(256),
  code: z.string().min(1).max(12),
  /** « Rester connecté sur cet appareil » : 30 jours au lieu de 12 h. */
  remember: z.boolean().default(false),
});

/**
 * `POST /auth/login` (ADR-053) : mot de passe + code à 6 chiffres => jeton de session signé.
 * Message d'échec unique (on ne dit pas lequel des deux est faux), freins progressifs, un code
 * ne sert qu'une fois. Sans connexion propriétaire configurée : route absente (404).
 */
export function registerOwnerLogin(
  app: FastifyInstance,
  owner: OwnerLogin | undefined,
  now: () => number = Date.now,
): void {
  if (!owner) return;
  const throttle = new LoginThrottle();
  let lastStep = -1;

  app.post('/auth/login', async (req, reply) => {
    const t = now();
    const wait = throttle.retryAfter(req.ip, t);
    const fail = (status: number, code: string, message: string) =>
      reply.status(status).send({ error: { code, message, requestId: req.id } });
    if (wait > 0) {
      const minutes = Math.ceil(wait / 60_000);
      reply.header('retry-after', Math.ceil(wait / 1000));
      return fail(
        429,
        'RATE_LIMITED',
        `Trop d’essais. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      );
    }
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Mot de passe et code requis');
    }
    const { password, code, remember } = parsed.data;
    // Les deux vérifications sont toujours faites : la durée ne révèle pas laquelle échoue.
    const passwordOk = await verifyPassword(password, owner.passwordHash);
    const step = verifyTotp(owner.totpSecret, code, t, lastStep);
    if (!passwordOk || step === null) {
      throttle.fail(req.ip, t);
      req.log.warn({ ip: req.ip }, 'owner login failed');
      return fail(401, 'UNAUTHORIZED', 'Mot de passe ou code incorrect.');
    }
    lastStep = step;
    throttle.succeed(req.ip);
    req.log.info({ ip: req.ip, remember }, 'owner login succeeded');
    const session = issueSession(
      owner.sessionSecret,
      owner.passwordHash,
      t,
      remember ? SESSION_LONG_SECONDS : SESSION_SHORT_SECONDS,
    );
    return { data: session };
  });
}
