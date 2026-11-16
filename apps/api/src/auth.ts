import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEMO_ORG, DEV_ADMIN, DomainError, type Db } from '@company-os/db';
import type { OidcVerifier } from './oidc';

export type Role = 'admin' | 'operator' | 'viewer';
export interface Principal {
  userId: string;
  orgId: string;
  role: Role;
  displayName: string;
  /** Mode d'authentification ayant produit ce principal (audit, /v1/me). */
  via: 'oidc' | 'token' | 'dev';
}

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLocalAddress = (addr: string | undefined): boolean => !!addr && LOCAL.has(addr);

export interface AuthConfig {
  /** Vrai uniquement si NODE_ENV ∈ {development,test} ET APP_MODE=demo ET aucune auth configurée. */
  allowDevPrincipal: boolean;
  /**
   * Jeton d'accès administrateur unique (≥ 32 caractères), pour un usage personnel via tunnel.
   * Défini => le principal de développement est désactivé.
   */
  accessToken?: string;
  /** Production : jetons JWT d'un fournisseur OIDC, utilisateurs et rôles lus en base. */
  oidc?: OidcVerifier;
  /** Serveur de production : les organisations de démonstration sont masquées et refusées. */
  hideDemoOrg?: boolean;
}

export interface Credentials {
  remoteAddress: string | undefined;
  devRoleHeader: string | string[] | undefined;
  /** `Authorization: Bearer …` (HTTP) ou `auth.token` (Socket.IO). */
  bearer: string | undefined;
  /** Indices d'un proxy amont : présents => la requête ne vient pas vraiment de localhost. */
  forwarded: boolean;
  /** Org demandée (`X-Org-Id`) quand un utilisateur appartient à plusieurs organisations. */
  orgHeader: string | string[] | undefined;
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));
const looksLikeJwt = (t: string): boolean => t.split('.').length === 3;

/**
 * Résout le principal (docs/05 §9, docs/07 §2) :
 * 1. jeton d'accès configuré et identique => administrateur de l'org démo ;
 * 2. JWT OIDC valide (signature JWKS, iss, aud, exp) => utilisateur EXISTANT en base, rôle de son
 *    adhésion (aucune création de compte implicite : un inconnu reçoit 403) ;
 * 3. sinon principal de développement, seulement si aucune auth n'est configurée, en dev/démo,
 *    depuis localhost sans en-tête de proxy ; `X-Dev-Role` simule viewer/operator ;
 * 4. tout le reste : 401.
 */
export async function resolvePrincipal(
  cfg: AuthConfig,
  c: Credentials,
  db: Db,
): Promise<Principal> {
  const configured = !!cfg.accessToken || !!cfg.oidc;
  if (configured) {
    if (!c.bearer) throw new DomainError('UNAUTHORIZED', 'Authentification requise');
    if (cfg.accessToken && sameSecret(c.bearer, cfg.accessToken)) {
      return withOrgChoice(
        db,
        c.orgHeader,
        {
          userId: DEV_ADMIN.id,
          orgId: DEMO_ORG.id,
          role: 'admin',
          displayName: 'Administrateur (jeton)',
          via: 'token',
        },
        cfg.hideDemoOrg,
      );
    }
    if (cfg.oidc && looksLikeJwt(c.bearer)) {
      const id = await cfg.oidc.verify(c.bearer); // lève UNAUTHORIZED si invalide
      return principalFromDirectory(db, id.subject, c.orgHeader);
    }
    throw new DomainError('UNAUTHORIZED', 'Jeton invalide');
  }
  if (!cfg.allowDevPrincipal || c.forwarded || !isLocalAddress(c.remoteAddress)) {
    throw new DomainError('UNAUTHORIZED', 'Authentification requise');
  }
  const asked = typeof c.devRoleHeader === 'string' ? c.devRoleHeader : undefined;
  const role: Role = asked === 'viewer' || asked === 'operator' ? asked : 'admin';
  return withOrgChoice(
    db,
    c.orgHeader,
    {
      userId: DEV_ADMIN.id,
      orgId: DEMO_ORG.id,
      role,
      displayName: DEV_ADMIN.displayName,
      via: 'dev',
    },
    cfg.hideDemoOrg,
  );
}

/**
 * Administrateur local (jeton ou dev) : org démo par défaut ; `X-Org-Id` choisit une autre org
 * SEULEMENT s'il en est membre (ex. organisation live créée par `pnpm live:init`). Sinon 403.
 * Le rôle effectif ne dépasse jamais celui de l'adhésion.
 */
async function withOrgChoice(
  db: Db,
  orgHeader: string | string[] | undefined,
  base: Principal,
  hideDemo = false,
): Promise<Principal> {
  let wanted = typeof orgHeader === 'string' ? orgHeader : undefined;
  if (hideDemo) {
    // Démo masquée : organisation par défaut = première organisation live dont on est membre.
    // Une demande EXPLICITE de la démo est refusée plus bas (jamais remplacée en silence).
    if (!wanted) {
      const first = await db.membership.findFirst({
        where: { userId: base.userId, org: { mode: 'live' } },
        orderBy: { org: { createdAt: 'asc' } },
      });
      if (!first) {
        throw new DomainError('FORBIDDEN', 'Aucune organisation live : lancer pnpm live:init');
      }
      wanted = first.orgId;
    }
  } else if (!wanted || wanted === base.orgId) {
    return base;
  }
  const m = await db.membership.findFirst({
    where: { orgId: wanted, userId: base.userId },
    include: { org: true },
  });
  if (!m || (hideDemo && m.org.mode !== 'live')) {
    throw new DomainError('FORBIDDEN', 'Organisation non autorisée');
  }
  const rank = { viewer: 0, operator: 1, admin: 2 } as const;
  return { ...base, orgId: wanted, role: rank[m.role] < rank[base.role] ? m.role : base.role };
}

async function principalFromDirectory(
  db: Db,
  subject: string,
  orgHeader: string | string[] | undefined,
): Promise<Principal> {
  const user = await db.user.findUnique({
    where: { providerSubject: subject },
    include: { memberships: true },
  });
  if (!user || user.memberships.length === 0) {
    throw new DomainError('FORBIDDEN', 'Compte non autorisé sur cette plateforme');
  }
  const wanted = typeof orgHeader === 'string' ? orgHeader : undefined;
  const m = wanted
    ? user.memberships.find((x) => x.orgId === wanted)
    : user.memberships.length === 1
      ? user.memberships[0]
      : undefined;
  if (!m) {
    throw new DomainError(
      'FORBIDDEN',
      wanted ? 'Organisation non autorisée' : 'Plusieurs organisations : en-tête X-Org-Id requis',
    );
  }
  return {
    userId: user.id,
    orgId: m.orgId,
    role: m.role,
    displayName: user.displayName,
    via: 'oidc',
  };
}

const isForwarded = (h: Record<string, string | string[] | undefined>): boolean =>
  ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'].some((k) => h[k] !== undefined);

export function bearerOf(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1];
}

type AuthResult = { ok: true; principal: Principal } | { ok: false; error: unknown };
declare module 'fastify' {
  interface FastifyRequest {
    authResult: AuthResult | null;
  }
}

/**
 * Authentifie chaque requête /v1 une seule fois (avant les handlers). Le résultat (principal ou
 * erreur) est lu par `principalOf`, qui lève l'erreur au moment où la route l'exige.
 */
export function registerAuth(app: FastifyInstance, db: Db, cfg: AuthConfig): void {
  app.decorateRequest('authResult', null);
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/v1/')) return;
    try {
      const principal = await resolvePrincipal(
        cfg,
        {
          remoteAddress: req.socket.remoteAddress,
          devRoleHeader: req.headers['x-dev-role'],
          bearer: bearerOf(req.headers.authorization),
          forwarded: isForwarded(req.headers),
          orgHeader: req.headers['x-org-id'],
        },
        db,
      );
      req.authResult = { ok: true, principal };
    } catch (error) {
      req.authResult = { ok: false, error };
    }
  });
}

export function principalOf(req: FastifyRequest): Principal {
  const r = req.authResult;
  if (!r) throw new DomainError('UNAUTHORIZED', 'Authentification requise');
  if (!r.ok) throw r.error;
  return r.principal;
}

export function principalOfHandshake(
  cfg: AuthConfig,
  db: Db,
  hs: {
    address: string;
    headers: Record<string, string | string[] | undefined>;
    auth: Record<string, unknown>;
  },
): Promise<Principal> {
  return resolvePrincipal(
    cfg,
    {
      remoteAddress: hs.address,
      devRoleHeader: hs.headers['x-dev-role'],
      bearer:
        typeof hs.auth['token'] === 'string'
          ? hs.auth['token']
          : bearerOf(hs.headers['authorization']),
      forwarded: isForwarded(hs.headers),
      orgHeader: typeof hs.auth['orgId'] === 'string' ? hs.auth['orgId'] : hs.headers['x-org-id'],
    },
    db,
  );
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export function requireRole(p: Principal, min: Role): void {
  if (RANK[p.role] < RANK[min]) throw new DomainError('FORBIDDEN', `Rôle ${min} requis`);
}
