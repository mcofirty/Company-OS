#!/usr/bin/env bash
# Fonctions partagées des scripts de déploiement (sourcées, pas exécutées).
# APP_DIR et ENV_FILE sont définis par le script appelant.
compose() {
  docker compose -f "$APP_DIR/infra/docker-compose.prod.yml" \
    -f "$APP_DIR/infra/docker-compose.vps.yml" --env-file "$ENV_FILE" "$@"
}
compose_cmd_text() {
  echo "docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.vps.yml --env-file .env.production"
}

# Lit une valeur de .env.production sans l'exécuter (guillemets englobants retirés).
envget() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line#\"}"
  printf '%s' "${line%\"}"
}
# Nettoie une saisie libre avant écriture entre guillemets (pas de ", $, `, \).
# shellcheck disable=SC1003
clean() { printf '%s' "$1" | tr -d '"$`\\'; }
