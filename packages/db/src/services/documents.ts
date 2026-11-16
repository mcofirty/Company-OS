import { randomUUID } from 'node:crypto';
import { redactSecrets } from '@company-os/policies';
import type { Db } from '../client';
import { DomainError } from '../errors';

export interface DocumentView {
  id: string;
  title: string;
  agentId: string;
  taskId: string | null;
  createdAt: string;
  size: number;
}
const view = (d: {
  id: string;
  title: string;
  agentId: string;
  taskId: string | null;
  createdAt: Date;
  content: string;
}): DocumentView => ({
  id: d.id,
  title: d.title,
  agentId: d.agentId,
  taskId: d.taskId,
  createdAt: d.createdAt.toISOString(),
  size: d.content.length,
});

export const DOCUMENT_LIMITS = { title: 200, content: 200_000 } as const;

/**
 * Enregistre un document produit par un agent. Le contenu est débarrassé des secrets (clés, jetons, mots de passe)
 * avant stockage ; idempotent par identifiant (rejeu d'une invocation après reprise).
 */
export async function saveDocument(
  db: Db,
  input: {
    id?: string;
    orgId: string;
    agentId: string;
    taskId: string | null;
    title: string;
    content: string;
    now?: Date;
  },
): Promise<DocumentView> {
  const title = input.title.trim().slice(0, DOCUMENT_LIMITS.title);
  if (!title) throw new DomainError('VALIDATION_ERROR', 'Titre requis');
  if (input.content.length > DOCUMENT_LIMITS.content) {
    throw new DomainError('VALIDATION_ERROR', 'Document trop long (200 000 caractères maximum)');
  }
  const id = input.id ?? randomUUID();
  const row = await db.document.upsert({
    where: { id },
    create: {
      id,
      orgId: input.orgId,
      agentId: input.agentId,
      taskId: input.taskId,
      title: redactSecrets(title),
      content: redactSecrets(input.content),
      createdAt: input.now ?? new Date(),
    },
    update: {},
  });
  return view(row);
}

export async function listDocuments(
  db: Db,
  orgId: string,
  opts: { taskId?: string; query?: string; limit?: number } = {},
): Promise<DocumentView[]> {
  const q = opts.query && opts.query !== 'tout' ? opts.query : undefined;
  const rows = await db.document.findMany({
    where: {
      orgId,
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 50, 200),
  });
  return rows.map(view);
}

export async function getDocument(
  db: Db,
  orgId: string,
  id: string,
): Promise<DocumentView & { content: string }> {
  const row = await db.document.findFirst({ where: { id, orgId } });
  if (!row) throw new DomainError('NOT_FOUND', 'Document introuvable');
  return { ...view(row), content: row.content };
}
