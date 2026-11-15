#!/usr/bin/env bash
# Installation de Living HQ sur un VPS neuf (Hostinger KVM, Ubuntu 24.04 ; marche aussi ailleurs).
# À lancer en root depuis le dossier du dépôt cloné :
#   bash /opt/company-os/infra/deploy/install.sh
# Relançable sans risque : la configuration existante (.env.production) est conservée.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2
  exit 1
}
ask() { # ask VAR "Question" "défaut"
  local __var=$1 __q=$2 __def=${3:-} __ans
  read -r -p "$__q${__def:+ [$__def]} : " __ans </dev/tty || true
  printf -v "$__var" '%s' "${__ans:-$__def}"
}
# 48 caractères hexadécimaux (192 bits) : assez long pour API_ACCESS_TOKEN (≥ 32).
secret() { openssl rand -hex 24; }

[ "$(id -u)" -eq 0 ] || die "Lancer en root (ou avec sudo)."
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = "ubuntu" ] || warn "Testé sur Ubuntu 22.04/24.04 ; système détecté : ${PRETTY_NAME:-inconnu}."

say "1/7 Paquets système (Docker, pare-feu, mises à jour de sécurité)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git openssl ufw cron unattended-upgrades \
  docker.io docker-compose-v2 docker-buildx >/dev/null
systemctl enable --now docker >/dev/null
systemctl enable --now cron >/dev/null
docker compose version >/dev/null || die "docker compose indisponible."

say "2/7 Configuration"
if [ -f "$ENV_FILE" ]; then
  echo "Configuration existante conservée : $ENV_FILE"
  echo "(pour la modifier : nano $ENV_FILE puis bash infra/deploy/update.sh)"
else
  IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [ -n "$IP" ] || ask IP "Adresse IP publique du serveur" ""
  DASHED="${IP//./-}"
  echo
  echo "Adresses du cockpit et de l'API. Sans nom de domaine, des adresses gratuites"
  echo "basées sur l'IP du serveur sont utilisées (sslip.io), avec HTTPS automatique."
  ask WEB_HOST "Adresse du cockpit" "hq.$DASHED.sslip.io"
  ask API_HOST "Adresse de l'API" "api.$DASHED.sslip.io"
  ask ORG_NAME "Nom de votre entreprise (organisation LIVE)" "Ma Société"
  ask ORG_BUDGET "Budget mensuel Claude de l'organisation, en USD (plafond dur)" "5"
  echo
  echo "Clé API Anthropic (sk-ant-…). Elle ne s'affiche pas pendant la saisie ;"
  echo "laisser vide pour l'ajouter plus tard (les missions LIVE seront alors refusées)."
  read -r -s -p "Clé Anthropic : " ANTHROPIC_API_KEY </dev/tty || true
  echo
  if [ -n "$ANTHROPIC_API_KEY" ] && [[ "$ANTHROPIC_API_KEY" != sk-ant-* ]]; then
    warn "La clé ne commence pas par sk-ant- : vérifiez-la (conservée telle quelle)."
  fi
  umask 077
  cat >"$ENV_FILE" <<EOF
# Living HQ — configuration de production (générée le $(date -u +%F)). Ne jamais versionner.
WEB_HOST=$WEB_HOST
API_HOST=$API_HOST
PUBLIC_API_URL=https://$API_HOST
# Origines autorisées : le cockpit de ce serveur (+ le cockpit Vercel, facultatif).
WEB_ORIGIN=https://$WEB_HOST,https://company-os-web-ten.vercel.app
POSTGRES_PASSWORD=$(secret)
# Jeton administrateur à saisir dans le cockpit (⚙ Connexion au backend).
API_ACCESS_TOKEN=$(secret)
# Clé Anthropic : transmise au worker uniquement.
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
DEMO_AUTOPILOT=false
IMAGE_TAG=latest
ORG_NAME="$(clean "$ORG_NAME")"
ORG_BUDGET=$(clean "$ORG_BUDGET")
EOF
  chmod 600 "$ENV_FILE"
  echo "Écrit : $ENV_FILE (lisible par root uniquement)."
fi
# Lecture clé par clé (le fichier n'est jamais exécuté comme un script).
WEB_HOST="$(envget WEB_HOST)"
API_HOST="$(envget API_HOST)"
API_ACCESS_TOKEN="$(envget API_ACCESS_TOKEN)"
ANTHROPIC_API_KEY="$(envget ANTHROPIC_API_KEY)"
ORG_NAME="$(envget ORG_NAME)"
ORG_BUDGET="$(envget ORG_BUDGET)"

say "3/7 Pare-feu (SSH, HTTP, HTTPS uniquement)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | head -n 12

say "4/7 Construction des images (plusieurs minutes la première fois)"
cd "$APP_DIR"
compose build

say "5/7 Démarrage (base, Temporal, migrations, API, worker, cockpit, HTTPS)"
compose up -d --wait

say "6/7 Organisations : démonstration + votre organisation LIVE"
compose --profile demo run --rm seed
compose --profile tools run --rm admin src/live-cli.ts --name "${ORG_NAME:-Ma Société}" --budget "${ORG_BUDGET:-5}"

say "7/7 Sauvegarde quotidienne de la base (03:30, 14 jours conservés)"
cat >/etc/cron.d/company-os-backup <<EOF
30 3 * * * root bash $APP_DIR/infra/deploy/backup.sh >> /var/log/company-os-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/company-os-backup
bash "$APP_DIR/infra/deploy/backup.sh"

cat <<EOF

────────────────────────────────────────────────────────────────────
 Living HQ est en ligne.

 Cockpit : https://$WEB_HOST
 API     : https://$API_HOST   (santé : https://$API_HOST/health/ready)

 Connexion au cockpit : bouton « Saisir le jeton d'accès » (ou ⚙), puis
   URL de l'API : https://$API_HOST
   Jeton        : $API_ACCESS_TOKEN
 Ensuite : sélecteur d'organisation → « LIVE · ${ORG_NAME:-Ma Société} » → « + Agent ».

 Le jeton est aussi dans $ENV_FILE (à garder secret).
 Si le cockpit n'est pas joignable tout de suite : le certificat HTTPS peut
 prendre une à deux minutes. Journal : $(compose_cmd_text) logs caddy

 Mise à jour : bash $APP_DIR/infra/deploy/update.sh
 Clé Claude  : nano $ENV_FILE (ANTHROPIC_API_KEY=…), puis update.sh
────────────────────────────────────────────────────────────────────
EOF
[ -n "${ANTHROPIC_API_KEY:-}" ] || warn "Aucune clé Anthropic : les missions LIVE seront refusées tant qu'elle n'est pas ajoutée."
