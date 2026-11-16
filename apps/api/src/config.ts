import { z } from 'zod';
import type { AuthConfig } from './auth';
import { createOidcVerifier, type OidcSettings } from './oidc';

const blankToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);
const optional = <T extends z.ZodType>(t: T) => z.preprocess(blankToUndefined, t.optional());

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_MODE: z.enum(['demo', 'live']).default('demo'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('127.0.0.1'),
  /** Origines autorisées (CORS), séparées par des virgules. */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Jeton administrateur unique (usage personnel via tunnel). */
  API_ACCESS_TOKEN: optional(
    z.string().min(32, 'API_ACCESS_TOKEN doit faire au moins 32 caractères'),
  ),
  OIDC_ISSUER: optional(z.url()),
  OIDC_AUDIENCE: optional(z.string().min(1)),
  OIDC_CLIENT_ID: optional(z.string().min(1)),
  OIDC_SCOPE: z.string().default('openid profile email'),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(1200),
  /** Masque l'organisation de démonstration (serveur de production : données réelles seulement). */
  HIDE_DEMO_ORG: z.enum(['true', 'false']).default('false'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
});
export type Env = z.infer<typeof EnvSchema>;

export interface ApiConfig {
  env: Env;
  auth: AuthConfig;
  corsOrigin: string[];
}

/**
 * Valide la configuration au démarrage (docs/11 §3) et échoue fermé :
 * - OIDC : les trois variables ensemble ou aucune ;
 * - production : une authentification réelle est obligatoire (OIDC ou jeton), origines HTTPS
 *   uniquement, jamais de principal de développement ;
 * - APP_MODE=live : refusé tant que les connecteurs live ne sont pas implémentés.
 */
export function loadConfig(raw: Record<string, string | undefined>): ApiConfig {
  const env = EnvSchema.parse(raw);
  const problems: string[] = [];
  const oidcVars = [env.OIDC_ISSUER, env.OIDC_AUDIENCE, env.OIDC_CLIENT_ID];
  const oidcCount = oidcVars.filter(Boolean).length;
  if (oidcCount !== 0 && oidcCount !== 3) {
    problems.push('OIDC incomplet : OIDC_ISSUER, OIDC_AUDIENCE et OIDC_CLIENT_ID vont ensemble');
  }
  const corsOrigin = env.WEB_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (env.NODE_ENV === 'production') {
    if (oidcCount !== 3 && !env.API_ACCESS_TOKEN) {
      problems.push('Production : configurer OIDC (ou API_ACCESS_TOKEN pour un usage personnel)');
    }
    if (env.OIDC_ISSUER && !env.OIDC_ISSUER.startsWith('https://')) {
      problems.push('Production : OIDC_ISSUER doit être en HTTPS');
    }
    const insecure = corsOrigin.filter((o) => !o.startsWith('https://'));
    if (insecure.length > 0) {
      problems.push(`Production : origines non HTTPS refusées (${insecure.join(', ')})`);
    }
  }
  if (env.APP_MODE === 'live') {
    problems.push('APP_MODE=live non disponible : connecteurs réels et identités non configurés');
  }
  if (problems.length > 0) throw new Error(`Configuration refusée :\n- ${problems.join('\n- ')}`);

  const oidc: OidcSettings | undefined =
    oidcCount === 3
      ? {
          issuer: env.OIDC_ISSUER!,
          audience: env.OIDC_AUDIENCE!,
          clientId: env.OIDC_CLIENT_ID!,
          scope: env.OIDC_SCOPE,
        }
      : undefined;
  const authConfigured = !!oidc || !!env.API_ACCESS_TOKEN;
  return {
    env,
    corsOrigin,
    auth: {
      allowDevPrincipal:
        !authConfigured && env.NODE_ENV !== 'production' && env.APP_MODE === 'demo',
      ...(env.API_ACCESS_TOKEN ? { accessToken: env.API_ACCESS_TOKEN } : {}),
      ...(oidc ? { oidc: createOidcVerifier(oidc) } : {}),
    },
  };
}
