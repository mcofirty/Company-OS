import { createHash, timingSafeEqual } from 'node:crypto';
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
  /** Vrai uniquement si NODE_ENV ∈ {development,test} ET APP_MODE=demo ET aucun jeton configuré. */
  allowDevPrincipal: boolean;
  /**
   * Jeton d'accès administrateur (≥ 32 caractères) pour une API exposée (ex. Cloudflare Tunnel).
   * Quand il est défini, le principal de développement est désactivé : derrière un tunnel,
   * toutes les requêtes semblent venir de 127.0.0.1.
   */
  accessToken?: string;
}

export interface Credentials {
  remoteAddress: string | undefined;
  devRoleHeader: string | string[] | undefined;
  /** `Authorization: Bearer …` (HTTP) ou `auth.token` (Socket.IO). */
  bearer: string | undefined;
  /** Indices d'un proxy amont : présents => la requête ne vient pas vraiment de localhost. */
  forwarded: boolean;
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

/**
 * Résout le principal :
 * - jeton d'accès valide => administrateur de l'org démo (auth locale simple, docs/05 §9) ;
 * - sinon principal de développement, seulement en dev/démo, sans jeton configuré, depuis
 *   localhost et sans en-tête de proxy ; `X-Dev-Role` simule viewer/operator ;
 * - tout le reste : 401.
 */
export function resolvePrincipal(cfg: AuthConfig, c: Credentials): Principal {
  if (cfg.accessToken) {
    if (c.bearer && sameSecret(c.bearer, cfg.accessToken)) {
      return {
        userId: DEV_ADMIN.id,
        orgId: DEMO_ORG.id,
        role: 'admin',
        displayName: 'Administrateur (jeton)',
      };
    }
    throw new DomainError('UNAUTHORIZED', 'Jeton d’accès requis');
  }
  if (!cfg.allowDevPrincipal || c.forwarded || !isLocalAddress(c.remoteAddress)) {
    throw new DomainError('UNAUTHORIZED', 'Authentification requise');
  }
  const asked = typeof c.devRoleHeader === 'string' ? c.devRoleHeader : undefined;
  const role: Role = asked === 'viewer' || asked === 'operator' ? asked : 'admin';
  return { userId: DEV_ADMIN.id, orgId: DEMO_ORG.id, role, displayName: DEV_ADMIN.displayName };
}

const isForwarded = (h: Record<string, string | string[] | undefined>): boolean =>
  ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some((k) => h[k] !== undefined);

export function bearerOf(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}

export function principalOf(req: FastifyRequest, cfg: AuthConfig): Principal {
  return resolvePrincipal(cfg, {
    remoteAddress: req.socket.remoteAddress,
    devRoleHeader: req.headers['x-dev-role'],
    bearer: bearerOf(req.headers.authorization),
    forwarded: isForwarded(req.headers),
  });
}

export function principalOfHandshake(
  cfg: AuthConfig,
  hs: {
    address: string;
    headers: Record<string, string | string[] | undefined>;
    auth: Record<string, unknown>;
  },
): Principal {
  return resolvePrincipal(cfg, {
    remoteAddress: hs.address,
    devRoleHeader: hs.headers['x-dev-role'],
    bearer:
      typeof hs.auth['token'] === 'string'
        ? hs.auth['token']
        : bearerOf(hs.headers['authorization']),
    forwarded: isForwarded(hs.headers),
  });
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export function requireRole(p: Principal, min: Role): void {
  if (RANK[p.role] < RANK[min]) throw new DomainError('FORBIDDEN', `Rôle ${min} requis`);
}
