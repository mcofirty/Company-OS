import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createDb } from './client';
import { DEV_ADMIN } from './seed-data';
import { initLiveOrg } from './services/live';
import { grantAccess } from './services/users';

/**
 * Crée l'organisation LIVE (séparée de la démo), sans agent :
 *   pnpm live:init --name "Mon entreprise" [--budget 5] [--admin-sub <sub OIDC>]
 * L'administrateur local (jeton / dev) en est membre ; un compte OIDC peut être ajouté.
 * Aucune exécution n'a lieu sans clé ANTHROPIC_API_KEY côté worker (échec fermé et visible).
 */
config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    budget: { type: 'string', default: '5' },
    'admin-sub': { type: 'string' },
  },
});
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
if (!values.name || values.name.trim().length < 2) {
  console.error('Usage : pnpm live:init --name "Mon entreprise" [--budget 5] [--admin-sub <sub>]');
  process.exit(1);
}
const budget = Number(values.budget);
if (!Number.isFinite(budget) || budget < 0.5 || budget > 500) {
  console.error('--budget : montant mensuel en USD entre 0,5 et 500');
  process.exit(1);
}
const db = createDb(url);
try {
  await db.user.upsert({ where: { id: DEV_ADMIN.id }, create: DEV_ADMIN, update: {} });
  const r = await initLiveOrg(db, {
    name: values.name.trim(),
    adminUserIds: [DEV_ADMIN.id],
    monthlyBudgetUsd: budget,
  });
  if (values['admin-sub']) {
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) throw new Error('OIDC_ISSUER manquant pour --admin-sub');
    await grantAccess(db, {
      orgId: r.orgId,
      subject: `${issuer}#${values['admin-sub']}`,
      displayName: values['admin-sub'],
      role: 'admin',
    });
  }
  console.log(
    `${r.created ? 'Organisation LIVE créée' : 'Organisation LIVE existante'} : ${values.name} (${r.orgId}).`,
  );
  console.log(
    process.env.ANTHROPIC_API_KEY
      ? 'Clé Anthropic détectée : les missions seront exécutées par Claude (budget plafonné).'
      : 'Aucune clé ANTHROPIC_API_KEY : les missions seront refusées (PROVIDER_UNAVAILABLE) jusqu’à son ajout.',
  );
} finally {
  await db.$disconnect();
}
