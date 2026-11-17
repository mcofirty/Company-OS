import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@company-os/db';
import { principalOf, requireRole } from '../auth';

/**
 * Sauvegardes et mises à jour du serveur (administrateur). L'API n'a AUCUN accès à Docker ni à la
 * base en dehors de son rôle : elle lit l'état publié par l'agent hôte (ops/status) et dépose des
 * demandes (ops/requests) que l'agent exécute (infra/deploy/host-agent.sh, chaque minute).
 */
const FILE_RE = /^companyos-\d{8}T\d{6}Z\.dump$/;
const RestoreSchema = z
  .object({
    file: z.string().regex(FILE_RE),
    /** Saisie explicite de l'administrateur : la restauration remplace les données actuelles. */
    confirm: z.literal('RESTAURER'),
  })
  .strict();

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function registerOps(app: FastifyInstance, opsDir: string | null): void {
  const status = (name: string) => (opsDir ? path.join(opsDir, 'status', name) : '');
  const request = async (body: Record<string, string>): Promise<void> => {
    if (!opsDir) throw new DomainError('CONFLICT', 'Agent serveur non installé (développement)');
    const dir = path.join(opsDir, 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`),
      JSON.stringify(body),
      { mode: 0o660 },
    );
  };

  app.get('/v1/ops', async (req) => {
    requireRole(principalOf(req), 'admin');
    if (!opsDir) return { data: { available: false } };
    const [agent, backups, job, update] = await Promise.all([
      readJson<{ seenAt: string; autoUpdate: boolean }>(status('agent.json')),
      readJson<{ file: string; size: number; createdAt: string }[]>(status('backups.json')),
      readJson<Record<string, string>>(status('job.json')),
      readJson<Record<string, string>>(status('update.json')),
    ]);
    // Agent vu il y a moins de 3 minutes : il traite les demandes.
    const online = !!agent && Date.now() - Date.parse(agent.seenAt) < 180_000;
    return {
      data: {
        available: !!agent,
        online,
        autoUpdate: agent?.autoUpdate ?? false,
        agentSeenAt: agent?.seenAt ?? null,
        backups: backups ?? [],
        job,
        update,
      },
    };
  });

  app.post('/v1/ops/backup', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    await request({ action: 'backup', requestedBy: p.userId });
    return reply.status(202).send({ data: { queued: true } });
  });

  app.post('/v1/ops/restore', async (req, reply) => {
    const p = principalOf(req);
    requireRole(p, 'admin');
    const body = RestoreSchema.parse(req.body);
    const list = await readJson<{ file: string }[]>(status('backups.json'));
    if (!list?.some((b) => b.file === body.file))
      throw new DomainError('NOT_FOUND', 'Sauvegarde introuvable');
    await request({ action: 'restore', file: body.file, requestedBy: p.userId });
    return reply.status(202).send({ data: { queued: true } });
  });
}
