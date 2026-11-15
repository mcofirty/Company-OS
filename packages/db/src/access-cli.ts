import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createDb } from './client';
import { DEMO_ORG } from './seed-data';
import { grantAccess, listAccess, revokeAccess, type MemberRole } from './services/users';

/**
 * Gestion des accès humains (OIDC) :
 *   pnpm users grant  --sub <sub OIDC> --name "Prénom Nom" --role admin|operator|viewer
 *   pnpm users revoke --sub <sub OIDC>
 *   pnpm users list
 * Le sujet stocké est `${OIDC_ISSUER}#${sub}` (lié à l'émetteur).
 */
config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sub: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'viewer' },
    org: { type: 'string', default: DEMO_ORG.id },
  },
});
const command = positionals[0];
const url = process.env.DATABASE_URL;
const issuer = process.env.OIDC_ISSUER;
if (!url) throw new Error('DATABASE_URL manquant');
const db = createDb(url);
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
try {
  if (command === 'list') {
    console.table(await listAccess(db, values.org));
  } else if (command === 'grant' || command === 'revoke') {
    if (!issuer) fail('OIDC_ISSUER manquant dans .env');
    if (!values.sub) fail('--sub requis');
    const subject = `${issuer}#${values.sub}`;
    if (command === 'grant') {
      const role = values.role as MemberRole;
      if (!['admin', 'operator', 'viewer'].includes(role)) fail('--role admin|operator|viewer');
      if (!values.name) fail('--name requis');
      const r = await grantAccess(db, {
        orgId: values.org,
        subject,
        displayName: values.name!,
        role,
      });
      console.log(
        `Accès ${role} accordé à ${values.name} (${r.created ? 'nouveau compte' : 'compte existant'}).`,
      );
    } else {
      console.log(
        (await revokeAccess(db, { orgId: values.org, subject }))
          ? 'Accès révoqué.'
          : 'Aucun accès trouvé.',
      );
    }
  } else {
    fail('Usage : pnpm users grant|revoke|list [--sub …] [--name …] [--role …]');
  }
} finally {
  await db.$disconnect();
}
