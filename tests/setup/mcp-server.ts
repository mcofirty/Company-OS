import { createServer, type IncomingMessage } from 'node:http';
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

export async function startTestMcpServer(opts: { token?: string } = {}): Promise<TestMcpServer> {
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
  const http = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization;
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
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () => new Promise((r) => http.close(() => r())),
  };
}
