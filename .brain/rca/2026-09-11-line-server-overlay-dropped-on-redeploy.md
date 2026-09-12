---
version: "0.2.0b"
created_at: "2026-09-11T14:55:00+07:00,CLAUDE,base 5443f958"
last_update: "2026-09-12T12:20:00+07:00,CLAUDE"
status: beta
attributes:
  domain: line-oa-studio
  scope: production LINE outage with two independent causes — the ADR-061 overlay dropped by a redeploy, and the provider console pointed at another app
---

# LINE outage: the overlay dropped on redeploy, then the console pointed elsewhere

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

## Second cause, found 2026-09-12: the console pointed at another app

Restoring the overlay was not the end of it. For the next 21 hours the server was provably
ready and **no LINE delivery arrived at all** — an unsigned POST from the internet answered
`401 LINE_WEBHOOK_SIGNATURE_INVALID`, `/api/health` answered 200, the tunnel carried the edge
worker's traffic, nothing listened on the legacy port, and the inspector showed zero
`LineBotWebhook` entries.

The owner pressed **Verify** in the LINE Developers Console and it reported **Success** while
the inspector stayed empty. The console's Webhook URL was

```
https://desktop-vetatmq.tail71c7d1.ts.net:10000/webhook/line
```

— the Tailscale Funnel to `127.0.0.1:8766`, which is `smartgift-local-agent.exe`
(`business-01-smart-gift/apps/line-oa-local`, an axum route `/webhook/line`). It verifies the
signature, so it answered 200 to LINE and 503 to an unsigned probe: Verify passed against the
wrong application, and every real message went there instead. That repository contains no code
that sets the webhook endpoint and no Funnel automation, so the URL was changed by a person
after 14:25 on 2026-09-11 — deliveries were still reaching the zuri-ai route at that time.

**"Verify: Success" only proves that something answered 200.** It says nothing about *which*
endpoint, and the URL is not visible on the console's Basic settings tab — it is on the
Messaging API tab under Webhook settings. Settle "is LINE reaching us?" from
`curl -s http://127.0.0.1:4040/api/requests/http?limit=400` (a `LineBotWebhook/2.0` entry), never
from the console's own verdict. This is the same lesson as 2026-09-09, when a Funnel that was up
was read as a Funnel that was used.

## Verified end to end, 2026-09-12

After the owner corrected the URL, one real message produced the whole chain:

| time (+07) | step | result |
|---|---|---|
| 12:13:23 | LINE delivery | 200 in 1.18 s |
| 12:13:36 | LINE delivery | 200 in 1.42 s |
| 12:13:42 | edge worker claim | 200 — a job, not an empty 204 |
| 12:13:50 | edge worker complete | 200 |

`line-worker` returned to IDLE with nothing pending. (ngrok's `duration` field is nanoseconds;
divide by 1e9. Reading it as microseconds turns 1.18 s into "1184 s".)

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
- Nothing detects that the provider console points somewhere else. The server cannot see
  the difference between "no customers wrote" and "LINE is delivering to another app";
  only the absence of deliveries hints at it, and absence is not an alert today.
- The host also holds `zuri-ai-web:release-897b53cb` and a `rollback-before-897b53cb`
  tag, while `.env` pins `release-9b23d370`. Nothing records why; the fix kept the
  pinned image.
