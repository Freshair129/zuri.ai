---
version: "1.0.0"
created_at: "2026-09-03T21:30:00+07:00,CLAUDE"
last_update: "2026-09-03T21:30:00+07:00,CLAUDE"
status: "current"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "deployment-guide"
  scope: "Running zuri-ai with Docker Compose on a host machine and exposing it through ngrok"
---

# Deploying zuri-ai with Docker Compose + ngrok

**Version:** 1.0.0 · **Status:** current · Decision: [ADR-058](../decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md) · Requirement: FR-142

This is the deployment path that replaces Vercel. Nothing about the application
changed to make it possible except a liveness probe (`GET /api/health`) and one
public-origin variable (`PUBLIC_BASE_URL`).

```text
Internet
   │
   ▼
https://<NGROK_DOMAIN>  (ngrok HTTPS endpoint)
   │
   ▼
Host machine (Docker Desktop / Docker Engine)
   │
   ▼
Docker Compose — network zuri-network
   ├── ngrok        ngrok/ngrok:3         → http://web:3000
   ├── web          zuri-ai (Next.js)     UI + /api/** + POST /api/agent/line-webhook
   └── [local-db]   db (postgres:16)      volume db-data — or an external Postgres (Supabase)
                    db-migrate            one-shot `prisma db push`, then exits
```

`web` is the only public-facing service. The LINE Messaging API webhook itself is
owned by the zuri-cli transport (a separate process); it forwards normalized events
to **`POST https://<NGROK_DOMAIN>/api/agent/line-webhook`**, the one inbound webhook
this application serves.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine 24+ with the Compose plugin
  (`docker compose version` ≥ 2.24 — `env_file: required: false` and
  `depends_on: required: false` are used).
- An ngrok account and its **authtoken** (dashboard → Your Authtoken).
- Optional but recommended: an ngrok **assigned/static domain** (dashboard →
  Domains; the free tier includes one). Without it the public URL changes on
  every start.
- A Postgres database: either the bundled `local-db` profile or an external one
  (Supabase). Production mode refuses SQLite by design
  (`src/lib/db.js` → `PRODUCTION_DATABASE_URL_REQUIRED`).

## Setup

1. Copy `.env.example` → `.env`.
2. Fill the required values:
   - `ZURI_SESSION_SECRET` — random, ≥ 32 characters.
   - `DATABASE_URL` — a Postgres URL (see the two options below).
   - `PUBLIC_BASE_URL` — `https://<your ngrok domain>` (left empty, Compose
     derives it from `NGROK_DOMAIN`).
3. Add `NGROK_AUTHTOKEN`.
4. Add `NGROK_DOMAIN` if you have an assigned domain (e.g. `my-zuri.ngrok-free.app`).
5. `docker compose build`
6. `docker compose up -d`

or, on Windows, run the two steps and the URL lookup in one go:

```powershell
.\scripts\deploy.ps1
```

(`scripts/deploy.sh` is the bash equivalent.) Both scripts are idempotent.

### Database option A — bundled Postgres (`local-db` profile)

In `.env`:

```dotenv
COMPOSE_PROFILES=local-db
POSTGRES_USER=zuri
POSTGRES_PASSWORD=<choose one>
POSTGRES_DB=zuri
DATABASE_URL=postgresql://zuri:<the same password>@db:5432/zuri
```

`db` publishes no host port; only containers on `zuri-network` can reach it.
`db-migrate` pushes `prisma/schema.postgres.prisma` before `web` starts, then
exits. Data lives in the named volume `db-data` and survives `docker compose
down`; only `docker compose down -v` (or `scripts/stop.ps1 -RemoveVolumes`)
deletes it.

**Keeping SQLite for `npm run dev`:** leave `DATABASE_URL="file:./dev.db"` in
`.env` and put the Postgres URL in `.env.docker` (same format, gitignored).
Compose applies `.env.docker` after `.env` inside the containers only.

### Database option B — Supabase / external Postgres

Leave `COMPOSE_PROFILES` unset and point `DATABASE_URL` (pooler, port 6543)
and `DIRECT_URL` (direct, port 5432) at the project, exactly as the Vercel
deployment did. Apply the schema through the existing runbooks
(`prisma/postgres/*.sql`, `supabase/migrations/*.sql`) — the container never
mutates an external database on start. `ZURI_LINE_DB_CA_FILE` and
`ZURI_CUSTOMER_REVIEW_DB_CA_FILE` are fixed by Compose to
`/app/certs/supabase-prod-ca-2021.crt`, which ships in the image.

### First account

The demo seed (`npm run db:seed`) is SQLite-only. On Postgres create the first
account through `/signup`, or bootstrap the installation operator (FR-107):

```bash
docker compose run --rm --no-deps db-migrate node scripts/bootstrap-operator.mjs --email you@example.com --name "Your Name"
```

## Verification

```bash
docker compose ps
```

Expected: `web` **healthy**, `ngrok` **running** (it starts only after `web` is
healthy), and with the profile `db` **healthy**, `db-migrate` **exited (0)**.

```bash
docker compose logs -f
```

Every container logs to stdout/stderr: Next.js request logs and the app's
structured JSON records under `web`, ngrok's JSON agent log (including the
assigned `url=`) under `ngrok`, Postgres under `db`.

Local checks on the host:

- `http://localhost:3000/api/health` → `{"status":"ok","db":"ok",…}`
- `http://localhost:3000/login` → the console.

Public checks:

- `https://<NGROK_DOMAIN>/api/health` → same body over HTTPS.
- `https://<NGROK_DOMAIN>/login` → the console (on the free tier ngrok shows a
  one-time browser interstitial; API and webhook requests are not affected).
- `https://<NGROK_DOMAIN>/api/agent/line-webhook` — `POST` only; an empty batch
  from an unbound caller is refused by the fail-closed scope resolver (a 4xx,
  never a 404), which is the expected signature of the seam being reachable.

Finding the public URL when no static domain is configured:

```powershell
.\scripts\ngrok-url.ps1
```

It reads ngrok's inspection API on `http://127.0.0.1:4040/api/tunnels`
(published on the host loopback only). `docker compose logs ngrok` shows the
same `url=` line.

## Public URL and the LINE webhook

| Mode | `NGROK_DOMAIN` | Public URL | Survives restart |
|---|---|---|---|
| Static domain (recommended) | `my-zuri.ngrok-free.app` | `https://my-zuri.ngrok-free.app` | yes |
| Fallback | empty | `https://<random>.ngrok-free.app` | **no** — re-read it after every start |

The webhook URL to give the zuri-cli transport (and, through it, the LINE
Developers console) is:

```text
https://<NGROK_DOMAIN>/api/agent/line-webhook
```

The Platform → Integrations page renders this from the origin it is served from,
so opening the console through the ngrok URL shows the exact value.

## Day-to-day commands

```bash
docker compose build              # rebuild the image after a code change
docker compose up -d              # start / apply changes (idempotent)
docker compose up -d --build      # both in one step
docker compose ps                 # status + health
docker compose logs -f            # follow all logs (or: logs -f web)
docker compose restart web        # restart the app only
docker compose down               # stop everything, keep the data volume
```

PowerShell wrappers: `scripts/deploy.ps1 [-NoBuild] [-Pull]`, `scripts/logs.ps1
[service]`, `scripts/stop.ps1 [-RemoveVolumes]`, `scripts/ngrok-url.ps1`.

Local development is unchanged: `npm run dev` (SQLite) still works from the same
checkout; Docker is an additional execution path.

## Ports

| Service | Internal port | Host binding (default) | Public? |
|---|---|---|---|
| web | 3000 | `127.0.0.1:${WEB_PORT:-3000}` | via ngrok only |
| ngrok inspection UI/API | 4040 | `127.0.0.1:${NGROK_INSPECT_PORT:-4040}` | no |
| db (profile) | 5432 | none | no |
| db-migrate (profile) | — | none | no |

Set `WEB_BIND_ADDRESS=0.0.0.0` only if the LAN should reach the container
directly (session cookies are `Secure` in production mode and will not be set
over plain HTTP from another host).

## Security notes

- No secret is baked into an image or written into `docker-compose.yml`;
  everything is `${VARIABLE}` or `env_file`. `.dockerignore` drops every
  `.env*` except the template; `.gitignore` keeps `.env` and `.env.docker`
  private.
- The ngrok authtoken reaches only the `ngrok` container.
- The database and the inspection UI are never published beyond loopback.
- `NODE_ENV=production` is forced inside the container.
- CORS/trusted hosts: the app has no origin allowlist to update. The only
  host-sensitive rule is `GET /api/docs`, which serves without a session on
  loopback only — through ngrok the hostname is the public domain, so a session
  or API key is required, as intended (SEC-006). Plugin redirect URIs are matched
  exactly (`ZURI_PLUGIN_REDIRECT_URIS`), unaffected by the ingress.
- **Host header.** The ngrok service runs with `--host-header=preserve`. The
  agent's default rewrites `Host` to the upstream address, which (a) makes
  `/api/docs` believe it is being called on loopback when the upstream is
  `localhost` — verified on 2026-09-03 with a manual `ngrok http 3100`: the
  OpenAPI document became publicly readable — and (b) would make the plugin
  consent redirect (`/api/plugin/auth/authorize` builds its target from the
  request origin) point at `http://web:3000`. Never tunnel this app with a
  rewritten Host header; if you run the host agent by hand, pass
  `--host-header=preserve` too.
- Behind any TLS terminator (ngrok included) Next.js still derives
  `request.url` from the plain-HTTP socket, so the one absolute redirect the app
  issues (the plugin consent hand-off, FR-123) carries an `http://` scheme. ngrok
  serves the domain over HTTPS only. This flow was not exercised here and is
  listed under Known limits.

## Moving to a VPS later

No application change is needed:

1. `.github/workflows/docker-image.yml` pushes `ghcr.io/<owner>/<repo>:<tag>` on
   every push to `main`. On the VPS set `ZURI_WEB_IMAGE` to that tag and
   `docker compose pull web && docker compose up -d`.
2. Put a domain + TLS terminator (Caddy/Nginx/Cloudflare Tunnel) in front of
   `web:3000` and set `PUBLIC_BASE_URL=https://<domain>`.
3. Disable the tunnel: `docker compose up -d --scale ngrok=0`, or remove the
   service.

## Known limits

- FR-045 local file mounts use Windows path semantics on purpose (SEC-007); the
  feature is unavailable inside the Linux container.
- Ollama on the host is not reachable as a container "loopback" provider; the
  Phase 1 runtime should use its production provider path.
- The edge-device heartbeat registry is process-local (FR-141); one container is
  one instance, which is the simplest case.
