import type { DomainEvent } from '@company-os/contracts';
import type { Db } from '../client';

/**
 * Notifications de l'organisation (téléphone via l'application ntfy, email facultatif).
 * Réglées par un administrateur ; l'adresse du sujet et le jeton sont chiffrés en base.
 * Contenu : titres et résumés courts, jamais de secret ni de contenu de document.
 */
export const NOTIFY_EVENTS = ['approval', 'completed', 'failed', 'schedule'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface NotificationView {
  configured: boolean;
  /** Hôte du serveur ntfy (le nom du sujet, secret, n'est jamais renvoyé). */
  server: string | null;
  email: string | null;
  events: NotifyEvent[];
  enabled: boolean;
  updatedAt: string | null;
}

export async function getNotificationSettings(db: Db, orgId: string): Promise<NotificationView> {
  const s = await db.notificationSetting.findUnique({ where: { orgId } });
  return {
    configured: !!s,
    server: s ? 'ntfy' : null,
    email: s?.email ?? null,
    events: (s?.events ?? ['approval', 'completed', 'failed']) as NotifyEvent[],
    enabled: s?.enabled ?? false,
    updatedAt: s?.updatedAt.toISOString() ?? null,
  };
}

export async function saveNotificationSettings(
  db: Db,
  input: {
    orgId: string;
    actorId: string;
    urlSealed?: string;
    tokenSealed?: string | null;
    email: string | null;
    events: NotifyEvent[];
    enabled: boolean;
  },
): Promise<void> {
  const prior = await db.notificationSetting.findUnique({ where: { orgId: input.orgId } });
  const urlSealed = input.urlSealed ?? prior?.urlSealed;
  if (!urlSealed) throw new Error('Adresse ntfy requise');
  const data = {
    urlSealed,
    tokenSealed: input.tokenSealed === undefined ? (prior?.tokenSealed ?? null) : input.tokenSealed,
    email: input.email,
    events: input.events,
    enabled: input.enabled,
    updatedBy: `user:${input.actorId}`,
    updatedAt: new Date(),
  };
  await db.notificationSetting.upsert({
    where: { orgId: input.orgId },
    create: { orgId: input.orgId, ...data },
    update: data,
  });
}

export interface NotificationMessage {
  title: string;
  message: string;
  priority: 3 | 4 | 5;
  tags: string[];
  kind: NotifyEvent;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Traduit un événement en notification (null si non notifié). Données lues en base. */
export async function notificationFor(db: Db, e: DomainEvent): Promise<NotificationMessage | null> {
  if (e.provenance !== 'live') return null;
  const agentName = async (id: string) =>
    (await db.agent.findUnique({ where: { id }, select: { name: true } }))?.name ?? id;
  const taskTitle = async (id: string) =>
    (await db.task.findUnique({ where: { id }, select: { title: true } }))?.title ?? 'mission';
  switch (e.type) {
    case 'approval.requested':
      return {
        kind: 'approval',
        title: `Validation requise · ${await agentName(e.payload.agentId)}`,
        message: clip(e.payload.riskReason, 220),
        priority: 5,
        tags: ['warning'],
      };
    case 'task.completed':
      return {
        kind: 'completed',
        title: `Mission terminée · ${await agentName(e.payload.agentId)}`,
        message: clip(`${await taskTitle(e.payload.taskId)} — ${e.payload.safeSummary}`, 300),
        priority: 3,
        tags: ['white_check_mark'],
      };
    case 'task.failed':
    case 'task.blocked':
      return {
        kind: 'failed',
        title: `Mission ${e.type === 'task.failed' ? 'échouée' : 'bloquée'} · ${await agentName(e.payload.agentId)}`,
        message: clip(`${await taskTitle(e.payload.taskId)} — ${e.payload.reasonCode}`, 300),
        priority: 4,
        tags: ['x'],
      };
    case 'schedule.updated':
      if (e.payload.change !== 'triggered' && e.payload.change !== 'skipped') return null;
      return {
        kind: 'schedule',
        title: `Mission récurrente ${e.payload.change === 'triggered' ? 'lancée' : 'sautée'}`,
        message: clip(`${e.payload.title} · ${await agentName(e.payload.agentId)}`, 200),
        priority: 3,
        tags: ['repeat'],
      };
    default:
      return null;
  }
}
