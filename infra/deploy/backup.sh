#!/usr/bin/env bash
# Sauvegarde de la base (format custom pg_dump), conservée 14 jours dans backups/.
# Restauration : voir docs/DEPLOIEMENT-HOSTINGER.md (§ Restaurer).
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"

mkdir -p "$APP_DIR/backups"
chmod 700 "$APP_DIR/backups"
FILE="$APP_DIR/backups/companyos-$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T postgres pg_dump -U companyos -Fc companyos >"$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
find "$APP_DIR/backups" -name 'companyos-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1))"
