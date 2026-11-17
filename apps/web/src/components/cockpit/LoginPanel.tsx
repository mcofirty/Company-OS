'use client';

import { useState } from 'react';
import { getBackend } from '../../lib/api';
import { logout, startLogin, type AuthPublicConfig } from '../../lib/oidc';
import { ownerLogin } from '../../lib/owner';

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
  if (config.mode === 'password' && reason === 'login') {
    return <PasswordLogin api={api} onSettings={onSettings} />;
  }
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
        {config.mode !== 'oidc' && config.mode !== 'password' && (
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

/**
 * Connexion propriétaire : mot de passe + code à 6 chiffres de l'application du téléphone.
 * Le formulaire est compatible avec les gestionnaires de mots de passe (champ identifiant
 * masqué, `current-password`, `one-time-code`) et se valide tout seul au 6ᵉ chiffre.
 */
function PasswordLogin({ api, onSettings }: { api: string; onSettings: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (codeValue = code): Promise<void> => {
    if (busy) return;
    if (!password) return setError('Saisissez votre mot de passe.');
    if (codeValue.length !== 6) return setError('Le code fait 6 chiffres.');
    setBusy(true);
    setError(null);
    try {
      await ownerLogin(api, { password, code: codeValue, remember });
      window.location.reload();
    } catch (err) {
      setBusy(false);
      setCode('');
      setError(err instanceof Error ? err.message : 'Connexion impossible');
    }
  };

  return (
    <div className="login-panel" role="dialog" aria-label="Connexion" data-testid="login-panel">
      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>Bienvenue au QG</h2>
        <p>Connectez-vous pour superviser vos agents.</p>
        <input
          type="text"
          name="username"
          autoComplete="username"
          value="proprietaire"
          readOnly
          hidden
        />
        <label>
          Mot de passe
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
            required
          />
        </label>
        <label>
          Code de l’application d’authentification
          <input
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="123456"
            className="otp-input"
            value={code}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (digits.length === 6 && password) void submit(digits);
            }}
            data-testid="login-code"
            required
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            data-testid="login-remember"
          />
          Rester connecté sur cet appareil (30 jours)
        </label>
        {error && (
          <p className="form-error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <div className="actions row">
          <button type="submit" className="btn primary" disabled={busy} data-testid="login-submit">
            {busy ? 'Vérification…' : 'Se connecter'}
          </button>
          <button type="button" className="btn ghost" onClick={onSettings}>
            Changer d’API
          </button>
        </div>
        <p className="hint">
          Téléphone perdu ou mot de passe oublié : sur le serveur, lancez{' '}
          <code>bash infra/deploy/set-login.sh</code>.
        </p>
      </form>
    </div>
  );
}
