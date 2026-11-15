import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { DomainError } from '@company-os/db';

export interface OidcSettings {
  /** URL de l'émetteur (`iss`), ex. https://login.example.com/realms/acme */
  issuer: string;
  /** Audience attendue dans le jeton d'accès (identifiant de l'API chez le fournisseur). */
  audience: string;
  /** Identifiant public du client web (PKCE, sans secret) : publié par /auth/config. */
  clientId: string;
  scope: string;
}

export interface OidcVerifier {
  settings: OidcSettings;
  /** Vérifie signature (JWKS), iss, aud, exp/nbf. Renvoie le sujet stable `iss#sub`. */
  verify(token: string): Promise<{ subject: string }>;
}

/** Sujet stocké dans users.provider_subject : lié à l'émetteur pour éviter toute collision. */
export const oidcSubject = (issuer: string, sub: string): string => `${issuer}#${sub}`;

const ALGS = ['RS256', 'PS256', 'ES256', 'EdDSA'];

/**
 * Vérificateur de jetons d'accès JWT (l'API est un « resource server »). Les clés publiques sont
 * découvertes via `/.well-known/openid-configuration` puis mises en cache par jose (rotation gérée).
 * Les jetons opaques ne sont pas acceptés (ADR-034).
 */
export function createOidcVerifier(
  settings: OidcSettings,
  deps: { fetchImpl?: typeof fetch } = {},
): OidcVerifier {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let keys: Promise<JWTVerifyGetKey> | null = null;
  const loadKeys = async (): Promise<JWTVerifyGetKey> => {
    const url = `${settings.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Découverte OIDC impossible (${res.status})`);
    const meta = (await res.json()) as { issuer?: string; jwks_uri?: string };
    if (meta.issuer !== settings.issuer || !meta.jwks_uri) {
      throw new Error('Métadonnées OIDC incohérentes (issuer/jwks_uri)');
    }
    return createRemoteJWKSet(new URL(meta.jwks_uri), { cacheMaxAge: 10 * 60_000 });
  };
  return {
    settings,
    async verify(token) {
      keys ??= loadKeys().catch((err: unknown) => {
        keys = null; // réessayer à la prochaine requête
        throw err;
      });
      try {
        const { payload } = await jwtVerify(token, await keys, {
          issuer: settings.issuer,
          audience: settings.audience,
          algorithms: ALGS,
          clockTolerance: 30,
          requiredClaims: ['sub', 'exp'],
        });
        return { subject: oidcSubject(settings.issuer, payload.sub!) };
      } catch (err) {
        if (err instanceof errors.JOSEError) {
          throw new DomainError(
            'UNAUTHORIZED',
            err instanceof errors.JWTExpired ? 'Jeton expiré' : 'Jeton invalide',
          );
        }
        throw err;
      }
    },
  };
}
