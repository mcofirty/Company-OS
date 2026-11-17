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
# Agent hôte : mises à jour automatiques, sauvegardes et restaurations demandées depuis le cockpit.
if [ ! -f /etc/cron.d/company-os-agent ]; then
  echo "* * * * * root bash $APP_DIR/infra/deploy/host-agent.sh >> /var/log/company-os-agent.log 2>&1" \
    >/etc/cron.d/company-os-agent
  chmod 644 /etc/cron.d/company-os-agent
  echo "==> Mises à jour automatiques activées (désactiver : AUTO_UPDATE=false dans .env.production)"
fi
mkdir -p "$APP_DIR/ops/requests" "$APP_DIR/ops/status" && chown 1000:1000 "$APP_DIR/ops/requests"
echo "==> Reconstruction et redémarrage"
compose build
compose up -d --wait
# Serveur « réel uniquement » (défaut) : la démonstration et ses données sont retirées.
# Idempotent ; la base a été sauvegardée juste avant. Pour garder une démo : HIDE_DEMO_ORG=false.
if [ "$(envget HIDE_DEMO_ORG)" != "false" ]; then
  echo "==> Retrait de la démonstration (données fictives)"
  compose --profile tools run --rm admin src/purge-demo-cli.ts
fi
docker image prune -f >/dev/null
echo "==> À jour. État :"
compose ps --format 'table {{.Service}}\t{{.Status}}'
