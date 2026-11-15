import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import type { ErrorCode } from '@company-os/contracts';
import { DomainError, relayOutbox, type Db } from '@company-os/db';
import type { AuthConfig } from './auth';
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
  corsOrigin: string;
  logger?: boolean;
  signalApproval?: ApprovalSignaler;
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
  await app.register(cors, { origin: opts.corsOrigin, exposedHeaders: ['x-request-id'] });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: ErrorCode, message: string) =>
      reply.status(status).send({ error: { code, message, requestId: req.id } });
    if (err instanceof DomainError) return send(STATUS[err.code] ?? 500, err.code, err.message);
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

  registerV1(app, db, opts.auth, opts.signalApproval);

  const io = attachRealtime(app.server, db, opts.auth, opts.corsOrigin);
  const relayOnce = (): Promise<number> => relayOutbox(db, (events) => broadcast(io, events));
  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => void io.close(() => resolve()));
  });
  return { app, io, relayOnce };
}
