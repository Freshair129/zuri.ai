#!/usr/bin/env bash
# Build and start the zuri-ai Docker Compose stack locally, with optional public ingress.
# Idempotent. Resolves the Server app directory and reads apps/server/.env (and the
# optional apps/server/.env.docker); the repository-root .env is not used by Compose.
# Usage: scripts/deploy.sh [--no-build] [--pull] [--public]
# See docs/deployment/docker-ngrok.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$root/../.." && pwd)"
cd "$root"

no_build=0
pull=0
public=0
for arg in "$@"; do
  case "$arg" in
    --no-build) no_build=1 ;;
    --pull) pull=1 ;;
    --public) public=1 ;;
    *) echo "[zuri] unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f .env ]; then
  echo "[zuri] .env is missing. Copy .env.example to .env, fill DATABASE_URL and ZURI_SESSION_SECRET, then run again." >&2
  exit 1
fi

# Read the same interpolation environment that Compose will use. Capture it in
# memory and print only presence checks; this honors shell overrides, dotenv syntax,
# CRLF, and duplicate assignments without echoing credentials.
compose_environment="$(docker compose config --environment)"
resolved_compose_value() {
  local name="$1" value
  value="$(printf '%s\n' "$compose_environment" | awk -v name="$name" 'index($0, name "=") == 1 { sub(/^[^=]*=/, ""); print; exit }')"
  printf '%s' "$value"
}
has_configured_value() {
  local value
  value="$(resolved_compose_value "$1")"
  [[ -n "${value//[[:space:]]/}" ]]
}

if ! has_configured_value ZURI_SESSION_SECRET; then
  echo "[zuri] warning: ZURI_SESSION_SECRET is not set in the resolved Compose environment." >&2
fi
if [ "$public" = 1 ]; then
  for name in NGROK_AUTHTOKEN NGROK_DOMAIN; do
    if ! has_configured_value "$name"; then
      echo "[zuri] --public requires ${name} in the resolved Compose environment; no public tunnel was started." >&2
      exit 1
    fi
  done
else
  active_profiles="$(resolved_compose_value COMPOSE_PROFILES)"
  active_profiles="${active_profiles//[[:space:]]/}"
  if [[ ",$active_profiles," == *,public,* ]]; then
    echo '[zuri] COMPOSE_PROFILES activates public ingress. Remove public for local-only deployment, or use --public with a token and assigned domain.' >&2
    exit 1
  fi
  echo '[zuri] Local-only deployment; ngrok is disabled. Use --public with a token and assigned domain to opt in.'
fi

docker info --format '{{.ServerVersion}}' >/dev/null
docker compose config --quiet

# FR-289 consumes a generated graph mounted from the canonical repository docs.
# Refresh that ignored artifact from source before building or starting the stack.
npm --prefix "$repo_root" run docs:graph

if [ "$pull" = 1 ]; then
  docker compose pull --ignore-buildable
fi
if [ "$no_build" = 0 ]; then
  docker compose build
fi

if [ "$public" = 1 ]; then
  docker compose --profile public up -d --remove-orphans
else
  docker compose up -d --remove-orphans web
fi
docker compose ps

if [ "$public" != 1 ]; then
  exit 0
fi

# Public URL: ngrok's inspection API, published on the host loopback only.
port="${NGROK_INSPECT_PORT:-4040}"
for _ in $(seq 1 20); do
  if url="$(curl -fsS "http://127.0.0.1:${port}/api/tunnels" 2>/dev/null | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -n1)" && [ -n "$url" ]; then
    echo "[zuri] public URL : $url"
    echo "[zuri] LINE webhook: $url/api/line-oa/accounts/<account-id>/webhook (configure per account)"
    echo "[zuri] health      : $url/api/health"
    exit 0
  fi
  sleep 3
done
echo "[zuri] ngrok has not reported a tunnel yet. Check: docker compose logs ngrok" >&2
exit 1
