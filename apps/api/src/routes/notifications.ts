import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DomainError,
  getNotificationSettings,
  NOTIFY_EVENTS,
  saveNotificationSettings,
  type Db,
} from '@company-os/db';
import { sealSecret } from '@company-os/policies';
import { assertSafeMcpUrl, ToolError } from '@company-os/tools';
import { principalOf, requireRole } from '../auth';
import type { ConnectorSettings } from '../config';
import type { Notifier } from '../notifier';

const SaveSchema = z
  .object({
    /** https://ntfy.sh/mon-sujet-secret — facultatif si déjà configuré. */
    url: z.string().trim().url().max(300).optional(),
    token: z.string().trim().max(300).optional(),
    email: z.string().trim().email().max(200).nullable().default(null),
    events: z.array(z.enum(NOTIFY_EVENTS)).max(4),
    enabled: z.boolean(),
  })
  .strict();

/** Réglages des notifications (administrateur) : adresse et jeton chiffrés, jamais renvoyés. */
export function registerNotifications(
  app: FastifyInstance,
  db: Db,
  cfg: ConnectorSettings,
  notifier: Notifier,
): void {
  const meta = { schemaVersion: 1 };
  app.get('/v1/notifications', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    return {
      data: await getNotificationSettings(db, p.orgId),
      meta: { ...meta, secretStorage: cfg.secretKey !== null },
    };
  });
  app.post('/v1/notifications', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const body = SaveSchema.parse(req.body);
    if (!cfg.secretKey) {
      throw new DomainError(
        'CONFLICT',
        'CONNECTOR_SECRET_KEY absente : stockage chiffré indisponible',
      );
    }
    if (body.url) {
      try {
        await assertSafeMcpUrl(body.url, cfg.allowPrivateNetwork);
      } catch (e) {
        throw new DomainError(
          'VALIDATION_ERROR',
          e instanceof ToolError ? `Adresse refusée : ${e.message}` : 'Adresse refusée',
        );
      }
    } else if (!(await getNotificationSettings(db, p.orgId)).configured) {
      throw new DomainError('VALIDATION_ERROR', 'Adresse ntfy requise');
    }
    await saveNotificationSettings(db, {
      orgId: p.orgId,
      actorId: p.userId,
      ...(body.url ? { urlSealed: sealSecret(body.url, cfg.secretKey) } : {}),
      ...(body.token !== undefined
        ? { tokenSealed: body.token ? sealSecret(body.token, cfg.secretKey) : null }
        : {}),
      email: body.email,
      events: body.events,
      enabled: body.enabled,
    });
    return { data: await getNotificationSettings(db, p.orgId), meta };
  });
  app.post('/v1/notifications/test', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    try {
      await notifier.send(p.orgId, {
        kind: 'approval',
        title: 'Living HQ · test',
        message: 'Les notifications fonctionnent. Vous serez prévenu des validations et missions.',
        priority: 3,
        tags: ['bell'],
      });
    } catch (e) {
      throw new DomainError(
        'TOOL_UNAVAILABLE',
        `Envoi impossible : ${e instanceof Error ? e.message : 'erreur'}`,
      );
    }
    return { data: { sent: true }, meta };
  });
}
