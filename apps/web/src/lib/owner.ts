'use client';

import { ApiErrorSchema } from '@company-os/contracts';

/**
 * Session « propriétaire » (ADR-053) : obtenue par mot de passe + code du téléphone.
 * « Rester connecté » => localStorage (30 jours, survit à la fermeture du navigateur) ;
 * sinon sessionStorage (onglet courant, 12 h). Le jeton n'est envoyé qu'à l'API qui l'a émis.
 */
interface OwnerSession {
  api: string;
  token: string;
  expiresAt: number;
}
const KEY = 'companyos.owner.session';

const stores = (): Storage[] => {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
};

function readSession(): OwnerSession | null {
  for (const s of stores()) {
    try {
      const raw = s.getItem(KEY);
      if (raw) return JSON.parse(raw) as OwnerSession;
    } catch {
      /* stockage indisponible ou corrompu */
    }
  }
  return null;
}

export function ownerToken(apiUrl: string): string | null {
  const s = readSession();
  if (!s || s.api !== apiUrl || Date.now() > s.expiresAt - 15_000) return null;
  return s.token;
}

export function hasOwnerSession(apiUrl: string): boolean {
  return ownerToken(apiUrl) !== null;
}

export function ownerLogout(): void {
  for (const s of stores()) {
    try {
      s.removeItem(KEY);
    } catch {
      /* ignoré */
    }
  }
  window.location.reload();
}

export async function ownerLogin(
  apiUrl: string,
  input: { password: string; code: string; remember: boolean },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('Serveur injoignable. Vérifiez votre connexion internet.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : `Erreur ${res.status}`);
  }
  const data = (body as { data?: { token?: unknown; expiresAt?: unknown } } | null)?.data;
  if (typeof data?.token !== 'string' || typeof data.expiresAt !== 'number') {
    throw new Error('Réponse inattendue du serveur');
  }
  const session: OwnerSession = { api: apiUrl, token: data.token, expiresAt: data.expiresAt };
  const [local, tab] = stores();
  for (const s of stores()) s.removeItem(KEY);
  (input.remember ? local : tab)?.setItem(KEY, JSON.stringify(session));
}
