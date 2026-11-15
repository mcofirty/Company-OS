import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Db } from '../client';

const run = promisify(execFile);

/**
 * Connexion pour les outils PostgreSQL : le mot de passe passe par PGPASSWORD (jamais en argument
 * visible dans `ps`), et les paramètres propres à Prisma (?schema=…) sont retirés.
 */
export function pgConnection(databaseUrl: string): { dbUrl: string; env: NodeJS.ProcessEnv } {
  const u = new URL(databaseUrl);
  const password = decodeURIComponent(u.password);
  u.password = '';
  u.search = '';
  return { dbUrl: u.toString(), env: { ...process.env, PGPASSWORD: password } };
}

/** Sauvegarde complète au format custom (compressé, restaurable sélectivement). */
export async function backupDatabase(databaseUrl: string, file: string): Promise<void> {
  const { dbUrl, env } = pgConnection(databaseUrl);
  await run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`, `--dbname=${dbUrl}`],
    {
      env,
    },
  );
}

/**
 * Restauration dans une base EXISTANTE et vide (créée par l'opérateur) : jamais par-dessus la
 * base de production en place (procédure : restaurer à côté, vérifier, puis basculer).
 */
export async function restoreDatabase(databaseUrl: string, file: string): Promise<void> {
  const { dbUrl, env } = pgConnection(databaseUrl);
  await run(
    'pg_restore',
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
      `--dbname=${dbUrl}`,
      file,
    ],
    { env },
  );
}

export interface IntegrityReport {
  ok: boolean;
  orgs: {
    orgId: string;
    lastSeq: number;
    events: number;
    maxSeq: number;
    contiguous: boolean;
    outboxPending: number;
  }[];
  problems: string[];
}

/**
 * Contrôle d'intégrité du journal (après restauration ou incident) : pour chaque organisation,
 * séquence contiguë 1..N et compteur `last_seq` égal au dernier événement.
 */
export async function checkIntegrity(db: Db): Promise<IntegrityReport> {
  const rows = await db.$queryRaw<
    { org_id: string; last_seq: bigint; events: bigint; max_seq: bigint | null; pending: bigint }[]
  >`
    SELECT o.id AS org_id, o.last_seq,
           COUNT(e.seq) AS events, MAX(e.seq) AS max_seq,
           (SELECT COUNT(*) FROM outbox x WHERE x.org_id = o.id AND x.status = 'pending') AS pending
    FROM organizations o LEFT JOIN event_log e ON e.org_id = o.id
    GROUP BY o.id, o.last_seq ORDER BY o.id`;
  const problems: string[] = [];
  const orgs = rows.map((r) => {
    const events = Number(r.events);
    const maxSeq = Number(r.max_seq ?? 0);
    const lastSeq = Number(r.last_seq);
    const contiguous = events === maxSeq;
    if (!contiguous)
      problems.push(`${r.org_id} : séquence non contiguë (${events} événements, max ${maxSeq})`);
    if (lastSeq !== maxSeq)
      problems.push(`${r.org_id} : last_seq ${lastSeq} ≠ dernier événement ${maxSeq}`);
    return {
      orgId: r.org_id,
      lastSeq,
      events,
      maxSeq,
      contiguous,
      outboxPending: Number(r.pending),
    };
  });
  return { ok: problems.length === 0, orgs, problems };
}
