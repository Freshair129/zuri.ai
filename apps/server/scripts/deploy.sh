#!/usr/bin/env bash
# Build and start the zuri-ai Docker Compose stack (web + ngrok, optional local Postgres).
# Idempotent. Reads .env (and the optional .env.docker) from the repository root.
# Usage: scripts/deploy.sh [--no-build] [--pull]
# See docs/deployment/docker-ngrok.md.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

no_build=0
pull=0
for arg in "$@"; do
  case "$arg" in
    --no-build) no_build=1 ;;
    --pull) pull=1 ;;
    *) echo "[zuri] unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f .env ]; then
  echo "[zuri] .env is missing. Copy .env.example to .env, fill DATABASE_URL, ZURI_SESSION_SECRET and NGROK_AUTHTOKEN, then run again." >&2
  exit 1
fi

# Only the NAMES of required variables are checked; values are never printed.
for name in NGROK_AUTHTOKEN ZURI_SESSION_SECRET; do
  if ! grep -Eq "^[[:space:]]*${name}[[:space:]]*=[[:space:]]*[^[:space:]]" .env; then
    echo "[zuri] warning: ${name} is not set in .env — the ${name}-dependent service will fail." >&2
  fi
done

docker info --format '{{.ServerVersion}}' >/dev/null
docker compose config --quiet

if [ "$pull" = 1 ]; then
  docker compose pull --ignore-buildable
fi
if [ "$no_build" = 0 ]; then
  docker compose build
fi

docker compose up -d --remove-orphans
docker compose ps

# Public URL: ngrok's inspection API, published on the host loopback only.
port="${NGROK_INSPECT_PORT:-4040}"
for _ in $(seq 1 20); do
  if url="$(curl -fsS "http://127.0.0.1:${port}/api/tunnels" 2>/dev/null | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -n1)" && [ -n "$url" ]; then
    echo "[zuri] public URL : $url"
    echo "[zuri] LINE webhook: $url/api/agent/line-webhook"
    echo "[zuri] health      : $url/api/health"
    exit 0
  fi
  sleep 3
done
echo "[zuri] ngrok has not reported a tunnel yet. Check: docker compose logs ngrok" >&2
exit 1
