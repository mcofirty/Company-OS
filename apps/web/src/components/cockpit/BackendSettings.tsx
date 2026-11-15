'use client';

import { useState } from 'react';
import { checkBackendUrl, getBackend, setBackend } from '../../lib/api';
import { logout, sessionToken } from '../../lib/oidc';

/**
 * Choix du backend pour CE navigateur (ex. API sur votre PC exposée par Cloudflare Tunnel).
 * Le jeton est conservé localement (localStorage) et envoyé uniquement à l'API choisie.
 */
export function BackendSettings({ onClose }: { onClose: () => void }) {
  const current = getBackend();
  const [url, setUrl] = useState(current.custom ? current.url : '');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    const err = checkBackendUrl(url);
    if (err) return setError(err);
    if (token && token.length < 32) return setError('Le jeton fait au moins 32 caractères.');
    setBackend({
      url: url.trim().replace(/\/+$/, ''),
      token: token || (current.custom ? current.token : null),
    });
    window.location.reload();
  };
  const reset = (): void => {
    setBackend(null);
    window.location.reload();
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Connexion au backend"
    >
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>Connexion au backend</h2>
        <p className="muted small">
          Actuel : <code>{current.url}</code>{' '}
          {current.custom ? '(choisi dans ce navigateur)' : '(par défaut)'}
          {current.token ? ' · jeton enregistré' : ''}
        </p>
        <label>
          URL de l’API
          <input
            type="url"
            placeholder="https://xxxx.trycloudflare.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="backend-url"
            required
          />
        </label>
        <label>
          Jeton d’accès (API_ACCESS_TOKEN)
          <input
            type="password"
            autoComplete="off"
            placeholder={current.token ? 'inchangé si vide' : '32 caractères minimum'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            data-testid="backend-token"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <p className="hint">
          Le jeton reste dans ce navigateur et n’est envoyé qu’à cette API. Ne le partagez pas : il
          donne les droits administrateur (validations, pause système).
        </p>
        <div className="actions row">
          <button type="submit" className="btn primary" data-testid="backend-save">
            Se connecter
          </button>
          {current.custom && (
            <button type="button" className="btn" onClick={reset}>
              Revenir au défaut
            </button>
          )}
          {sessionToken(current.url) && (
            <button type="button" className="btn" onClick={logout} data-testid="logout">
              Se déconnecter
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
