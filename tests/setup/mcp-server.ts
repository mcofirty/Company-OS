import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * Vrai serveur MCP (Streamable HTTP, sans état) pour les tests : deux outils, jeton optionnel.
 * Les appels reçus sont enregistrés pour vérifier qu'aucune action n'est exécutée sans droit.
 */
export interface TestMcpServer {
  url: string;
  calls: { name: string; args: Record<string, unknown>; auth: string | undefined }[];
  close: () => Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString('utf8')));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined);
      } catch (e) {
        reject(e);
      }
    });
  });

const readRaw = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString('utf8')));
    req.on('end', () => resolve(data));
  });
const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

/**
 * Serveur d'autorisation OAuth 2.1 minimal (spécification MCP) : métadonnées, enregistrement
 * dynamique, autorisation (consentement simulé : redirection immédiate), PKCE S256, jetons.
 */
function oauthRoutes(base: () => string, issued: Set<string>) {
  const challenges = new Map<string, string>();
  let n = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', base());
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(res, 200, { resource: `${base()}/mcp`, authorization_servers: [base()] });
      return true;
    }
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      json(res, 200, {
        issuer: base(),
        authorization_endpoint: `${base()}/authorize`,
        token_endpoint: `${base()}/token`,
        registration_endpoint: `${base()}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      return true;
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      const body = JSON.parse(await readRaw(req)) as Record<string, unknown>;
      json(res, 201, { ...body, client_id: 'client-test', client_id_issued_at: 1 });
      return true;
    }
    if (url.pathname === '/authorize') {
      const code = `code-${++n}`;
      challenges.set(code, url.searchParams.get('code_challenge') ?? '');
      const back = new URL(url.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: String(back) }).end();
      return true;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readRaw(req));
      if (form.get('grant_type') === 'authorization_code') {
        const expected = challenges.get(form.get('code') ?? '');
        const got = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (!expected || expected !== got) {
          json(res, 400, { error: 'invalid_grant' });
          return true;
        }
      }
      const at = `at-${++n}`;
      issued.add(at);
      json(res, 200, {
        access_token: at,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt-1',
      });
      return true;
    }
    return false;
  };
}

export async function startTestMcpServer(
  opts: { token?: string; oauth?: boolean } = {},
): Promise<TestMcpServer> {
  const calls: TestMcpServer['calls'] = [];
  const build = (auth: string | undefined): McpServer => {
    const s = new McpServer({ name: 'test-notes', version: '1.0.0' });
    s.registerTool(
      'search_notes',
      {
        description: 'Cherche dans les notes de l’équipe.',
        inputSchema: { query: z.string() },
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => {
        calls.push({ name: 'search_notes', args: { query }, auth });
        return {
          content: [
            { type: 'text', text: `1 note trouvée pour « ${query} » : Réunion lundi 10h.` },
          ],
        };
      },
    );
    s.registerTool(
      'create_ticket',
      {
        description: 'Crée un ticket dans le suivi (écriture).',
        inputSchema: { title: z.string(), priority: z.number().int().optional() },
      },
      async ({ title, priority }) => {
        calls.push({ name: 'create_ticket', args: { title, priority }, auth });
        return { content: [{ type: 'text', text: `Ticket créé : ${title}` }] };
      },
    );
    return s;
  };
  const issued = new Set<string>();
  let baseUrl = '';
  const oauth = opts.oauth ? oauthRoutes(() => baseUrl, issued) : null;
  const http = createServer((req, res) => {
    void (async () => {
      if (oauth && (await oauth(req, res))) return;
      const auth = req.headers.authorization;
      if (oauth && !issued.has((auth ?? '').replace(/^Bearer /, ''))) {
        res
          .writeHead(401, {
            'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
            'content-type': 'application/json',
          })
          .end('{"error":"unauthorized"}');
        return;
      }
      if (opts.token && auth !== `Bearer ${opts.token}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}');
        return;
      }
      const body = await readBody(req);
      const server = build(auth);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
  const port = (http.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => http.close(() => r())),
  };
}
