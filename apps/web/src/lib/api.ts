import { ApiErrorSchema } from '@company-os/contracts';
import { sessionToken } from './oidc';

const DEFAULT_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const STORAGE_KEY = 'companyos.backend';

/**
 * Backend ciblé par ce navigateur. Par défaut : variable de build. L'opérateur peut choisir
 * une autre API (ex. son PC exposé par un tunnel) et y joindre un jeton d'accès ; ce choix
 * reste dans CE navigateur (localStorage), jamais dans le bundle ni dans un dépôt.
 */
export interface BackendConfig {
  url: string;
  token: string | null;
  custom: boolean;
}

export function getBackend(): BackendConfig {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const v = JSON.parse(raw) as { url?: unknown; token?: unknown };
      if (typeof v.url === 'string' && v.url) {
        return {
          url: v.url.replace(/\/+$/, ''),
          token: typeof v.token === 'string' && v.token ? v.token : null,
          custom: true,
        };
      }
    }
  } catch {
    /* stockage indisponible : valeur par défaut */
  }
  return { url: DEFAULT_URL, token: null, custom: false };
}

export function setBackend(cfg: { url: string; token: string | null } | null): void {
  try {
    if (cfg) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignoré */
  }
}

/** Valide l'URL saisie : HTTPS obligatoire hors localhost. */
export function checkBackendUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
      return 'HTTPS requis (sauf localhost).';
    return null;
  } catch {
    return 'URL invalide.';
  }
}

const ORG_KEY = 'companyos.org';
/** Organisation choisie dans CE navigateur (démo par défaut). Le serveur vérifie l'adhésion. */
export function getOrg(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(ORG_KEY) : null;
  } catch {
    return null;
  }
}
export function setOrg(orgId: string | null): void {
  try {
    if (orgId) window.localStorage.setItem(ORG_KEY, orgId);
    else window.localStorage.removeItem(ORG_KEY);
  } catch {
    /* ignoré */
  }
}

/** Jeton à présenter à l'API : jeton d'accès saisi (tunnel) ou session OIDC de cet onglet. */
export function authToken(backend: BackendConfig = getBackend()): string | null {
  if (backend.token) return backend.token;
  return typeof window !== 'undefined' ? sessionToken(backend.url) : null;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** Appel API : déballe `{data, meta}` ou lève `{error:{code,message,requestId}}`. */
export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const backend = getBackend();
  const token = authToken(backend);
  const org = getOrg();
  const res = await fetch(`${backend.url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'x-org-id': org } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiFailure(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      );
    }
    throw new ApiFailure(res.status, 'INTERNAL_ERROR', `HTTP ${res.status}`);
  }
  return body as { data: T; meta: Record<string, unknown> };
}

/** POST JSON avec clé d'idempotence (un clic = une action). */
export function apiPost<T = unknown>(path: string, body: object = {}) {
  return api<T>(path, {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}
