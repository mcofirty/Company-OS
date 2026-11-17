import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DomainError,
  dailyReport,
  decideApproval,
  getNotificationSettings,
  NOTIFY_EVENTS,
  saveNotificationSettings,
  type Db,
} from '@company-os/db';
import { sealSecret } from '@company-os/policies';
import { assertSafeMcpUrl, ToolError } from '@company-os/tools';
import { principalOf, requireRole } from '../auth';
import { verifyAction } from '../notify-actions';
import type { ApprovalSignaler } from './v1';
import type { ConnectorSettings } from '../config';
import type { Notifier } from '../notifier';

const SaveSchema = z
  .object({
    /** https://ntfy.sh/mon-sujet-secret — facultatif si déjà configuré. */
    url: z.string().trim().url().max(300).optional(),
    token: z.string().trim().max(300).optional(),
    email: z.string().trim().email().max(200).nullable().default(null),
    events: z.array(z.enum(NOTIFY_EVENTS)).max(5),
    enabled: z.boolean(),
    /** Rapport du matin : heure locale d'envoi (0-23) et fuseau horaire IANA. */
    dailyHour: z.number().int().min(0).max(23).optional(),
    timezone: z
      .string()
      .max(60)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'Fuseau horaire inconnu')
      .optional(),
  })
  .strict();

/** Réglages des notifications (administrateur) : adresse et jeton chiffrés, jamais renvoyés. */
export function registerNotifications(
  app: FastifyInstance,
  db: Db,
  cfg: ConnectorSettings,
  notifier: Notifier,
  signalApproval?: ApprovalSignaler,
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
      ...(body.dailyHour !== undefined ? { dailyHour: body.dailyHour } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
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

  /** Envoi immédiat du rapport du matin (aperçu, administrateur). */
  app.post('/v1/notifications/daily', async (req) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    try {
      await notifier.send(p.orgId, await dailyReport(db, p.orgId));
    } catch (e) {
      throw new DomainError(
        'TOOL_UNAVAILABLE',
        `Envoi impossible : ${e instanceof Error ? e.message : 'erreur'}`,
      );
    }
    return { data: { sent: true }, meta };
  });

  /**
   * Bouton « Valider » / « Refuser » d'une notification (sans session) : le jeton signé désigne une
   * demande, une décision et une échéance. La décision est attribuée à l'administrateur qui a
   * configuré les notifications de son téléphone ; elle est idempotente (second clic sans effet).
   */
  app.post('/v1/notify/approval', async (req, reply) => {
    const { t: token } = z.object({ t: z.string().max(600) }).parse(req.query);
    const claim = cfg.secretKey ? verifyAction(cfg.secretKey, token) : null;
    if (!claim) throw new DomainError('UNAUTHORIZED', 'Lien expiré ou invalide');
    const s = await db.notificationSetting.findUnique({ where: { orgId: claim.orgId } });
    if (!s?.enabled) throw new DomainError('UNAUTHORIZED', 'Notifications désactivées');
    const decision = claim.decision === 'approve' ? 'approved' : 'rejected';
    const r = await decideApproval(db, {
      orgId: claim.orgId,
      approvalId: claim.approvalId,
      decision,
      reviewer: { kind: 'user', id: s.updatedBy.replace(/^user:/, '') },
      reason:
        decision === 'approved' ? 'Validé depuis la notification' : 'Refusé depuis la notification',
    });
    if (r.workflowId && signalApproval) {
      try {
        await signalApproval(r.workflowId, claim.approvalId, decision);
      } catch (err) {
        req.log.warn({ err }, 'signal Temporal non délivré (repli par interrogation)');
      }
    }
    return reply.send({
      data: { status: r.approval.status, changed: r.changed },
      meta,
    });
  });
}
