---
version: "0.1.0b"
created_at: "2026-09-11T14:55:00+07:00,CLAUDE,base 5443f958"
last_update: "2026-09-11T14:55:00+07:00,CLAUDE"
status: beta
attributes:
  domain: line-oa-studio
  scope: production LINE server transport dropped by a redeploy without the ADR-061 overlay
---

# LINE server overlay dropped on redeploy

## Symptom

Production answered 503 to everything on the ADR-061 server LINE path:

- LINE's own deliveries, `POST /api/line-oa/accounts/{id}/webhook`, got
  `503 {"error":"LINE_WEBHOOK_NOT_ACCEPTED"}` — 161 of them in one hour of the ngrok
  inspector's window (14:05–14:25 +07 on 2026-09-11).
- The Zuri Edge Device worker's `POST /api/edge/conversation-jobs/claim` got
  `503 {"error":"LINE_SERVER_DISABLED"}` — 134 in the same window, every one.
- The server `line-worker` logged `line.worker.tick status 503` from at least
  2026-09-10 20:09Z until it was stopped at 20:10Z (exit 137, not OOM).

A desktop-app upgrade happened in the middle of this and changed nothing: the claim
answers were identical before and after it. The 503 was never the device.

## Root cause

`zuri-ai-web-1` had been recreated from `docker-compose.yml` alone. Its
`com.docker.compose.project.config_files` label listed one file. The ADR-061 transport
lives in `docker-compose.line-server.yml`: it sets `ZURI_LINE_SERVER_ENABLED=true`, the
worker token, the reply sealing key and the read-only credential mount, and the
`line-worker` service sits behind the `line-server` profile. Without the overlay every
server-owned LINE route refuses with 503 by design (`ZURI_LINE_SERVER_ENABLED !== 'true'`).

The command that does this is the one CLAUDE.md documented as the deploy:
`cd apps/server && docker compose up -d --build web`. It never mentioned the overlay, so
following the written procedure exactly was enough to take LINE down. Nothing failed
loudly: web stayed `healthy`, because `/api/health` checks the database, not the
transport.

## Fix (2026-09-11 14:43 +07)

```bash
cd apps/server
ZURI_WEB_IMAGE=zuri-ai-web:release-9b23d370 \
  docker compose -f docker-compose.yml -f docker-compose.line-server.yml \
  --profile line-server up -d --no-build web line-worker
```

Same image as before (the one `.env` pins), `--no-build` so nothing was built from the
shared primary tree. Verified: the web container's label names both files,
`ZURI_LINE_SERVER_ENABLED=true` inside it, the credential mount is readable,
`line-worker` ticks 200, and edge claims went 503 → 204 at once.

## Prevention

- `apps/server/.env` on the production host now sets
  `COMPOSE_FILE=docker-compose.yml;docker-compose.line-server.yml` and
  `COMPOSE_PROFILES=line-server`, so the plain documented command includes the overlay.
- CLAUDE.md, README and `docs/deployment/docker-ngrok.md` state the requirement and the
  trap: an explicit `-f` replaces `COMPOSE_FILE`, so a `-f` deploy must list both files
  and the profile itself. `.env.example` carries the settings commented out, because a
  host without the LINE credential cannot interpolate the overlay.
- The post-deploy check is two commands: the config_files label, and
  `printf %s "$ZURI_LINE_SERVER_ENABLED"` inside the web container.

## Open

- Events LINE delivered while the path answered 503 were never recorded, so they
  cannot be replayed from this side (ADR-061 D4: only redelivery repairs an event that
  was never stored). Whether LINE redelivered any depends on the channel's redelivery
  setting in the LINE console.
- `/api/health` stays green while the transport is off. A health signal that notices
  "accounts are serverEnabled but the server transport is disabled" would have caught
  this in minutes instead of hours; that is a product change, not part of this fix.
- Because `web` reads `.env` as its `env_file`, the two `COMPOSE_*` lines also enter the
  container environment. They are inert there, but they change web's compose config
  hash, so the next `docker compose up -d` recreates web once even without a new image.
- The host also holds `zuri-ai-web:release-897b53cb` and a `rollback-before-897b53cb`
  tag, while `.env` pins `release-9b23d370`. Nothing records why; the fix kept the
  pinned image.
