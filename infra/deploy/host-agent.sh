#!/usr/bin/env bash
# Agent hôte (cron, chaque minute) : relais entre le cockpit et le serveur, sans accès Docker
# pour l'application. Il lit des DEMANDES écrites par l'API dans ops/requests (admin seulement)
# et publie un ÉTAT dans ops/status. Actions possibles, et seulement celles-ci :
#   - sauvegarde immédiate ;
#   - restauration d'une sauvegarde existante (après une sauvegarde de l'état actuel) ;
#   - mise à jour automatique depuis GitHub (toutes les 10 min, si AUTO_UPDATE n'est pas « false »).
set -uo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$APP_DIR/.env.production"
# shellcheck source=infra/deploy/common.sh
source "$APP_DIR/infra/deploy/common.sh"
[ "$(id -u)" -eq 0 ] || { echo "Lancer en root." >&2; exit 1; }
OPS="$APP_DIR/ops"
mkdir -p "$OPS/requests" "$OPS/status" "$APP_DIR/backups"
# L'API (utilisateur « node », uid 1000) dépose ses demandes ; elle ne lit que l'état.
chown 1000:1000 "$OPS/requests" && chmod 770 "$OPS/requests"
chmod 755 "$OPS" "$OPS/status"
exec 9>"$OPS/.lock"
flock -n 9 || exit 0 # une opération est déjà en cours
now() { date -u +%FT%TZ; }
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r'; }
write_status() { # fichier, contenu JSON
  printf '%s\n' "$2" >"$OPS/status/$1.tmp" && chmod 644 "$OPS/status/$1.tmp" && mv "$OPS/status/$1.tmp" "$OPS/status/$1"
}
index_backups() {
  local first=1 out='['
  for f in $(ls -1t "$APP_DIR"/backups/companyos-*.dump 2>/dev/null | head -n 40); do
    local name size mtime
    name="$(basename "$f")"
    size="$(stat -c %s "$f")"
    mtime="$(date -u -d "@$(stat -c %Y "$f")" +%FT%TZ)"
    [ $first -eq 1 ] || out+=','
    out+="{\"file\":\"$name\",\"size\":$size,\"createdAt\":\"$mtime\"}"
    first=0
  done
  write_status backups.json "$out]"
}

# 1) Demandes du cockpit (une à la fois, la plus ancienne d'abord).
for req in $(ls -1tr "$OPS"/requests/*.json 2>/dev/null); do
  action="$(sed -n 's/.*"action"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$req" | head -n 1)"
  file="$(sed -n 's/.*"file"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$req" | head -n 1)"
  by="$(sed -n 's/.*"requestedBy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$req" | head -n 1)"
  rm -f "$req"
  case "$action" in
    backup)
      write_status job.json "{\"action\":\"backup\",\"state\":\"running\",\"at\":\"$(now)\"}"
      if out="$(bash "$APP_DIR/infra/deploy/backup.sh" 2>&1)"; then st=ok; else st=error; fi
      write_status job.json "{\"action\":\"backup\",\"state\":\"$st\",\"at\":\"$(now)\",\"requestedBy\":\"$(json_str "$by")\",\"detail\":\"$(json_str "$(echo "$out" | tail -n 1)")\"}"
      ;;
    restore)
      # Nom strict et fichier existant : rien d'autre ne peut être restauré.
      if ! [[ "$file" =~ ^companyos-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || [ ! -f "$APP_DIR/backups/$file" ]; then
        write_status job.json "{\"action\":\"restore\",\"state\":\"error\",\"at\":\"$(now)\",\"detail\":\"Sauvegarde introuvable\"}"
        continue
      fi
      write_status job.json "{\"action\":\"restore\",\"state\":\"running\",\"at\":\"$(now)\",\"file\":\"$file\"}"
      {
        bash "$APP_DIR/infra/deploy/backup.sh" &&
          compose stop api worker &&
          compose exec -T postgres dropdb -U companyos companyos &&
          compose exec -T postgres createdb -U companyos companyos &&
          compose exec -T postgres pg_restore -U companyos -d companyos --no-owner <"$APP_DIR/backups/$file"
      } >>/var/log/company-os-restore.log 2>&1
      rc=$?
      compose up -d --wait >>/var/log/company-os-restore.log 2>&1
      st=$([ $rc -eq 0 ] && echo ok || echo error)
      write_status job.json "{\"action\":\"restore\",\"state\":\"$st\",\"at\":\"$(now)\",\"file\":\"$file\",\"requestedBy\":\"$(json_str "$by")\"}"
      ;;
    *) ;;
  esac
done

# 2) Mise à jour automatique (toutes les 10 minutes), avec sauvegarde (update.sh la fait).
if [ "$(envget AUTO_UPDATE)" != "false" ] && [ $((10#$(date +%M) % 10)) -eq 0 ]; then
  cd "$APP_DIR"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if git fetch -q origin "$branch" 2>/dev/null; then
    local_rev="$(git rev-parse HEAD)"
    remote_rev="$(git rev-parse "origin/$branch")"
    if [ "$local_rev" != "$remote_rev" ]; then
      write_status update.json "{\"state\":\"running\",\"at\":\"$(now)\",\"from\":\"${local_rev:0:7}\",\"to\":\"${remote_rev:0:7}\"}"
      if bash "$APP_DIR/infra/deploy/update.sh" >>/var/log/company-os-update.log 2>&1; then st=ok; else st=error; fi
      write_status update.json "{\"state\":\"$st\",\"at\":\"$(now)\",\"from\":\"${local_rev:0:7}\",\"to\":\"$(git rev-parse --short HEAD)\",\"subject\":\"$(json_str "$(git log -1 --format=%s)")\"}"
    else
      [ -f "$OPS/status/update.json" ] ||
        write_status update.json "{\"state\":\"ok\",\"at\":\"$(now)\",\"to\":\"${local_rev:0:7}\",\"subject\":\"$(json_str "$(git log -1 --format=%s)")\"}"
    fi
  fi
fi
write_status agent.json "{\"seenAt\":\"$(now)\",\"autoUpdate\":$([ "$(envget AUTO_UPDATE)" = "false" ] && echo false || echo true)}"
index_backups
