import type { DomainEvent } from '@company-os/contracts';
import type { Db } from '../client';

/**
 * Notifications de l'organisation (téléphone via l'application ntfy, email facultatif).
 * Réglées par un administrateur ; l'adresse du sujet et le jeton sont chiffrés en base.
 * Contenu : titres et résumés courts, jamais de secret ni de contenu de document.
 */
export const NOTIFY_EVENTS = ['approval', 'completed', 'failed', 'schedule', 'daily'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface NotificationView {
  configured: boolean;
  /** Hôte du serveur ntfy (le nom du sujet, secret, n'est jamais renvoyé). */
  server: string | null;
  email: string | null;
  events: NotifyEvent[];
  enabled: boolean;
  /** Rapport du matin : heure locale (0-23) et fuseau horaire. */
  dailyHour: number;
  timezone: string;
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
    dailyHour: s?.dailyHour ?? 8,
    timezone: s?.timezone ?? 'Europe/Paris',
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
    dailyHour?: number;
    timezone?: string;
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
    ...(input.dailyHour !== undefined ? { dailyHour: input.dailyHour } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
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
  /** Validation : boutons « Valider / Refuser » dans la notification (liens signés). */
  approval?: { id: string; deadlineAt: string };
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
        approval: {
          id: e.payload.approvalId,
          deadlineAt: e.payload.deadlineAt,
        },
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

/** Heure et date locales d'un instant dans un fuseau (sans dépendance). */
function localParts(d: Date, timeZone: string): { hour: number; day: string } {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return { hour: Number(get('hour')), day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Organisations dont le rapport du matin est dû (heure atteinte, pas encore envoyé aujourd'hui). */
export async function dueDailyReports(db: Db, now = new Date()): Promise<string[]> {
  const rows = await db.notificationSetting.findMany({
    where: { enabled: true, events: { has: 'daily' } },
  });
  return rows
    .filter((s) => {
      let tz = s.timezone;
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
      } catch {
        tz = 'Europe/Paris';
      }
      const cur = localParts(now, tz);
      if (cur.hour < s.dailyHour) return false;
      return !s.lastDailyAt || localParts(s.lastDailyAt, tz).day !== cur.day;
    })
    .map((s) => s.orgId);
}

export async function markDailySent(db: Db, orgId: string, now = new Date()): Promise<void> {
  await db.notificationSetting.update({ where: { orgId }, data: { lastDailyAt: now } });
}

const usdText = (micros: number): string => `${(micros / 1e6).toFixed(2).replace('.', ',')} $`;

/** Rapport du matin : activité réelle des dernières 24 h (aucune donnée inventée). */
export async function dailyReport(
  db: Db,
  orgId: string,
  now = new Date(),
): Promise<NotificationMessage> {
  const since = new Date(now.getTime() - 86_400_000);
  const [done, failed, docs, runs, pending, running] = await Promise.all([
    db.task.count({ where: { orgId, status: 'succeeded', endedAt: { gte: since } } }),
    db.task.count({
      where: { orgId, status: { in: ['failed', 'blocked'] }, endedAt: { gte: since } },
    }),
    db.document.findMany({
      where: { orgId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { title: true },
      take: 3,
    }),
    db.agentRun.aggregate({
      where: { orgId, startedAt: { gte: since } },
      _sum: { costMicros: true },
    }),
    db.approvalRequest.count({ where: { orgId, status: 'pending' } }),
    db.task.count({ where: { orgId, status: { in: ['queued', 'running', 'waiting_approval'] } } }),
  ]);
  const docCount = await db.document.count({ where: { orgId, createdAt: { gte: since } } });
  const lines = [
    `✅ ${done} mission(s) terminée(s)${failed ? ` · ⚠️ ${failed} bloquée(s)` : ''}`,
    `📄 ${docCount} livrable(s)${docs.length ? ` : ${docs.map((d) => clip(d.title, 40)).join(' · ')}` : ''}`,
    `💶 Coût IA : ${usdText(runs._sum.costMicros ?? 0)}`,
    pending ? `⏳ ${pending} validation(s) t’attendent` : '👍 Aucune validation en attente',
    running ? `🔄 ${running} mission(s) en cours` : '',
  ].filter(Boolean);
  return {
    kind: 'daily',
    title: 'Ton QG ce matin (dernières 24 h)',
    message: clip(lines.join('\n'), 900),
    priority: pending ? 4 : 3,
    tags: ['sunrise'],
  };
}
