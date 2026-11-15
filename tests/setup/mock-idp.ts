import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

/**
 * Fournisseur OIDC factice pour les tests (jamais utilisé en production) : découverte, JWKS,
 * autorisation (connexion automatique de l'utilisateur choisi) et échange de code PKCE S256.
 */
export interface MockIdp {
  issuer: string;
  audience: string;
  clientId: string;
  /** Sujet utilisé à la prochaine connexion via /authorize. */
  setLoginSubject(sub: string): void;
  mint(claims?: {
    sub?: string;
    aud?: string;
    iss?: string;
    expiresInSec?: number;
  }): Promise<string>;
  close(): Promise<void>;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

export async function startMockIdp(
  opts: {
    port?: number;
    audience?: string;
    clientId?: string;
  } = {},
): Promise<MockIdp> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const audience = opts.audience ?? 'company-os-api';
  const clientId = opts.clientId ?? 'company-os-web';
  let loginSubject = 'alice';
  const codes = new Map<string, { sub: string; challenge: string; redirectUri: string }>();
  let issuer = '';

  const mint: MockIdp['mint'] = async (c = {}) =>
    new SignJWT({ scope: 'openid profile email' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(c.iss ?? issuer)
      .setAudience(c.aud ?? audience)
      .setSubject(c.sub ?? loginSubject)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (c.expiresInSec ?? 600))
      .sign(privateKey);

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return json(204, {});
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const p = url.searchParams;
      if (p.get('client_id') !== clientId || p.get('code_challenge_method') !== 'S256') {
        return json(400, { error: 'invalid_request' });
      }
      const code = randomUUID();
      codes.set(code, {
        sub: loginSubject,
        challenge: p.get('code_challenge') ?? '',
        redirectUri: p.get('redirect_uri') ?? '',
      });
      const back = new URL(p.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', p.get('state') ?? '');
      back.searchParams.set('iss', issuer);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', (d: Buffer) => (body += d.toString()));
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const entry = codes.get(f.get('code') ?? '');
        const verifier = f.get('code_verifier') ?? '';
        const challenge = b64url(createHash('sha256').update(verifier).digest());
        if (
          !entry ||
          entry.challenge !== challenge ||
          entry.redirectUri !== f.get('redirect_uri')
        ) {
          return json(400, { error: 'invalid_grant' });
        }
        codes.delete(f.get('code') ?? '');
        void (async () => {
          const access = await mint({ sub: entry.sub });
          const id = await new SignJWT({ name: entry.sub })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(issuer)
            .setAudience(clientId)
            .setSubject(entry.sub)
            .setIssuedAt()
            .setExpirationTime('10m')
            .sign(privateKey);
          json(200, { access_token: access, id_token: id, token_type: 'Bearer', expires_in: 600 });
        })();
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get issuer() {
      return issuer;
    },
    audience,
    clientId,
    setLoginSubject: (s) => (loginSubject = s),
    mint,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
