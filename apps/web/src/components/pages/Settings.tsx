'use client';

import { useEffect, useState } from 'react';
import type { WorldSnapshot } from '@company-os/contracts';
import { api, apiPost, ApiFailure } from '../../lib/api';
import { useControls } from '../../lib/controls';
import { usd } from '../../lib/format';
import { useTheme, type ThemeChoice } from '../../lib/theme';
import { ConnectorsPanel } from '../cockpit/Connectors';
import { ServerSettings } from './ServerSettings';

type NotifyEvent = 'approval' | 'completed' | 'failed' | 'schedule';
interface NotificationView {
  configured: boolean;
  email: string | null;
  events: NotifyEvent[];
  enabled: boolean;
}
const EVENT_LABEL: Record<NotifyEvent, string> = {
  approval: 'Une validation m’attend',
  completed: 'Mission terminée',
  failed: 'Mission bloquée ou échouée',
  schedule: 'Mission récurrente lancée',
};
const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Erreur inattendue');

export type SettingsSection = 'connectors' | 'notifications' | 'budgets' | 'appearance' | 'server';

/** Page « Réglages » : connecteurs, notifications, budgets, apparence. */
export function SettingsPage({
  world,
  section,
  onSection,
  onClose,
  onBackend,
  toast,
}: {
  world: WorldSnapshot;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  onBackend: () => void;
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const { caps } = useControls();
  const live = world.org.mode === 'live';
  const SECTIONS: [SettingsSection, string][] = [
    ...(live ? ([['connectors', 'Connecteurs']] as [SettingsSection, string][]) : []),
    ...(live && caps.manageNotifications
      ? ([['notifications', 'Notifications']] as [SettingsSection, string][])
      : []),
    ['budgets', 'Budgets'],
    ['appearance', 'Apparence'],
    ...(caps.manageServer ? ([['server', 'Serveur']] as [SettingsSection, string][]) : []),
  ];
  const current = SECTIONS.some(([k]) => k === section) ? section : SECTIONS[0]![0];
  return (
    <section className="page" aria-label="Réglages" data-testid="settings-page">
      <header className="page-head">
        <h2>Réglages</h2>
        <div className="seg" role="tablist">
          {SECTIONS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={current === k}
              className={current === k ? 'on' : ''}
              onClick={() => onSection(k)}
              data-testid={`settings-tab-${k}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn small-btn ghost" onClick={onBackend}>
          ⚙ Connexion au serveur
        </button>
      </header>
      <div className="page-body">
        {current === 'connectors' && (
          <ConnectorsPanel
            embedded
            canManage={caps.manageConnectors ?? false}
            onClose={onClose}
            onDone={(text, tone) => toast({ text, tone })}
          />
        )}
        {current === 'notifications' && <NotificationsSettings toast={toast} />}
        {current === 'budgets' && <BudgetsSettings world={world} toast={toast} />}
        {current === 'appearance' && <AppearanceSettings />}
        {current === 'server' && <ServerSettings toast={toast} />}
      </div>
    </section>
  );
}

function NotificationsSettings({
  toast,
}: {
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const [view, setView] = useState<NotificationView | null>(null);
  const [example] = useState(() => `hq-${crypto.randomUUID().slice(0, 12)}`);
  const [storage, setStorage] = useState(true);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [events, setEvents] = useState<NotifyEvent[]>(['approval', 'completed', 'failed']);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<NotificationView>('/v1/notifications')
      .then((r) => {
        setView(r.data);
        setStorage(r.meta['secretStorage'] !== false);
        setEmail(r.data.email ?? '');
        setEvents(r.data.events);
        setEnabled(r.data.configured ? r.data.enabled : true);
      })
      .catch((e: unknown) => setError(errText(e)));
  }, []);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<NotificationView>('/v1/notifications', {
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(token.trim() ? { token: token.trim() } : {}),
        email: email.trim() || null,
        events,
        enabled,
      });
      setView(r.data);
      setUrl('');
      setToken('');
      toast({ text: 'Notifications enregistrées', tone: 'success' });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const test = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/v1/notifications/test');
      toast({ text: 'Notification de test envoyée', tone: 'success' });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-card" data-testid="notifications-settings">
      <h3>Être prévenu sur mon téléphone</h3>
      <ol className="steps">
        <li>
          Installez l’application gratuite <strong>ntfy</strong> (Android / iPhone) et abonnez-vous
          à un sujet au nom difficile à deviner, ex. <code>{example}</code>.
        </li>
        <li>
          Collez ci-dessous l’adresse <code>https://ntfy.sh/votre-sujet</code> (ou celle de votre
          serveur ntfy). Elle est chiffrée et n’est plus jamais affichée.
        </li>
        <li>Choisissez les événements, enregistrez, puis « Envoyer un test ».</li>
      </ol>
      {view?.configured && (
        <p className="muted small">
          ✓ Configuré{view.enabled ? '' : ' (désactivé)'}. Laissez l’adresse vide pour la garder.
        </p>
      )}
      <label>
        Adresse du sujet ntfy
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          placeholder={view?.configured ? '•••••• (inchangée)' : 'https://ntfy.sh/mon-sujet-secret'}
          disabled={!storage}
          data-testid="notify-url"
        />
      </label>
      <label>
        Jeton d’accès ntfy (facultatif, serveur protégé)
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          autoComplete="off"
          disabled={!storage}
        />
      </label>
      <label>
        Recevoir aussi par email (facultatif)
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="vous@exemple.fr"
        />
      </label>
      <fieldset className="grant-picker">
        <legend>Me prévenir quand…</legend>
        {(Object.keys(EVENT_LABEL) as NotifyEvent[]).map((k) => (
          <label key={k} className="check">
            <input
              type="checkbox"
              checked={events.includes(k)}
              onChange={() =>
                setEvents((ev) => (ev.includes(k) ? ev.filter((x) => x !== k) : [...ev, k]))
              }
            />
            {EVENT_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Notifications actives
      </label>
      {!storage && (
        <p className="form-error">Stockage chiffré indisponible sur le serveur (clé absente).</p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="actions row">
        <button
          className="btn primary"
          disabled={busy || (!view?.configured && !url.trim())}
          onClick={() => void save()}
          data-testid="notify-save"
        >
          Enregistrer
        </button>
        <button className="btn" disabled={busy || !view?.configured} onClick={() => void test()}>
          Envoyer un test
        </button>
      </div>
    </div>
  );
}

function BudgetsSettings({
  world,
  toast,
}: {
  world: WorldSnapshot;
  toast: (t: { text: string; tone: 'success' | 'danger' }) => void;
}) {
  const { caps } = useControls();
  const [values, setValues] = useState<Record<string, string>>({});
  const save = async (scopeType: 'org' | 'agent', scopeId: string, key: string) => {
    try {
      await apiPost('/v1/budgets', { scopeType, scopeId, monthlyLimitUsd: Number(values[key]) });
      setValues((v) => ({ ...v, [key]: '' }));
      toast({ text: 'Budget mis à jour', tone: 'success' });
    } catch (e) {
      toast({ text: errText(e), tone: 'danger' });
    }
  };
  const rows = [...world.budgets].sort((a, b) =>
    a.scopeType === b.scopeType
      ? a.scopeId.localeCompare(b.scopeId)
      : a.scopeType === 'org'
        ? -1
        : 1,
  );
  return (
    <div className="settings-card" data-testid="budgets-settings">
      <h3>Budgets mensuels (plafonds durs)</h3>
      <p className="muted small">
        Remis à zéro le 1er de chaque mois. Un agent qui atteint son plafond est bloqué jusqu’au
        mois suivant ou jusqu’à ce que vous augmentiez sa limite ici.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Périmètre</th>
            <th>Consommé</th>
            <th>Plafond</th>
            {caps.editBudget && <th>Nouveau plafond</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const name =
              b.scopeType === 'org'
                ? 'Toute l’entreprise'
                : (world.agents.find((a) => a.id === b.scopeId)?.name ?? b.scopeId);
            const pct = Math.min(100, (b.usedMicros / Math.max(1, b.limitMicros)) * 100);
            return (
              <tr key={b.id}>
                <td>
                  <strong>{name}</strong>
                </td>
                <td>
                  {usd(b.usedMicros)}
                  <span className={`meter ${pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : ''}`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </td>
                <td>{usd(b.limitMicros)}</td>
                {caps.editBudget && (
                  <td className="inline-form">
                    <input
                      type="number"
                      min={0.5}
                      max={5000}
                      step={0.5}
                      value={values[b.id] ?? ''}
                      placeholder="$"
                      onChange={(e) => setValues((v) => ({ ...v, [b.id]: e.target.value }))}
                    />
                    <button
                      className="btn small-btn"
                      disabled={!values[b.id] || Number(values[b.id]) < 0.5}
                      onClick={() => void save(b.scopeType, b.scopeId, b.id)}
                    >
                      OK
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AppearanceSettings() {
  const [theme, setTheme] = useTheme();
  const OPTIONS: [ThemeChoice, string][] = [
    ['auto', 'Automatique (système)'],
    ['light', 'Clair'],
    ['dark', 'Sombre'],
  ];
  return (
    <div className="settings-card">
      <h3>Apparence</h3>
      <div className="seg" role="radiogroup">
        {OPTIONS.map(([k, label]) => (
          <button
            key={k}
            role="radio"
            aria-checked={theme === k}
            className={theme === k ? 'on' : ''}
            onClick={() => setTheme(k)}
            data-testid={`theme-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
