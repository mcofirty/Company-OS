#!/usr/bin/env bash
# Active (ou refait) la connexion propriétaire : mot de passe + code à 6 chiffres sur le téléphone.
#   bash /opt/company-os/infra/deploy/set-login.sh
# Effets : seul ce mot de passe + ce téléphone ouvrent le cockpit ; le jeton d'accès partageable
# (API_ACCESS_TOKEN) est supprimé ; tous les appareils déjà connectés sont déconnectés.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"
[ "$(id -u)" -eq 0 ] || { echo "Lancer en root." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Installer d'abord : bash infra/deploy/install.sh" >&2; exit 1; }

owner_cli() { compose --profile tools run --rm -T admin src/owner-cli.ts "$@"; }

cat <<'EOF'

 Connexion au cockpit : mot de passe + code de votre téléphone
 ─────────────────────────────────────────────────────────────
 Il vous faut une application d'authentification sur votre téléphone
 (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…).
 Même si quelqu'un découvre votre mot de passe, il ne pourra pas entrer
 sans votre téléphone.

EOF
while true; do
  read -r -s -p "Choisissez un mot de passe (10 caractères minimum) : " PW1 </dev/tty
  echo
  read -r -s -p "Retapez-le : " PW2 </dev/tty
  echo
  if [ "$PW1" != "$PW2" ]; then echo "Les deux saisies diffèrent, recommencez."; continue; fi
  if [ "${#PW1}" -lt 10 ]; then echo "Trop court (10 caractères minimum)."; continue; fi
  break
done

echo "Préparation (quelques secondes)…"
OUT="$(mktemp)"
chmod 600 "$OUT"
trap 'rm -f "$OUT"' EXIT
# Le mot de passe passe par l'entrée standard (jamais en argument visible dans `ps`).
printf '%s\n' "$PW1" | owner_cli generate >"$OUT"
unset PW1 PW2
TOTP="$(grep '^OWNER_TOTP_SECRET=' "$OUT" | cut -d= -f2)"

for attempt in 1 2 3 4 5; do
  read -r -p "Tapez le code à 6 chiffres affiché par l'application : " CODE </dev/tty
  if printf '%s\n%s\n' "$TOTP" "$CODE" | owner_cli verify; then
    echo "Code correct : votre téléphone est bien associé."
    break
  fi
  if [ "$attempt" -eq 5 ]; then
    echo "Code refusé 5 fois. Rien n'a été modifié. Vérifiez l'heure du téléphone puis relancez." >&2
    exit 1
  fi
  echo "Code incorrect (il change toutes les 30 secondes). Réessayez."
done

TMP="$(mktemp "$APP_DIR/.env.production.XXXXXX")"
chmod 600 "$TMP"
grep -v -E '^(OWNER_PASSWORD_HASH|OWNER_TOTP_SECRET|OWNER_SESSION_SECRET|API_ACCESS_TOKEN|TRUST_PROXY)=' \
  "$ENV_FILE" | grep -v '^# Jeton administrateur à saisir' >"$TMP" || true
{
  echo "# Connexion propriétaire (set-login.sh) : mot de passe + code du téléphone."
  cat "$OUT"
  echo "TRUST_PROXY=1"
} >>"$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Enregistré. Redémarrage de l'API…"
compose up -d --no-deps --force-recreate api
WEB_HOST="$(envget WEB_HOST)"
cat <<EOF

 C'est prêt. Ouvrez https://$WEB_HOST
 puis saisissez votre mot de passe et le code du téléphone.

 · Ancien jeton d'accès : supprimé (il ne fonctionne plus).
 · Appareils déjà connectés : déconnectés.
 · Téléphone perdu ou mot de passe oublié : relancez ce script depuis le serveur.
EOF
