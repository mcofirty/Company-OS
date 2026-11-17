import { randomUUID } from 'node:crypto';
import type { ScheduleRequest } from '@company-os/contracts';
import type { Db } from '../client';
import { DomainError } from '../errors';
import { withOrgTx, type OrgTxContext } from '../events';
import { createTaskInTx } from './tasks';

/**
 * Missions récurrentes (rapports du DG, veille…) : un humain planifie, le worker déclenche.
 * Chaque exécution est une mission normale (tâche `custom`, budgets, validations, audit) avec un
 * plafond de coût propre. Une exécution manquée (serveur arrêté) n'est lancée qu'une fois au
 * redémarrage, jamais en rafale.
 */
export interface ScheduleSpec {
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  weekday?: number | null;
  monthDay?: number | null;
  timezone: string;
}

/** Décalage (minutes) du fuseau `tz` à l'instant `d` : heure locale = UTC + décalage. */
function tzOffsetMinutes(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** Instant UTC d'une heure locale (gère les changements d'heure). */
function localToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m, d, h, min);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const t1 = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(t1), tz);
  return new Date(guess - off2 * 60_000);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Prochaine occurrence STRICTEMENT après `after`. */
export function nextOccurrence(spec: ScheduleSpec, after: Date): Date {
  const off = tzOffsetMinutes(after, spec.timezone);
  const local = new Date(after.getTime() + off * 60_000); // champs UTC = heure locale
  for (let i = 0; i < 400; i++) {
    const day = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i),
    );
    const isoWeekday = ((day.getUTCDay() + 6) % 7) + 1; // 1 = lundi
    if (spec.frequency === 'weekly' && isoWeekday !== spec.weekday) continue;
    if (spec.frequency === 'monthly' && day.getUTCDate() !== spec.monthDay) continue;
    const at = localToUtc(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      spec.hour,
      spec.minute,
      spec.timezone,
    );
    if (at.getTime() > after.getTime()) return at;
  }
  throw new DomainError('VALIDATION_ERROR', 'Planification sans occurrence');
}

export interface ScheduleView {
  id: string;
  agentId: string;
  title: string;
  instructions: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  weekday: number | null;
  monthDay: number | null;
  timezone: string;
  maxCostUsd: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastTaskId: string | null;
  runCount: number;
}

type Row = Awaited<ReturnType<Db['schedule']['findFirstOrThrow']>>;
const view = (s: Row): ScheduleView => ({
  id: s.id,
  agentId: s.agentId,
  title: s.title,
  instructions: s.instructions,
  frequency: s.frequency as ScheduleView['frequency'],
  hour: s.hour,
  minute: s.minute,
  weekday: s.weekday,
  monthDay: s.monthDay,
  timezone: s.timezone,
  maxCostUsd: s.maxCostMicros / 1_000_000,
  enabled: s.enabled,
  nextRunAt: s.nextRunAt.toISOString(),
  lastRunAt: s.lastRunAt?.toISOString() ?? null,
  lastTaskId: s.lastTaskId,
  runCount: s.runCount,
});

function emitSchedule(
  ctx: OrgTxContext,
  actor: { kind: 'user' | 'system'; id: string },
  s: { id: string; agentId: string; title: string; nextRunAt: Date | null },
  change: 'created' | 'updated' | 'paused' | 'resumed' | 'deleted' | 'triggered' | 'skipped',
  taskId: string | null = null,
): void {
  ctx.emit({
    classification: 'internal',
    aggregateType: 'schedule',
    aggregateId: s.id,
    aggregateVersion: 1,
    correlationId: randomUUID(),
    causationId: null,
    actor,
    provenance: ctx.mode,
    type: 'schedule.updated',
    payload: {
      scheduleId: s.id,
      agentId: s.agentId,
      title: s.title.slice(0, 120),
      change,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      taskId,
    },
  });
}

export async function listSchedules(db: Db, orgId: string, agentId?: string) {
  const rows = await db.schedule.findMany({
    where: { orgId, deletedAt: null, ...(agentId ? { agentId } : {}) },
    orderBy: { nextRunAt: 'asc' },
  });
  return rows.map(view);
}

/** Création ou modification d'une planification (administrateur). */
export async function saveSchedule(
  db: Db,
  input: { orgId: string; actorId: string; id?: string; req: ScheduleRequest; now?: Date },
): Promise<ScheduleView> {
  const now = input.now ?? new Date();
  const { req } = input;
  if (!isValidTimezone(req.timezone)) throw new DomainError('VALIDATION_ERROR', 'Fuseau inconnu');
  const { result } = await withOrgTx(db, input.orgId, now, async (ctx) => {
    if (ctx.mode !== 'live') {
      throw new DomainError('POLICY_DENIED', 'Missions récurrentes : organisations live');
    }
    const agent = await ctx.tx.agent.findFirst({
      where: { id: req.agentId, orgId: ctx.orgId, deletedAt: null },
    });
    if (!agent) throw new DomainError('NOT_FOUND', 'Agent introuvable');
    const count = await ctx.tx.schedule.count({
      where: { orgId: ctx.orgId, deletedAt: null },
    });
    if (!input.id && count >= 50) {
      throw new DomainError('CONFLICT', 'Maximum 50 missions récurrentes');
    }
    const spec: ScheduleSpec = {
      frequency: req.frequency,
      hour: req.hour,
      minute: req.minute,
      weekday: req.frequency === 'weekly' ? (req.weekday ?? null) : null,
      monthDay: req.frequency === 'monthly' ? (req.monthDay ?? null) : null,
      timezone: req.timezone,
    };
    const data = {
      agentId: agent.id,
      title: req.title,
      instructions: req.instructions,
      frequency: spec.frequency,
      hour: spec.hour,
      minute: spec.minute,
      weekday: spec.weekday ?? null,
      monthDay: spec.monthDay ?? null,
      timezone: spec.timezone,
      maxCostMicros: Math.round(req.maxCostUsd * 1_000_000),
      enabled: req.enabled,
      nextRunAt: nextOccurrence(spec, now),
    };
    let row: Row;
    if (input.id) {
      const prior = await ctx.tx.schedule.findFirst({
        where: { id: input.id, orgId: ctx.orgId, deletedAt: null },
      });
      if (!prior) throw new DomainError('NOT_FOUND', 'Mission récurrente introuvable');
      row = await ctx.tx.schedule.update({ where: { id: prior.id }, data });
      const change = prior.enabled === row.enabled ? 'updated' : row.enabled ? 'resumed' : 'paused';
      emitSchedule(ctx, { kind: 'user', id: input.actorId }, row, change);
    } else {
      row = await ctx.tx.schedule.create({
        data: { id: randomUUID(), orgId: ctx.orgId, createdBy: `user:${input.actorId}`, ...data },
      });
      emitSchedule(ctx, { kind: 'user', id: input.actorId }, row, 'created');
    }
    return view(row);
  });
  return result;
}

export async function deleteSchedule(
  db: Db,
  input: { orgId: string; actorId: string; id: string },
): Promise<void> {
  await withOrgTx(db, input.orgId, new Date(), async (ctx) => {
    const s = await ctx.tx.schedule.findFirst({
      where: { id: input.id, orgId: ctx.orgId, deletedAt: null },
    });
    if (!s) throw new DomainError('NOT_FOUND', 'Mission récurrente introuvable');
    await ctx.tx.schedule.update({
      where: { id: s.id },
      data: { deletedAt: ctx.now, enabled: false },
    });
    emitSchedule(ctx, { kind: 'user', id: input.actorId }, { ...s, nextRunAt: null }, 'deleted');
  });
}

/**
 * Déclenche les planifications échues (appelé toutes les 30 s par le worker). Idempotent :
 * clé `schedule:<id>:<échéance>`. Agent suspendu, désactivé ou supprimé : occurrence sautée.
 * `runNow` (bouton « Lancer maintenant ») déclenche une exécution sans changer l'échéance.
 */
export async function runDueSchedules(
  db: Db,
  now = new Date(),
  opts: { only?: string; runNow?: boolean; actorId?: string } = {},
): Promise<{ triggered: number; skipped: number }> {
  const due = await db.schedule.findMany({
    where: opts.only
      ? { id: opts.only, deletedAt: null }
      : { enabled: true, deletedAt: null, nextRunAt: { lte: now } },
    select: { id: true, orgId: true },
    take: 100,
  });
  let triggered = 0;
  let skipped = 0;
  for (const d of due) {
    await withOrgTx(db, d.orgId, now, async (ctx) => {
      const s = await ctx.tx.schedule.findUnique({ where: { id: d.id } });
      if (!s || s.deletedAt) return;
      if (!opts.runNow && (!s.enabled || s.nextRunAt > now)) return; // déjà traité
      const actor = opts.actorId
        ? { kind: 'user' as const, id: opts.actorId }
        : { kind: 'system' as const, id: `schedule:${s.id}` };
      const next = opts.runNow ? s.nextRunAt : nextOccurrence(s as ScheduleSpec, now);
      const agent = await ctx.tx.agent.findFirst({
        where: { id: s.agentId, orgId: ctx.orgId, deletedAt: null },
      });
      if (!agent || agent.status !== 'active' || ctx.mode !== 'live') {
        await ctx.tx.schedule.update({ where: { id: s.id }, data: { nextRunAt: next } });
        emitSchedule(ctx, actor, { ...s, nextRunAt: next }, 'skipped');
        skipped++;
        return;
      }
      const stamp = opts.runNow ? `now:${now.toISOString()}` : s.nextRunAt.toISOString();
      const label = new Intl.DateTimeFormat('fr-FR', {
        timeZone: s.timezone,
        dateStyle: 'short',
      }).format(now);
      const { task } = await createTaskInTx(ctx, {
        kind: 'custom',
        agentId: agent.id,
        mission: {
          title: `${s.title} — ${label}`.slice(0, 120),
          instructions: s.instructions,
        },
        requester: actor,
        idempotencyKey: `schedule:${s.id}:${stamp}`,
        causationId: null,
        costCapMicros: s.maxCostMicros,
        scheduleId: s.id,
      });
      await ctx.tx.schedule.update({
        where: { id: s.id },
        data: {
          nextRunAt: next,
          lastRunAt: now,
          lastTaskId: task.id,
          runCount: { increment: 1 },
        },
      });
      emitSchedule(ctx, actor, { ...s, nextRunAt: next }, 'triggered', task.id);
      triggered++;
    });
  }
  return { triggered, skipped };
}
