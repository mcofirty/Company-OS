import { createDb } from './client';
import { purgeDemoData } from './services/purge';

/**
 * Supprime les organisations de démonstration et leurs données (production « réel uniquement »).
 *   pnpm --filter @company-os/db purge:demo
 * Sauvegarder la base avant (infra/deploy/update.sh le fait automatiquement).
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquant');
const db = createDb(url);
try {
  const r = await purgeDemoData(db);
  console.log(
    r.organizations === 0
      ? `Aucune organisation de démonstration. Outils fictifs retirés : ${r.tools}.`
      : `Démonstration retirée : ${r.organizations} organisation(s), ${r.agents} agent(s), ${r.events} événement(s), ${r.tools} outil(s) fictif(s).`,
  );
} finally {
  await db.$disconnect();
}
