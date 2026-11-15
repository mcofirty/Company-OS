'use client';

import { useState } from 'react';
import { getBackend } from '../../lib/api';
import { logout, startLogin, type AuthPublicConfig } from '../../lib/oidc';

/**
 * Écran d'accès : l'API exige une identité. OIDC => redirection vers le fournisseur (PKCE) ;
 * jeton => saisie dans « Connexion au backend ». Aucune donnée n'est affichée avant connexion.
 */
export function LoginPanel({
  config,
  reason,
  onSettings,
}: {
  config: AuthPublicConfig;
  reason: 'login' | 'forbidden';
  onSettings: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = getBackend().url;
  return (
    <div
      className="login-panel"
      role="dialog"
      aria-label="Connexion requise"
      data-testid="login-panel"
    >
      <h2>{reason === 'forbidden' ? 'Accès non autorisé' : 'Connexion requise'}</h2>
      {reason === 'forbidden' ? (
        <p>
          Vous êtes authentifié, mais ce compte n’a pas d’accès à cette organisation. Demandez à un
          administrateur de l’accorder (<code>pnpm users grant</code>).
        </p>
      ) : (
        <p>
          L’API <code>{api}</code> n’affiche rien sans identité vérifiée.
        </p>
      )}
      <div className="actions row">
        {config.mode === 'oidc' && reason === 'login' && (
          <button
            className="btn primary"
            disabled={busy}
            data-testid="login-oidc"
            onClick={() => {
              setBusy(true);
              startLogin(api, config).catch((err: unknown) => {
                setBusy(false);
                setError(err instanceof Error ? err.message : 'Fournisseur injoignable');
              });
            }}
          >
            Se connecter ({new URL(config.issuer ?? api).host})
          </button>
        )}
        {config.mode === 'oidc' && reason === 'forbidden' && (
          <button className="btn" onClick={logout} data-testid="logout">
            Changer de compte
          </button>
        )}
        {config.mode !== 'oidc' && (
          <button className="btn primary" onClick={onSettings}>
            Saisir le jeton d’accès
          </button>
        )}
        <button className="btn ghost" onClick={onSettings}>
          Changer d’API
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
