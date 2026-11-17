import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolError } from './adapters';

/**
 * Client MCP (Streamable HTTP) des connecteurs ajoutés par un administrateur (docs/05 §11).
 * Garde-fous : HTTPS obligatoire, adresses privées/locales refusées (anti-SSRF) sauf option
 * explicite (tests, réseau interne voulu), aucune redirection suivie, délais bornés, réponses
 * tronquées. Le jeton n'est jamais journalisé ni renvoyé.
 */
export interface McpEndpoint {
  url: string;
  /** En-têtes d'authentification déjà déchiffrés (gardés en mémoire le temps de l'appel). */
  headers: Record<string, string>;
  /** Autorise http:// et les adresses privées/locales (tests, serveur MCP interne voulu). */
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  /** Connecteur OAuth : jetons fournis (et renouvelés) par ce fournisseur. */
  authProvider?: OAuthClientProvider;
}

/**
 * fetch protégé : chaque requête (MCP, découverte OAuth, jeton) vise une adresse publique en
 * HTTPS (anti-SSRF), sans suivre de redirection vers une autre machine.
 */
export function safeFetch(allowPrivate = false): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    await assertSafeMcpUrl(url, allowPrivate);
    return fetch(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
}

export interface DiscoveredTool {
  remoteName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint: boolean;
}

const MAX_TOOLS = 200;
const MAX_OUTPUT_CHARS = 20_000;

const PRIVATE_V4: [number, number][] = [
  // [réseau, longueur de préfixe]
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 (CGNAT)
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 (lien local, métadonnées cloud)
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15
  [0xe0000000, 3], // multicast + réservé
];
function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    return PRIVATE_V4.some(([net, len]) => (n & ((~0 << (32 - len)) >>> 0)) >>> 0 === net >>> 0);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/** Vérifie l'URL d'un serveur MCP avant tout appel réseau. Lève VALIDATION_ERROR / SSRF_BLOCKED. */
export async function assertSafeMcpUrl(raw: string, allowPrivate = false): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError('VALIDATION_ERROR', false, 'URL invalide');
  }
  if (url.username || url.password) {
    throw new ToolError('VALIDATION_ERROR', false, 'Identifiants interdits dans l’URL');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    throw new ToolError('VALIDATION_ERROR', false, 'HTTPS obligatoire');
  }
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ToolError('SSRF_BLOCKED', false, 'Adresse locale refusée');
  }
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new ToolError('CONNECTOR_UNREACHABLE', true, 'Nom introuvable');
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ToolError('SSRF_BLOCKED', false, 'Adresse privée ou locale refusée');
  }
  return url;
}

function classify(err: unknown): ToolError {
  if (err instanceof ToolError) return err;
  if (err instanceof UnauthorizedError) {
    return new ToolError('CONNECTOR_AUTH', false, 'Connexion expirée : reconnecter l’application');
  }
  if (err instanceof StreamableHTTPError) {
    if (err.code === 401 || err.code === 403) {
      return new ToolError('CONNECTOR_AUTH', false, 'Authentification refusée par le serveur MCP');
    }
    if (err.code !== undefined && err.code >= 400 && err.code < 500) {
      return new ToolError('CONNECTOR_REJECTED', false, `Requête refusée (${err.code})`);
    }
  }
  const msg = err instanceof Error ? err.message : '';
  if (/401|unauthori[sz]ed|forbidden/i.test(msg)) {
    return new ToolError('CONNECTOR_AUTH', false, 'Authentification refusée par le serveur MCP');
  }
  if (/timed? ?out|timeout/i.test(msg)) return new ToolError('TIMEOUT', true, 'Délai dépassé');
  return new ToolError('CONNECTOR_UNREACHABLE', true, 'Serveur MCP injoignable');
}

async function withClient<T>(ep: McpEndpoint, fn: (c: Client) => Promise<T>): Promise<T> {
  const url = await assertSafeMcpUrl(ep.url, ep.allowPrivateNetwork);
  const common = {
    requestInit: { headers: ep.headers, redirect: 'error' as const },
    fetch: safeFetch(ep.allowPrivateNetwork),
    ...(ep.authProvider ? { authProvider: ep.authProvider } : {}),
  };
  const timeout = ep.timeoutMs ?? 20_000;
  // Serveurs anciens (SSE, ex. adresses en /sse) : transport SSE ; sinon Streamable HTTP, avec
  // repli SSE si le serveur ne le connaît pas (404 / 405).
  const sseFirst = /\/sse\/?$/.test(url.pathname);
  const attempt = async (sse: boolean): Promise<T> => {
    const transport = sse
      ? new SSEClientTransport(url, common)
      : new StreamableHTTPClientTransport(url, common);
    const client = new Client({ name: 'company-os', version: '1.0.0' });
    try {
      await client.connect(transport, { timeout });
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  };
  try {
    return await attempt(sseFirst);
  } catch (err) {
    if (!sseFirst && err instanceof StreamableHTTPError && (err.code === 404 || err.code === 405)) {
      try {
        return await attempt(true);
      } catch (e2) {
        throw classify(e2);
      }
    }
    throw classify(err);
  }
}

const asObjectSchema = (s: unknown): Record<string, unknown> =>
  s && typeof s === 'object' && (s as { type?: unknown }).type === 'object'
    ? (s as Record<string, unknown>)
    : { type: 'object', properties: {} };

/** Découverte des outils exposés par le serveur (paginée, bornée à 200). */
export async function discoverMcpTools(ep: McpEndpoint): Promise<DiscoveredTool[]> {
  return withClient(ep, async (c) => {
    const out: DiscoveredTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.listTools(cursor ? { cursor } : undefined, {
        timeout: ep.timeoutMs ?? 20_000,
      });
      for (const t of page.tools) {
        out.push({
          remoteName: t.name,
          title: (t.title ?? t.annotations?.title ?? t.name).slice(0, 80),
          description: (t.description ?? '').slice(0, 1000),
          inputSchema: asObjectSchema(t.inputSchema),
          readOnlyHint: t.annotations?.readOnlyHint === true,
        });
      }
      cursor = page.nextCursor;
    } while (cursor && out.length < MAX_TOOLS);
    return out.slice(0, MAX_TOOLS);
  });
}

export interface McpCallResult {
  text: string;
  isError: boolean;
  truncated: boolean;
}

/** Appel d'un outil distant ; le contenu texte (et structuré) est renvoyé tronqué. */
export async function callMcpTool(
  ep: McpEndpoint,
  remoteName: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  return withClient(ep, async (c) => {
    const r = await c.callTool({ name: remoteName, arguments: args }, undefined, {
      timeout: ep.timeoutMs ?? 20_000,
    });
    const parts: string[] = [];
    const content = Array.isArray(r.content)
      ? (r.content as { type: string; text?: string }[])
      : [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else parts.push(`[contenu ${block.type} non transmis]`);
    }
    if (r.structuredContent && parts.length === 0) parts.push(JSON.stringify(r.structuredContent));
    const full = parts.join('\n');
    return {
      text: full.slice(0, MAX_OUTPUT_CHARS),
      isError: r.isError === true,
      truncated: full.length > MAX_OUTPUT_CHARS,
    };
  });
}
