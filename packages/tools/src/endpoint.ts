import { openSecret, sealSecret } from '@company-os/policies';
import { ToolError } from './adapters';
import type { McpEndpoint } from './mcp';
import { StoredOAuthProvider, type OAuthState } from './oauth';

/** Données d'un connecteur nécessaires à un appel (côté serveur uniquement). */
export interface ConnectorSecrets {
  url: string;
  urlSealed: string | null;
  oauthSealed: string | null;
  authKind: string;
  secretSealed: string | null;
  authHeader: string;
}

/**
 * Construit l'accès à un connecteur : adresse (déchiffrée si elle contient un secret), jeton
 * (en-tête) ou OAuth (jetons renouvelés automatiquement puis ré-enregistrés chiffrés).
 * Les secrets ne vivent qu'en mémoire le temps de l'appel.
 */
export function buildConnectorEndpoint(
  c: ConnectorSecrets,
  opts: {
    key: Buffer | null;
    allowPrivateNetwork: boolean;
    timeoutMs?: number;
    oauthRedirectUrl?: string;
    persistOAuth?: (sealed: string) => Promise<void>;
  },
): McpEndpoint {
  const needKey = c.urlSealed || c.oauthSealed || c.secretSealed;
  if (needKey && !opts.key) {
    throw new ToolError('CONNECTOR_SECRET_UNAVAILABLE', false, 'Clé de déchiffrement absente');
  }
  const key = opts.key as Buffer;
  const url = c.urlSealed ? openSecret(c.urlSealed, key) : c.url;
  const headers: Record<string, string> = {};
  if (c.secretSealed) {
    const token = openSecret(c.secretSealed, key);
    if (c.authHeader === 'authorization') headers['Authorization'] = `Bearer ${token}`;
    else headers[c.authHeader] = token;
  }
  let authProvider: StoredOAuthProvider | undefined;
  if (c.authKind === 'oauth' && c.oauthSealed) {
    const data = JSON.parse(openSecret(c.oauthSealed, key)) as OAuthState;
    authProvider = new StoredOAuthProvider(
      opts.oauthRedirectUrl ?? 'http://localhost/oauth/unused',
      data,
      async (s) => {
        await opts.persistOAuth?.(sealSecret(JSON.stringify(s), key));
      },
    );
  }
  return {
    url,
    headers,
    allowPrivateNetwork: opts.allowPrivateNetwork,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(authProvider ? { authProvider } : {}),
  };
}
