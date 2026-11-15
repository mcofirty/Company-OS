import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { comparable, foldAll, resetAndSeed, testDb } from '../../../tests/setup/helpers';
import { createDb } from './client';
import { createTask } from './services/tasks';
import { backupDatabase, checkIntegrity, restoreDatabase } from './ops/backup';
import { loadSnapshot } from './snapshot';
import { DEMO_ORG } from './seed-data';

const db = testDb();
const restoreUrl = (() => {
  const u = new URL(process.env.DATABASE_URL_TEST!);
  u.pathname = '/companyos_restore_test';
  return u.toString();
})();
const dir = mkdtempSync(path.join(tmpdir(), 'companyos-backup-'));

afterAll(async () => {
  await db.$executeRawUnsafe('DROP DATABASE IF EXISTS companyos_restore_test WITH (FORCE)');
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('M5 — sauvegarde et restauration (docs/11 §5 : tester la restauration)', () => {
  it('sauvegarde -> restauration dans une base vide -> même journal, même état, intégrité OK', async () => {
    await resetAndSeed(db);
    await createTask(db, {
      orgId: DEMO_ORG.id,
      kind: 'qualify_lead',
      requester: { kind: 'user', id: 'u' },
    });
    const before = (await loadSnapshot(db, DEMO_ORG.id))!;
    expect((await checkIntegrity(db)).ok).toBe(true);

    const file = path.join(dir, 'test.dump');
    await backupDatabase(process.env.DATABASE_URL_TEST!, file);
    expect(statSync(file).size).toBeGreaterThan(1000);

    await db.$executeRawUnsafe('DROP DATABASE IF EXISTS companyos_restore_test WITH (FORCE)');
    await db.$executeRawUnsafe('CREATE DATABASE companyos_restore_test');
    await restoreDatabase(restoreUrl, file);

    const restored = createDb(restoreUrl);
    try {
      const report = await checkIntegrity(restored);
      expect(report.ok).toBe(true);
      expect(report.orgs.find((o) => o.orgId === DEMO_ORG.id)?.lastSeq).toBe(before.lastSeq);
      const after = (await loadSnapshot(restored, DEMO_ORG.id))!;
      expect(comparable(after)).toEqual(comparable(before));
      // L'état restauré est toujours le rejeu exact de son journal.
      expect(comparable(await foldAll(restored, after))).toEqual(comparable(after));
    } finally {
      await restored.$disconnect();
    }
  });

  it('détecte un journal corrompu (trou de séquence)', async () => {
    await resetAndSeed(db);
    const hole = `SELECT id FROM event_log WHERE org_id = '${DEMO_ORG.id}' AND seq = 2`;
    await db.$executeRawUnsafe(`DELETE FROM alerts WHERE id IN (${hole})`);
    await db.$executeRawUnsafe(`DELETE FROM outbox WHERE event_id IN (${hole})`);
    await db.$executeRawUnsafe(`DELETE FROM event_log WHERE id IN (${hole})`);
    const report = await checkIntegrity(db);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/non contiguë/);
  });

  it('détecte un compteur last_seq incohérent', async () => {
    await resetAndSeed(db);
    await db.$executeRawUnsafe(
      `UPDATE organizations SET last_seq = last_seq + 3 WHERE id = '${DEMO_ORG.id}'`,
    );
    expect((await checkIntegrity(db)).problems.join(' ')).toMatch(/last_seq/);
  });
});
