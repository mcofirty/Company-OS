'use client';

import * as oauth from 'oauth4webapi';

/**
 * Connexion OIDC du cockpit (docs/05 §9) : Authorization Code + PKCE S256, client public (aucun
 * secret dans le navigateur). Le jeton d'accès vit en sessionStorage (onglet courant, effacé à la
 * fermeture) et n'est envoyé qu'à l'API qui a publié la configuration. Pas de cookie => pas de
 * CSRF ; pas de jeton de rafraîchissement : à expiration, nouvelle connexion (ADR-035).
 */
export interface AuthPublicConfig {
  mode: 'oidc' | 'token' | 'dev';
  issuer?: string;
  clientId?: string;
  audience?: string;
  scope?: string;
}
interface Pending {
  verifier: string;
  state: string;
  api: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
}
interface Session {
  api: string;
  token: string;
  expiresAt: number;
}

const PENDING = 'companyos.oidc.pending';
const SESSION = 'companyos.oidc.session';

const read = <T>(key: string): T | null => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: unknown): void => {
  try {
    if (v === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage indisponible : la connexion ne survivra pas au rechargement */
  }
};

/** HTTP n'est toléré que pour un fournisseur local (tests, développement). */
const localIssuer = (issuer: string): boolean =>
  ['localhost', '127.0.0.1'].includes(new URL(issuer).hostname);

async function discover(issuer: string): Promise<oauth.AuthorizationServer> {
  const url = new URL(issuer);
  const insecure = localIssuer(issuer);
  const res = await oauth.discoveryRequest(url, {
    algorithm: 'oidc',
    ...(insecure ? { [oauth.allowInsecureRequests]: true } : {}),
  });
  return oauth.processDiscoveryResponse(url, res);
}

export async function fetchAuthConfig(apiUrl: string): Promise<AuthPublicConfig> {
  const res = await fetch(`${apiUrl}/auth/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { data: AuthPublicConfig }).data;
}

/** Jeton OIDC valide pour cette API, sinon null (expiré ou autre backend). */
export function sessionToken(apiUrl: string): string | null {
  const s = read<Session>(SESSION);
  if (!s || s.api !== apiUrl || Date.now() > s.expiresAt - 15_000) return null;
  return s.token;
}

export function logout(): void {
  write(SESSION, null);
  window.location.reload();
}

export async function startLogin(apiUrl: string, cfg: AuthPublicConfig): Promise<void> {
  if (cfg.mode !== 'oidc' || !cfg.issuer || !cfg.clientId) throw new Error('OIDC non configuré');
  const as = await discover(cfg.issuer);
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const redirectUri = `${window.location.origin}/`;
  write(PENDING, {
    verifier,
    state,
    api: apiUrl,
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    redirectUri,
  } satisfies Pending);
  const url = new URL(as.authorization_endpoint!);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scope ?? 'openid');
  url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // Certains fournisseurs n'émettent un JWT pour l'API que si l'audience est demandée.
  if (cfg.audience) url.searchParams.set('audience', cfg.audience);
  window.location.assign(url.toString());
}

/**
 * Au retour du fournisseur (`?code=…&state=…`) : vérifie l'état, échange le code avec le
 * vérificateur PKCE, mémorise le jeton puis nettoie l'URL. Sans retour en cours : ne fait rien.
 */
let completing: Promise<boolean> | null = null;
export function completeLogin(): Promise<boolean> {
  // Un seul échange par retour, même si l'effet React est rejoué (Strict Mode, remontage).
  completing ??= completeLoginOnce();
  return completing;
}

async function completeLoginOnce(): Promise<boolean> {
  const current = new URL(window.location.href);
  if (!current.searchParams.has('code') && !current.searchParams.has('error')) return false;
  const pending = read<Pending>(PENDING);
  write(PENDING, null);
  window.history.replaceState(null, '', current.pathname);
  if (!pending) return false;
  const as = await discover(pending.issuer);
  const client: oauth.Client = { client_id: pending.clientId };
  const params = oauth.validateAuthResponse(as, client, current, pending.state);
  const insecure = localIssuer(pending.issuer) ? { [oauth.allowInsecureRequests]: true } : {};
  const res = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    oauth.None(),
    params,
    pending.redirectUri,
    pending.verifier,
    insecure,
  );
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, res, {
    requireIdToken: false,
  });
  write(SESSION, {
    api: pending.api,
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 300) * 1000,
  } satisfies Session);
  return true;
}
