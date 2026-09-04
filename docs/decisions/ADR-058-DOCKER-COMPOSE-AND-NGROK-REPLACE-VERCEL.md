---
version: "0.1.0b"
created_at: "2026-09-03T21:30:00+07:00,CLAUDE"
last_update: "2026-09-03T21:30:00+07:00,CLAUDE"
status: "accepted"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "architecture-decision"
  scope: "Deployment layer: Docker Compose on the host machine with ngrok as the public HTTPS ingress, replacing Vercel"
---

# ADR-058 — Docker Compose + ngrok replace Vercel as the deployment path

## Status

**Status:** Accepted 2026-09-03. Implemented and verified locally (build, run,
health, public HTTPS tunnel, restart persistence). Supersedes nothing: it
replaces an operational dependency, not a decision on record. The Vercel-era
vocabulary in older records (ADR-057 "two-phase Vercel deployment", CR-016's
"Vercel env gate", the RCAs under `.brain/rca/`) stays as history.

## Context

zuri-ai is one Next.js 14 application: the console, every `/api/**` route
handler and the LINE webhook seam (`POST /api/agent/line-webhook`, fed by the
separate zuri-cli transport that owns the LINE channel credentials) are served
by one process. Production data lives in Supabase Postgres; SQLite is the
local/test store (ADR-007 P4, ADR-018). There is no queue, worker, Redis,
WebSocket or cron surface to host.

Until now the only remote deployment path was Vercel (`vercel.json` pinned the
function region next to the database; `.vercelignore` trimmed the upload). The
owner's target for this stage is a host PC that stays in the owner's hands —
Docker Compose on the machine, a public HTTPS endpoint through ngrok — with a
VPS behind a real domain as the later step. Vercel-specific configuration must
not be the thing that makes or breaks a deployment.

## Decision

D1. **Docker Compose is the deployment unit.** `docker-compose.yml` declares
    exactly the services that exist: `web` (this app, built by the multi-stage
    `Dockerfile`), `ngrok` (public ingress), and — behind the `local-db`
    profile — `db` (Postgres 16 on a named volume) plus `db-migrate` (one-shot
    `prisma db push` of `prisma/schema.postgres.prisma`). Nothing invented, no
    orchestration beyond Compose, no Kubernetes.

D2. **ngrok is a Compose service on the app's network** and targets
    `web:3000` by DNS name, never `localhost`. Its authtoken comes from
    `NGROK_AUTHTOKEN` in the operator's `.env`; an assigned domain in
    `NGROK_DOMAIN` makes the public URL — and therefore the LINE webhook URL
    `https://<NGROK_DOMAIN>/api/agent/line-webhook` — stable across restarts.
    Without a domain the tunnel URL is temporary and the operator reads it from
    ngrok's inspection API (`scripts/ngrok-url.ps1`). Only `web` is tunneled;
    the database, the inspection UI and the app's host port are never public
    (host bindings default to 127.0.0.1).

D3. **The image is production-mode, non-root and secret-free.** Standalone
    output is opt-in (`NEXT_OUTPUT=standalone`, `next.config.js`) so local
    builds do not change; the runner stage carries the standalone server, static
    assets, `public/`, the public Supabase CA and `contracts/` (read at request
    time), and runs as `node`. `.dockerignore` excludes every `.env*` but the
    template. Every credential arrives at run time through `env_file`.

D4. **Production mode keeps requiring Postgres.** `src/lib/db.js` fails closed
    on SQLite in production (RCA 2026-08-21); the container inherits that. A
    deployment is therefore either the bundled `local-db` profile or an external
    Postgres such as Supabase, chosen by `DATABASE_URL` — optionally in
    `.env.docker`, so a developer's `.env` can keep SQLite for `npm run dev`.

D5. **One public-origin variable.** `PUBLIC_BASE_URL` (FR-142,
    `src/lib/public-base-url.js`) is the run-time origin; `NEXT_PUBLIC_APP_URL`
    remains the build-time alias. The Platform Integrations page derives the
    pairing origin and the webhook URL from the origin it was served from. The
    hardcoded `zuri-ai-woad.vercel.app` is gone from the code.

D6. **Health is observable by the platform.** `GET /api/health` (FR-142) is
    the container `HEALTHCHECK` and the Compose condition ngrok waits on. It is
    unauthenticated, read-only, one trivial query, and returns states only.

D7. **Vercel artifacts are removed or kept by kind, not by name.**
    - `vercel.json`, `.vercelignore` — deployment-only → removed.
    - `.gitignore`'s `.vercel` lines — harmless hygiene → kept.
    - `scripts/lib/asset-production-receipt.mjs` (`vercelTeamId`,
      `vercelProjectId`, `deploymentId`) and its test — the CR-016 / ADR-057
      *receipt contract* for the activation that ran on Vercel → kept
      unchanged; a Docker-era receipt is a CR-016 revision, not a rename.
    - `src/platform/integrations/core/connector-catalog.js` `vercel-webhook`
      entry — product catalog copy that already states no such endpoint exists
      → kept; owner decides whether the catalog entry should be retired.
    - Comments naming Vercel in `edge-device-registry.js` and
      `plugin-auth-service.js` — architecture notes and an RCA pointer, still
      true of any multi-instance or host-rewriting transport → kept.
    - `VERCEL_TOKEN` in the operator's private `.env` — not the repository's
      to remove.

D8. **The later VPS step needs no application change.** `.github/workflows/
    docker-image.yml` builds the image on every deployment-layer change and
    pushes tags to GHCR from `main`; `ZURI_WEB_IMAGE` lets a VPS
    `docker compose pull web` instead of building; replacing ngrok with a
    domain + reverse proxy is `--scale ngrok=0` plus a `PUBLIC_BASE_URL` change.

D9. **The Supabase pooler MODE follows deployment topology, not a fixed
    default (FR-145).** Verifying this deployment for real (2026-09-04) found
    every query paying a Supavisor transaction-mode round trip — the mode
    `src/lib/db.js` forced for every deployment because Vercel, a serverless
    platform with many concurrent short-lived invocations, was the only target
    that ever existed. Measured on the same host, same Supabase project, a
    pre-warmed connection pool: transaction mode (port 6543, `pgbouncer=true`)
    cost ~650-750ms per trivial query with **no** improvement across repeated
    calls; session mode (port 5432, no `pgbouncer` param) cost ~130-145ms,
    matching raw TCP RTT — a sustained ~5x difference, confirmed both over
    HTTP and in-process against the client directly. A single long-running
    container is exactly the case session pooling is for: one process holds a
    small, stable connection count for its whole lifetime, so it never needs
    the per-transaction backend-checkout mechanism that protects a Postgres
    instance from a burst of ephemeral serverless connections. `resolvePoolMode`
    now defaults to `session` and switches to `transaction` only when `VERCEL`
    (the platform's own env var) is present, with `ZURI_DB_POOL_MODE` as an
    explicit override for a topology neither branch guesses (e.g. several
    container replicas against one Postgres). Vercel's own behavior is
    unchanged.

## Consequences

- `docker compose up -d --build` starts the whole deployment; `docker compose
  logs -f` is the diagnostic surface; no Vercel account, token or dashboard is
  needed to run zuri-ai.
- Secure session cookies (`secure: NODE_ENV === 'production'`) work through the
  ngrok HTTPS origin and on `http://localhost` (browsers treat it as a secure
  context); they will not be set over plain HTTP from another LAN host.
- FR-045 local file mounts reason in `path.win32` on purpose (SEC-007); inside a
  Linux container that feature stays unavailable. Not changed here.
- The free ngrok tier shows a browser interstitial on first visit; API and
  webhook requests (no browser user agent) pass straight through.
- Dropping `vercel.json` drops the `icn1` region pin. An accidental future
  Vercel deploy would still work, only farther from the database.

## References

- FR-142 (`docs/PRD-SDD-v1.0.md`), `docs/deployment/docker-ngrok.md`
- ADR-007 P4, ADR-018, ADR-057, CR-016
- `.brain/rca/2026-08-21-production-database-secret-and-vercel-env.md`
