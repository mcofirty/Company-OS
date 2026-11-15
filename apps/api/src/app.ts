import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import type { ErrorCode } from '@company-os/contracts';
import { DomainError, relayOutbox, type Db } from '@company-os/db';
import { registerAuth, type AuthConfig } from './auth';
import { attachRealtime, broadcast, type Io } from './realtime';
import { registerV1, type ApprovalSignaler } from './routes/v1';

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429,
  TOOL_UNAVAILABLE: 503,
  EVENT_GAP: 409,
};

export interface AppOptions {
  db: Db;
  auth: AuthConfig;
  corsOrigin: string | string[];
  logger?: boolean;
  signalApproval?: ApprovalSignaler;
  /** Requêtes /v1 par minute et par client (IP). Défaut 1200. */
  rateLimitPerMinute?: number;
}

export async function buildApp(
  opts: AppOptions,
): Promise<{ app: FastifyInstance; io: Io; relayOnce: () => Promise<number> }> {
  const { db } = opts;
  const app = Fastify({
    logger: opts.logger
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        }
      : false,
    genReqId: () => randomUUID(),
  });
  await app.register(cors, {
    origin: opts.corsOrigin,
    exposedHeaders: ['x-request-id', 'retry-after'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-org-id', 'x-dev-role'],
    credentials: false, // jetons Bearer explicites, aucun cookie ambiant => pas de CSRF (ADR-035)
  });
  // API JSON : aucune ressource active, CSP la plus stricte (docs/11 §6).
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(rateLimit, {
    max: opts.rateLimitPerMinute ?? 1200,
    timeWindow: '1 minute',
    allowList: (req) => !req.url.startsWith('/v1/'),
    errorResponseBuilder: (req, ctx) => ({
      statusCode: 429,
      error: {
        code: 'RATE_LIMITED',
        message: `Trop de requêtes : réessayer dans ${Math.ceil(ctx.ttl / 1000)} s`,
        requestId: req.id,
      },
    }),
  });
  registerAuth(app, db, opts.auth);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: ErrorCode, message: string) =>
      reply.status(status).send({ error: { code, message, requestId: req.id } });
    if (err instanceof DomainError) return send(STATUS[err.code] ?? 500, err.code, err.message);
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: (err as { error?: unknown }).error });
    }
    if (err instanceof z.ZodError) {
      return send(
        400,
        'VALIDATION_ERROR',
        err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return send(status, 'VALIDATION_ERROR', 'Requête invalide');
    req.log.error({ err }, 'unhandled error');
    return send(500, 'INTERNAL_ERROR', 'Erreur interne');
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route inconnue', requestId: req.id } }),
  );

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      const pending = await db.outbox.count({ where: { status: 'pending' } });
      return { status: 'ready', checks: { database: 'ok', outboxPending: pending } };
    } catch {
      return reply.status(503).send({ status: 'not_ready', checks: { database: 'error' } });
    }
  });

  // Configuration publique d'authentification pour le cockpit (aucun secret : PKCE sans secret client).
  app.get('/auth/config', async () => ({
    data: opts.auth.oidc
      ? {
          mode: 'oidc' as const,
          issuer: opts.auth.oidc.settings.issuer,
          clientId: opts.auth.oidc.settings.clientId,
          audience: opts.auth.oidc.settings.audience,
          scope: opts.auth.oidc.settings.scope,
        }
      : { mode: opts.auth.accessToken ? ('token' as const) : ('dev' as const) },
  }));

  registerV1(app, db, opts.signalApproval);

  const io = attachRealtime(app.server, db, opts.auth, opts.corsOrigin);
  const relayOnce = (): Promise<number> => relayOutbox(db, (events) => broadcast(io, events));
  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => void io.close(() => resolve()));
  });
  return { app, io, relayOnce };
}
