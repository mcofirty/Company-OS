import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { createDb, DEV_ADMIN, initLiveOrg } from '@company-os/db';

/**
 * Organisation live jetable pour les e2e (base de développement) :
 *   tsx tests/setup/live-fixture.ts create   -> imprime l'id
 *   tsx tests/setup/live-fixture.ts cleanup <orgId>  -> retire l'accès de l'admin local
 * L'organisation reste dans le journal (append-only) mais disparaît du sélecteur.
 */
config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
const db = createDb(process.env.DATABASE_URL!);
try {
  const [cmd, orgId] = process.argv.slice(2);
  if (cmd === 'create') {
    await db.user.upsert({ where: { id: DEV_ADMIN.id }, create: DEV_ADMIN, update: {} });
    const r = await initLiveOrg(db, {
      name: `E2E live ${randomUUID().slice(0, 6)}`,
      adminUserIds: [DEV_ADMIN.id],
      monthlyBudgetUsd: 1,
    });
    process.stdout.write(r.orgId);
  } else if (cmd === 'cleanup' && orgId) {
    await db.membership.deleteMany({ where: { orgId, userId: DEV_ADMIN.id } });
  } else {
    throw new Error('usage: create | cleanup <orgId>');
  }
} finally {
  await db.$disconnect();
}
