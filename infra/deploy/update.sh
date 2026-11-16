#!/usr/bin/env bash
# Mise à jour : sauvegarde, récupération du code, reconstruction, redémarrage.
# Les migrations de base s'appliquent automatiquement (service « migrate ») avant l'API.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"
[ "$(id -u)" -eq 0 ] || { echo "Lancer en root." >&2; exit 1; }
cd "$APP_DIR"

echo "==> Sauvegarde avant mise à jour"
bash infra/deploy/backup.sh
echo "==> Récupération du code (identifiants GitHub demandés si le dépôt est privé)"
git pull --ff-only
# Clé de chiffrement des jetons de connecteurs : créée une seule fois, jamais modifiée.
if ! grep -q '^CONNECTOR_SECRET_KEY=.\+' "$ENV_FILE"; then
  sed -i '/^CONNECTOR_SECRET_KEY=/d' "$ENV_FILE"
  echo "CONNECTOR_SECRET_KEY=$(openssl rand -base64 32)" >> "$ENV_FILE"
  echo "==> Clé de chiffrement des connecteurs créée dans $ENV_FILE (à conserver)"
fi
echo "==> Reconstruction et redémarrage"
compose build
compose up -d --wait
docker image prune -f >/dev/null
echo "==> À jour. État :"
compose ps --format 'table {{.Service}}\t{{.Status}}'
