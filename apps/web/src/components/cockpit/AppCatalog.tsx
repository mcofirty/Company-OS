'use client';

import { useState } from 'react';
import {
  APP_CATALOG,
  appById,
  appOfToolName,
  type AppCategory,
  type AppPreset,
} from '@company-os/contracts';
import { apiPost, ApiFailure } from '../../lib/api';
import { AppIcon } from './AppIcon';

export interface ConnectedSummary {
  id: string;
  app: string | null;
  name: string;
  tools: { action: string; remoteName: string }[];
}

const CATEGORIES: AppCategory[] = [
  'communication',
  'productivité',
  'ventes & marketing',
  'développement',
  'finance',
  'automatisation',
  'ia',
];

/**
 * Catalogue d'applications : chaque carte dit si l'app est déjà branchée et comment la brancher
 * (« Se connecter avec … », jeton, adresse de passerelle, ou via Zapier / Make / n8n).
 */
export function AppCatalog({
  connected,
  canManage,
  secretStorage,
  onConnected,
  onCustom,
}: {
  connected: ConnectedSummary[];
  canManage: boolean;
  secretStorage: boolean;
  onConnected: (text: string) => void;
  onCustom: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<AppCategory | ''>('');
  const [picked, setPicked] = useState<AppPreset | null>(null);
  const q = query.trim().toLowerCase();
  const apps = APP_CATALOG.filter(
    (a) =>
      (!cat || a.category === cat) &&
      (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)),
  );
  const statusOf = (a: AppPreset): { label: string; tone: string } | null => {
    if (a.connect.kind === 'builtin') return { label: 'Intégré', tone: 'ok' };
    if (connected.some((c) => c.app === a.id)) return { label: 'Connecté', tone: 'ok' };
    if (a.connect.kind === 'via') {
      const via = connected.find((c) =>
        c.tools.some((t) => appOfToolName(t.remoteName)?.id === a.id),
      );
      if (via) return { label: `Via ${via.name}`, tone: 'ok' };
      return { label: 'Via passerelle', tone: 'muted' };
    }
    return null;
  };
  return (
    <div className="app-catalog" data-testid="app-catalog">
      <div className="catalog-head">
        <input
          placeholder="Rechercher une application (Gmail, GitHub, WhatsApp…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="catalog-search"
        />
        <div className="seg small">
          <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>
            Toutes
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="catalog-grid">
        {apps.map((a) => {
          const st = statusOf(a);
          return (
            <button
              key={a.id}
              className="app-card"
              onClick={() => (a.connect.kind === 'custom' ? onCustom() : setPicked(a))}
              data-testid={`catalog-${a.id}`}
            >
              <AppIcon app={a} name={a.name} size={34} />
              <span className="grow">
                <strong>{a.name}</strong>
                <span className="muted small">{a.description}</span>
              </span>
              {st && <span className={`app-status ${st.tone}`}>{st.label}</span>}
            </button>
          );
        })}
      </div>
      {picked && (
        <ConnectDialog
          app={picked}
          connected={connected}
          canManage={canManage}
          secretStorage={secretStorage}
          onPick={(id) => setPicked(appById(id) ?? null)}
          onClose={() => setPicked(null)}
          onConnected={(t) => {
            setPicked(null);
            onConnected(t);
          }}
        />
      )}
    </div>
  );
}

function ConnectDialog({
  app,
  connected,
  canManage,
  secretStorage,
  onPick,
  onClose,
  onConnected,
}: {
  app: AppPreset;
  connected: ConnectedSummary[];
  canManage: boolean;
  secretStorage: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
  onConnected: (text: string) => void;
}) {
  const [token, setToken] = useState('');
  const [url, setUrl] = useState(
    app.connect.kind === 'mcp-token' || app.connect.kind === 'mcp-oauth' ? app.connect.url : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = app.connect;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Erreur inattendue');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={app.name}>
      <div className="modal connect-dialog" data-testid="connect-dialog">
        <header className="connect-head">
          <AppIcon app={app} name={app.name} size={40} />
          <div>
            <h2>{app.name}</h2>
            <p className="muted small">{app.description}</p>
          </div>
        </header>
        {c.kind === 'builtin' && (
          <p>
            Outil intégré : rien à connecter. Accorde-le à un agent depuis sa fiche (« Modifier les
            outils »).
          </p>
        )}
        {c.kind === 'via' && (
          <>
            <p>{c.hint}</p>
            <div className="via-list">
              {c.gateways.map((g) => {
                const gw = appById(g)!;
                const has = connected.some((x) => x.app === g);
                return (
                  <button key={g} className="app-card small" onClick={() => onPick(g)}>
                    <AppIcon app={gw} name={gw.name} size={28} />
                    <span className="grow">
                      <strong>{gw.name}</strong>
                      <span className="muted small">{has ? 'déjà connecté' : 'connecter'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {c.kind === 'mcp-oauth' && (
          <>
            <p>
              Tu vas être redirigé vers {app.name} pour autoriser l’accès, puis revenir ici. Les
              jetons sont chiffrés ; chaque outil commence en « validation à chaque appel ».
            </p>
            <details>
              <summary className="muted small">Adresse du serveur MCP</summary>
              <input value={url} onChange={(e) => setUrl(e.target.value)} />
            </details>
          </>
        )}
        {c.kind === 'mcp-token' && (
          <>
            <label>
              {c.tokenLabel}
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={!secretStorage}
                data-testid="connect-token"
              />
            </label>
            <p className="muted small">{c.tokenHelp}</p>
          </>
        )}
        {c.kind === 'mcp-url' && (
          <>
            <label>
              {c.urlLabel}
              <input
                type="password"
                autoComplete="off"
                value={url}
                placeholder={c.example}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!secretStorage}
                data-testid="connect-url"
              />
            </label>
            <p className="muted small">{c.urlHelp}</p>
          </>
        )}
        {'docs' in c && (
          <a className="small" href={c.docs} target="_blank" rel="noreferrer noopener">
            Documentation de {app.name} ↗
          </a>
        )}
        {!secretStorage && c.kind !== 'builtin' && c.kind !== 'via' && (
          <p className="form-error">Stockage chiffré indisponible sur le serveur (clé absente).</p>
        )}
        {error && (
          <p className="form-error" role="alert" data-testid="connect-error">
            {error}
          </p>
        )}
        <div className="actions row">
          {canManage && c.kind === 'mcp-oauth' && (
            <button
              className="btn primary"
              disabled={busy || !secretStorage}
              data-testid="connect-oauth"
              onClick={() =>
                void run(async () => {
                  const r = await apiPost<{ authorizationUrl: string }>(
                    '/v1/connectors/oauth/start',
                    { name: app.name, url, app: app.id },
                  );
                  window.location.assign(r.data.authorizationUrl);
                })
              }
            >
              Se connecter avec {app.name}
            </button>
          )}
          {canManage && (c.kind === 'mcp-token' || c.kind === 'mcp-url') && (
            <button
              className="btn primary"
              disabled={busy || !secretStorage || (c.kind === 'mcp-token' ? !token : !url)}
              data-testid="connect-submit"
              onClick={() =>
                void run(async () => {
                  const r = await apiPost<{ tools: number }>('/v1/connectors', {
                    name: app.name,
                    url,
                    app: app.id,
                    ...(c.kind === 'mcp-token' ? { token, authHeader: c.header } : {}),
                  });
                  onConnected(`${app.name} connecté : ${r.data.tools} outil(s) découvert(s)`);
                })
              }
            >
              {busy ? 'Connexion…' : 'Connecter'}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
