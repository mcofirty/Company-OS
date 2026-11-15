import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { createDb } from '../client';
import { backupDatabase, checkIntegrity, restoreDatabase } from './backup';

/**
 * Exploitation de la base (docs/11 §5) :
 *   pnpm db:backup                       -> backups/companyos-<horodatage>.dump
 *   pnpm db:restore --file X --target-url postgresql://…/base_vide --yes
 *   pnpm db:verify [--url …]             -> intégrité du journal d'événements
 */
config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' },
    out: { type: 'string', default: 'backups' },
    'target-url': { type: 'string' },
    url: { type: 'string' },
    yes: { type: 'boolean', default: false },
  },
});
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
const source = process.env.DATABASE_URL ?? fail('DATABASE_URL manquant');
const root = path.resolve(import.meta.dirname, '../../../..');

switch (positionals[0]) {
  case 'backup': {
    const dir = path.resolve(root, values.out);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `companyos-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
    await backupDatabase(source, file);
    console.log(`Sauvegarde écrite : ${file}`);
    break;
  }
  case 'restore': {
    const file = values.file ?? fail('--file requis');
    const target =
      values['target-url'] ?? fail('--target-url requis (base vide, pas la base en service)');
    if (target === source) fail('Refus : restaurer à côté de la base en service, puis basculer.');
    if (!values.yes) fail('Ajouter --yes pour confirmer la restauration dans la base cible.');
    await restoreDatabase(target, path.resolve(root, file));
    const db = createDb(target);
    const report = await checkIntegrity(db);
    await db.$disconnect();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(2);
    console.log('Restauration vérifiée.');
    break;
  }
  case 'verify': {
    const db = createDb(values.url ?? source);
    const report = await checkIntegrity(db);
    await db.$disconnect();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(2);
    break;
  }
  default:
    fail('Usage : backup | restore --file … --target-url … --yes | verify');
}
