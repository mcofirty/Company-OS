import { randomUUID } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { ToolError } from './adapters';
import { safeFetch } from './mcp';

/**
 * Connexion « Se connecter avec … » (OAuth 2.1 + PKCE + enregistrement dynamique, spécification
 * MCP). L'état (client enregistré, jetons, vérificateur PKCE) est persisté chiffré par l'appelant.
 */
export interface OAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

export class StoredOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly redirect: string,
    private readonly data: OAuthState,
    private readonly persist: (s: OAuthState) => Promise<void>,
    private readonly opts: { state?: string; onRedirect?: (url: URL) => void } = {},
  ) {}
  get redirectUrl(): string {
    return this.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Living HQ',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  state(): string {
    return this.opts.state ?? randomUUID();
  }
  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.data.clientInformation;
  }
  async saveClientInformation(ci: OAuthClientInformationMixed): Promise<void> {
    this.data.clientInformation = ci;
    await this.persist(this.data);
  }
  tokens(): OAuthTokens | undefined {
    return this.data.tokens;
  }
  async saveTokens(t: OAuthTokens): Promise<void> {
    this.data.tokens = t;
    await this.persist(this.data);
  }
  redirectToAuthorization(url: URL): void {
    // Pendant une mission, impossible d'ouvrir un navigateur : l'humain doit reconnecter l'app.
    if (!this.opts.onRedirect) {
      throw new ToolError('CONNECTOR_AUTH', false, 'Connexion expirée : reconnecter l’application');
    }
    this.opts.onRedirect(url);
  }
  async saveCodeVerifier(v: string): Promise<void> {
    this.data.codeVerifier = v;
    await this.persist(this.data);
  }
  codeVerifier(): string {
    if (!this.data.codeVerifier)
      throw new ToolError('CONNECTOR_AUTH', false, 'Session OAuth invalide');
    return this.data.codeVerifier;
  }
}

/** Étape 1 : découverte, enregistrement du client, URL d'autorisation à ouvrir dans le navigateur. */
export async function beginOAuth(input: {
  serverUrl: string;
  redirectUrl: string;
  state: string;
  allowPrivateNetwork?: boolean;
  persist: (s: OAuthState) => Promise<void>;
}): Promise<{ authorizationUrl: string }> {
  let target: URL | null = null;
  const provider = new StoredOAuthProvider(input.redirectUrl, {}, input.persist, {
    state: input.state,
    onRedirect: (u) => {
      target = u;
    },
  });
  try {
    const r = await auth(provider, {
      serverUrl: input.serverUrl,
      fetchFn: safeFetch(input.allowPrivateNetwork),
    });
    if (r !== 'REDIRECT' || !target) {
      throw new ToolError(
        'CONNECTOR_REJECTED',
        false,
        'Ce serveur ne propose pas de connexion OAuth',
      );
    }
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(
      'CONNECTOR_REJECTED',
      false,
      `Connexion OAuth impossible : ${e instanceof Error ? e.message.slice(0, 160) : 'erreur'}`,
    );
  }
  return { authorizationUrl: String(target) };
}

/** Étape 2 (retour du navigateur) : échange du code contre des jetons. */
export async function completeOAuth(input: {
  serverUrl: string;
  redirectUrl: string;
  code: string;
  data: OAuthState;
  allowPrivateNetwork?: boolean;
}): Promise<OAuthState> {
  const state: OAuthState = { ...input.data };
  const provider = new StoredOAuthProvider(input.redirectUrl, state, async () => undefined);
  try {
    const r = await auth(provider, {
      serverUrl: input.serverUrl,
      authorizationCode: input.code,
      fetchFn: safeFetch(input.allowPrivateNetwork),
    });
    if (r !== 'AUTHORIZED' || !state.tokens) throw new Error('jetons absents');
  } catch (e) {
    throw new ToolError(
      'CONNECTOR_AUTH',
      false,
      `Échange du code refusé : ${e instanceof Error ? e.message.slice(0, 160) : 'erreur'}`,
    );
  }
  delete state.codeVerifier;
  return state;
}
