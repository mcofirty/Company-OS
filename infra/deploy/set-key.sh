#!/usr/bin/env bash
# Enregistre ou remplace la clé API Anthropic, puis redémarre le worker (seul à l'utiliser).
#   bash /opt/company-os/infra/deploy/set-key.sh
# La saisie est masquée ; un résumé (début, fin, longueur) permet de vérifier le collage.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"
[ "$(id -u)" -eq 0 ] || { echo "Lancer en root." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Installer d'abord : bash infra/deploy/install.sh" >&2; exit 1; }

echo "Collez la clé API Anthropic (console.anthropic.com → API Keys, commence par sk-ant-api)."
echo "Rien ne s'affiche pendant le collage : c'est normal. Puis appuyez sur Entrée."
read -r -s -p "Clé : " KEY </dev/tty
echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
echo "Clé reçue : $(mask "$KEY")"
if [ -z "$KEY" ]; then
  echo "Rien reçu. Collage : clic droit (PowerShell), Ctrl+Maj+V (Terminal Windows), Cmd+V (Mac)." >&2
  exit 1
fi
if [[ "$KEY" != sk-ant-api* ]]; then
  echo "Ce n'est pas une clé API Anthropic (attendu : sk-ant-api…). Rien n'a été modifié." >&2
  exit 1
fi
read -r -p "Enregistrer cette clé ? (o/n) : " OK </dev/tty
[ "$OK" = "o" ] || [ "$OK" = "O" ] || { echo "Annulé."; exit 0; }

TMP="$(mktemp "$APP_DIR/.env.production.XXXXXX")"
chmod 600 "$TMP"
grep -v '^ANTHROPIC_API_KEY=' "$ENV_FILE" >"$TMP" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >>"$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Clé enregistrée. Redémarrage du worker…"
compose up -d --no-deps --force-recreate worker
echo "Fait. Dans le cockpit, ouvrez une mission bloquée et cliquez « ↻ Relancer »."
