import { ApiErrorSchema } from '@company-os/contracts';

export const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

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
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
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
