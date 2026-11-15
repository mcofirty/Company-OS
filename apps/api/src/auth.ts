import type { FastifyRequest } from 'fastify';
import { DEMO_ORG, DEV_ADMIN, DomainError } from '@company-os/db';

export type Role = 'admin' | 'operator' | 'viewer';
export interface Principal {
  userId: string;
  orgId: string;
  role: Role;
  displayName: string;
}

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLocalAddress = (addr: string | undefined): boolean => !!addr && LOCAL.has(addr);

export interface AuthConfig {
  /** Vrai uniquement si NODE_ENV ∈ {development,test} ET APP_MODE=demo (docs/07 §2). */
  allowDevPrincipal: boolean;
}

/**
 * Résout le principal. MVP : principal de développement local, refusé hors démo, hors
 * développement et hors localhost. `X-Dev-Role` permet de simuler viewer/operator en dev.
 * Aucun autre mode d'authentification n'existe encore : tout le reste reçoit 401.
 */
export function resolvePrincipal(
  cfg: AuthConfig,
  remoteAddress: string | undefined,
  devRoleHeader: string | string[] | undefined,
): Principal {
  if (!cfg.allowDevPrincipal || !isLocalAddress(remoteAddress)) {
    throw new DomainError('UNAUTHORIZED', 'Authentification requise');
  }
  const asked = typeof devRoleHeader === 'string' ? devRoleHeader : undefined;
  const role: Role = asked === 'viewer' || asked === 'operator' ? asked : 'admin';
  return { userId: DEV_ADMIN.id, orgId: DEMO_ORG.id, role, displayName: DEV_ADMIN.displayName };
}

export function principalOf(req: FastifyRequest, cfg: AuthConfig): Principal {
  return resolvePrincipal(cfg, req.socket.remoteAddress, req.headers['x-dev-role']);
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export function requireRole(p: Principal, min: Role): void {
  if (RANK[p.role] < RANK[min]) throw new DomainError('FORBIDDEN', `Rôle ${min} requis`);
}
