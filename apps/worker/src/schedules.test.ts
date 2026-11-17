import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentByAdmin,
  DEV_ADMIN,
  initLiveOrg,
  loadRunContext,
  nextOccurrence,
  runDueSchedules,
  saveSchedule,
  setAgentLifecycle,
  startNextTask,
} from '@company-os/db';
import { resetAndSeed, testDb } from '../../../tests/setup/helpers';

const db = testDb();
let orgId = '';
let agentId = '';
const admin = { kind: 'user', id: DEV_ADMIN.id } as const;

beforeEach(async () => {
  await resetAndSeed(db);
  ({ orgId } = await initLiveOrg(db, {
    name: 'Ma Société',
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: 5,
  }));
  ({ agentId } = await createAgentByAdmin(db, {
    orgId,
    actor: admin,
    req: {
      name: 'Iris',
      title: 'Directrice générale',
      departmentId: `${orgId.slice(0, 8)}-direction`,
      role: 'manager',
      grants: { company: ['status'] },
      goal: 'Piloter l’entreprise',
      instructions: 'Rapport hebdomadaire clair, chiffres sourcés.',
      monthlyBudgetUsd: 5,
      modelTier: 'quality',
      avatarId: 'avatar-02',
      skills: [],
      routines: [],
    },
  }));
});
afterAll(() => db.$disconnect());

describe('Missions récurrentes', () => {
  it('prochaine occurrence : fuseau de Paris, heure d’été/hiver, hebdo et mensuelle', () => {
    const tz = 'Europe/Paris';
    // Lundi 9 h à Paris : hiver = 08:00 UTC, été = 07:00 UTC.
    const weekly = { frequency: 'weekly' as const, hour: 9, minute: 0, weekday: 1, timezone: tz };
    expect(nextOccurrence(weekly, new Date('2026-11-18T12:00:00Z')).toISOString()).toBe(
      '2026-11-23T08:00:00.000Z',
    );
    expect(nextOccurrence(weekly, new Date('2026-07-01T12:00:00Z')).toISOString()).toBe(
      '2026-07-06T07:00:00.000Z',
    );
    // Juste avant / juste à l'échéance : strictement après.
    expect(nextOccurrence(weekly, new Date('2026-11-23T07:59:00Z')).toISOString()).toBe(
      '2026-11-23T08:00:00.000Z',
    );
    expect(nextOccurrence(weekly, new Date('2026-11-23T08:00:00Z')).toISOString()).toBe(
      '2026-11-30T08:00:00.000Z',
    );
    const daily = { frequency: 'daily' as const, hour: 18, minute: 30, timezone: tz };
    expect(nextOccurrence(daily, new Date('2026-11-18T20:00:00Z')).toISOString()).toBe(
      '2026-11-19T17:30:00.000Z',
    );
    const monthly = {
      frequency: 'monthly' as const,
      hour: 8,
      minute: 0,
      monthDay: 1,
      timezone: tz,
    };
    expect(nextOccurrence(monthly, new Date('2026-11-18T12:00:00Z')).toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    );
  });

  it('déclenchement : une mission par échéance, plafond de coût appliqué, idempotent', async () => {
    const now = new Date('2026-11-23T07:00:00Z');
    const s = await saveSchedule(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      now,
      req: {
        agentId,
        title: 'Rapport hebdomadaire',
        instructions: 'Fais le point de la semaine : missions, coûts, risques.',
        frequency: 'weekly',
        hour: 9,
        minute: 0,
        weekday: 1,
        timezone: 'Europe/Paris',
        maxCostUsd: 0.3,
        enabled: true,
      },
    });
    expect(s.nextRunAt).toBe('2026-11-23T08:00:00.000Z');
    expect(await runDueSchedules(db, new Date('2026-11-23T07:59:00Z'))).toEqual({
      triggered: 0,
      skipped: 0,
    });
    const at = new Date('2026-11-23T08:00:20Z');
    expect(await runDueSchedules(db, at)).toEqual({ triggered: 1, skipped: 0 });
    expect(await runDueSchedules(db, at)).toEqual({ triggered: 0, skipped: 0 }); // idempotent
    const task = await db.task.findFirstOrThrow({ where: { orgId, scheduleId: s.id } });
    expect(task).toMatchObject({ kind: 'custom', costCapMicros: 300_000, requesterType: 'system' });
    expect(task.title).toContain('Rapport hebdomadaire');
    const row = await db.schedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.nextRunAt.toISOString()).toBe('2026-11-30T08:00:00.000Z');
    expect(row.runCount).toBe(1);
    // Le run hérite du plafond de l'exécution.
    const started = (await startNextTask(db, orgId))!;
    expect((await loadRunContext(db, started.runId)).version.limits.maxCostMicros).toBe(300_000);
  });

  it('agent suspendu : occurrence sautée (tracée), aucune mission créée', async () => {
    const s = await saveSchedule(db, {
      orgId,
      actorId: DEV_ADMIN.id,
      now: new Date('2026-11-18T10:00:00Z'),
      req: {
        agentId,
        title: 'Veille du jour',
        instructions: 'Résume les nouvelles du secteur.',
        frequency: 'daily',
        hour: 18,
        minute: 0,
        timezone: 'Europe/Paris',
        maxCostUsd: 0.2,
        enabled: true,
      },
    });
    await setAgentLifecycle(db, {
      orgId,
      agentId,
      action: 'pause',
      reason: 'Congés',
      actor: admin,
    });
    expect(await runDueSchedules(db, new Date('2026-11-18T17:00:30Z'))).toEqual({
      triggered: 0,
      skipped: 1,
    });
    expect(await db.task.count({ where: { orgId, scheduleId: s.id } })).toBe(0);
    const ev = await db.eventLog.findFirstOrThrow({
      where: { orgId, type: 'schedule.updated' },
      orderBy: { seq: 'desc' },
    });
    expect(ev.payload).toMatchObject({ change: 'skipped' });
  });
});
