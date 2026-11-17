'use client';

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { api, ApiFailure } from '../../lib/api';
import { time } from '../../lib/format';
import { AppCatalog } from './AppCatalog';
import { AppIcon } from './AppIcon';

type Policy = 'read' | 'approval' | 'disabled';
interface ConnectorTool {
  action: string;
  remoteName: string;
  description: string;
  policy: Policy;
  readOnlyHint: boolean;
}
interface Connector {
  id: string;
  toolId: string;
  name: string;
  endpoint: string;
  hasSecret: boolean;
  authHeader: string;
  status: 'healthy' | 'degraded' | 'down';
  app: string | null;
  authKind: string;
  lastError: string | null;
  lastSyncAt: string | null;
  tools: ConnectorTool[];
}

const POLICY_LABEL: Record<Policy, string> = {
  read: 'Lecture directe',
  approval: 'Validation à chaque appel',
  disabled: 'Désactivé',
};
const errorText = (err: unknown): string =>
  err instanceof ApiFailure ? err.message : 'Erreur inattendue';
const post = <T,>(path: string, body?: object) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify(body ?? {}),
  });

/**
 * Connecteurs en libre-service : l'administrateur branche ses propres outils (serveurs MCP),
 * choisit pour chaque outil s'il s'exécute directement (lecture), après validation humaine,
 * ou jamais. Le jeton saisi part chiffré en base et n'est plus jamais affiché.
 */
export function ConnectorsPanel({
  canManage,
  onClose,
  onDone,
  embedded,
}: {
  embedded?: boolean;
  canManage: boolean;
  onClose: () => void;
  onDone: (text: string, tone: 'success' | 'danger') => void;
}) {
  const [list, setList] = useState<Connector[] | null>(null);
  const [secretStorage, setSecretStorage] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [authHeader, setAuthHeader] = useState('authorization');

  const load = useCallback(async () => {
    const r = await api<Connector[]>('/v1/connectors');
    setList(r.data);
    setSecretStorage(r.meta['secretStorage'] !== false);
  }, []);
  useEffect(() => {
    load().catch((e: unknown) => setError(errorText(e)));
  }, [load]);

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const add = () =>
    run('add', async () => {
      const r = await post<{ tools: number }>('/v1/connectors', {
        name,
        url,
        ...(token ? { token } : {}),
        authHeader,
      });
      setName('');
      setUrl('');
      setToken('');
      onDone(`Connecteur « ${name} » ajouté : ${r.data.tools} outil(s) découvert(s)`, 'success');
    });

  return (
    <Wrapper embedded={embedded}>
      <h2>{embedded ? 'Connecteurs' : 'Connecteurs — vos outils réels'}</h2>
      <p className="muted small">
        Choisis une application : connexion en un clic (« Se connecter avec … »), avec un jeton, ou
        via une passerelle (Zapier, Make, n8n) qui ouvre des milliers d’apps — Gmail, WhatsApp,
        LinkedIn, Slack, Google… Chaque outil découvert est d’abord en{' '}
        <em>validation à chaque appel</em>. Ensuite, accorde les outils à tes agents (fiche agent →
        « Modifier les outils »).
      </p>
      <AppCatalog
        connected={(list ?? []).map((c) => ({
          id: c.id,
          app: c.app,
          name: c.name,
          tools: c.tools,
        }))}
        canManage={canManage}
        secretStorage={secretStorage}
        onConnected={(text) => {
          onDone(text, 'success');
          void load();
        }}
        onCustom={() =>
          document.querySelector('.connector-form')?.scrollIntoView({ behavior: 'smooth' })
        }
      />
      <h3 className="section-title">Mes connexions</h3>
      {error && (
        <p className="form-error" role="alert" data-testid="connector-error">
          {error}
        </p>
      )}
      {list === null ? (
        <p className="muted">Chargement…</p>
      ) : list.length === 0 ? (
        <p className="muted" data-testid="connectors-empty">
          Aucun connecteur pour l’instant.
        </p>
      ) : (
        list.map((c) => (
          <section key={c.id} className="connector" data-testid="connector">
            <header className="connector-head">
              <span className={`dot status-${c.status}`} aria-hidden />
              <AppIcon app={c.app} name={c.name} size={26} />
              <strong>{c.name}</strong>
              <span className="muted small">
                {c.endpoint} · {c.hasSecret ? 'jeton chiffré' : 'sans jeton'}
                {c.lastSyncAt ? ` · synchro ${time(c.lastSyncAt)}` : ''}
              </span>
              {canManage && (
                <span className="actions row">
                  <button
                    className="btn small-btn"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`sync-${c.id}`, async () => {
                        await post(`/v1/connectors/${c.id}/sync`);
                        onDone(`${c.name} synchronisé`, 'success');
                      })
                    }
                  >
                    Synchroniser
                  </button>
                  <button
                    className="btn small-btn danger"
                    disabled={busy !== null}
                    data-testid="connector-remove"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Retirer « ${c.name} » ? Le jeton est effacé et les agents perdent ces outils.`,
                        )
                      )
                        return;
                      void run(`rm-${c.id}`, async () => {
                        await post(`/v1/connectors/${c.id}/remove`);
                        onDone(`${c.name} retiré`, 'success');
                      });
                    }}
                  >
                    Retirer
                  </button>
                </span>
              )}
            </header>
            {c.lastError && <p className="form-error small">{c.lastError}</p>}
            <table className="connector-tools">
              <tbody>
                {c.tools.map((t) => (
                  <tr key={t.action}>
                    <td>
                      <code>{t.remoteName}</code>
                      {t.readOnlyHint && <span className="muted small"> · annoncé lecture</span>}
                      <div className="muted small">{t.description || '—'}</div>
                    </td>
                    <td>
                      <select
                        value={t.policy}
                        disabled={!canManage || busy !== null}
                        aria-label={`Politique de ${t.remoteName}`}
                        data-testid={`policy-${t.action}`}
                        onChange={(e) => {
                          const policy = e.target.value as Policy;
                          void run(`pol-${c.id}-${t.action}`, async () => {
                            await post(
                              `/v1/connectors/${c.id}/tools/${encodeURIComponent(t.action)}/policy`,
                              { policy },
                            );
                          });
                        }}
                      >
                        {(Object.keys(POLICY_LABEL) as Policy[]).map((p) => (
                          <option key={p} value={p}>
                            {POLICY_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      {canManage && (
        <form
          className="form connector-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <h3>Autre serveur MCP</h3>
          <label>
            Nom
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              placeholder="ex. Notion de l’équipe"
              data-testid="connector-name"
            />
          </label>
          <label>
            Adresse du serveur MCP (HTTPS)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              type="url"
              placeholder="https://mcp.exemple.com/mcp"
              data-testid="connector-url"
            />
          </label>
          <label>
            Jeton d’accès (facultatif)
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
              disabled={!secretStorage}
              placeholder={
                secretStorage ? 'collé ici, chiffré, jamais réaffiché' : 'stockage indisponible'
              }
              data-testid="connector-token"
            />
          </label>
          <label>
            En-tête du jeton
            <select value={authHeader} onChange={(e) => setAuthHeader(e.target.value)}>
              <option value="authorization">Authorization: Bearer (standard)</option>
              <option value="x-api-key">x-api-key</option>
            </select>
          </label>
          <div className="actions row">
            <button
              type="submit"
              className="btn primary"
              disabled={busy !== null}
              data-testid="connector-submit"
            >
              {busy === 'add' ? 'Connexion et découverte…' : 'Connecter et découvrir les outils'}
            </button>
          </div>
        </form>
      )}
      <div className="actions row">
        <button className="btn ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Wrapper>
  );
}

function Wrapper({ embedded, children }: { embedded?: boolean; children: React.ReactNode }) {
  return embedded ? (
    <div className="connectors embedded" data-testid="connectors-panel">
      {children}
    </div>
  ) : (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Connecteurs">
      <div className="modal modal-wide connectors" data-testid="connectors-panel">
        {children}
      </div>
    </div>
  );
}
