import { randomUUID } from 'node:crypto';
import type { Db } from '../client';
import { DomainError } from '../errors';

export type MemberRole = 'admin' | 'operator' | 'viewer';

/**
 * Annuaire des humains (production OIDC) : un compte n'existe que s'il a été accordé
 * explicitement par un administrateur de la plateforme. Idempotent.
 */
export async function grantAccess(
  db: Db,
  input: { orgId: string; subject: string; displayName: string; role: MemberRole },
): Promise<{ userId: string; created: boolean }> {
  const org = await db.organization.findUnique({ where: { id: input.orgId } });
  if (!org) throw new DomainError('NOT_FOUND', 'Organisation introuvable');
  const existing = await db.user.findUnique({ where: { providerSubject: input.subject } });
  const user =
    existing ??
    (await db.user.create({
      data: { id: randomUUID(), providerSubject: input.subject, displayName: input.displayName },
    }));
  await db.membership.upsert({
    where: { orgId_userId: { orgId: input.orgId, userId: user.id } },
    create: { orgId: input.orgId, userId: user.id, role: input.role },
    update: { role: input.role },
  });
  return { userId: user.id, created: !existing };
}

export async function revokeAccess(
  db: Db,
  input: { orgId: string; subject: string },
): Promise<boolean> {
  const user = await db.user.findUnique({ where: { providerSubject: input.subject } });
  if (!user) return false;
  const r = await db.membership.deleteMany({ where: { orgId: input.orgId, userId: user.id } });
  return r.count > 0;
}

export async function listAccess(db: Db, orgId: string) {
  const rows = await db.membership.findMany({ where: { orgId }, include: { user: true } });
  return rows.map((m) => ({
    subject: m.user.providerSubject,
    displayName: m.user.displayName,
    role: m.role,
  }));
}
