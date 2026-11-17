import type { DomainEvent } from '@company-os/contracts';
import {
  notificationFor,
  type Db,
  type NotificationMessage,
  type NotifyEvent,
} from '@company-os/db';
import { openSecret } from '@company-os/policies';
import { assertSafeMcpUrl } from '@company-os/tools';

/**
 * Envoi des notifications (ntfy : application téléphone, email facultatif). Appelé après la
 * diffusion temps réel des événements ; jamais bloquant, jamais de secret dans les logs.
 * Garde-fous : HTTPS public (anti-SSRF), sans redirection, 60 notifications / heure / org.
 */
export interface Notifier {
  handle(events: DomainEvent[]): void;
  send(orgId: string, msg: NotificationMessage): Promise<void>;
}

const HOUR = 3600_000;

export function createNotifier(
  db: Db,
  cfg: {
    secretKey: Buffer | null;
    allowPrivateNetwork: boolean;
    webOrigin: string;
    log: (msg: string, extra?: Record<string, unknown>) => void;
    fetchImpl?: typeof fetch;
  },
): Notifier {
  const doFetch = cfg.fetchImpl ?? fetch;
  const sent = new Map<string, number[]>();

  const send = async (orgId: string, msg: NotificationMessage): Promise<void> => {
    if (!cfg.secretKey) throw new Error('CONNECTOR_SECRET_KEY absente');
    const s = await db.notificationSetting.findUnique({ where: { orgId } });
    if (!s) throw new Error('Notifications non configurées');
    const now = Date.now();
    const recent = (sent.get(orgId) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= 60) throw new Error('Limite de 60 notifications par heure atteinte');
    const url = await assertSafeMcpUrl(
      openSecret(s.urlSealed, cfg.secretKey),
      cfg.allowPrivateNetwork,
    );
    const topic = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!topic || topic.includes('/'))
      throw new Error('Adresse ntfy invalide (https://serveur/sujet)');
    const token = s.tokenSealed ? openSecret(s.tokenSealed, cfg.secretKey) : null;
    const res = await doFetch(url.origin, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        topic,
        title: msg.title,
        message: msg.message,
        priority: msg.priority,
        tags: msg.tags,
        click: cfg.webOrigin,
        ...(s.email ? { email: s.email } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Serveur de notification : HTTP ${res.status}`);
    recent.push(now);
    sent.set(orgId, recent);
  };

  const handle = (events: DomainEvent[]): void => {
    void (async () => {
      for (const e of events) {
        try {
          const s = await db.notificationSetting.findUnique({ where: { orgId: e.orgId } });
          if (!s?.enabled) continue;
          const msg = await notificationFor(db, e);
          if (!msg || !s.events.includes(msg.kind as NotifyEvent)) continue;
          await send(e.orgId, msg);
        } catch (err) {
          cfg.log('notification failed', {
            orgId: e.orgId,
            type: e.type,
            error: err instanceof Error ? err.message.slice(0, 120) : 'erreur',
          });
        }
      }
    })();
  };
  return { handle, send };
}
