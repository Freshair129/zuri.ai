---
version: "1.3.5b"
created_at: "2026-09-03T21:30:00+07:00,CLAUDE"
last_update: "2026-10-20,SOL"
status: "current"
superseded_by: null
attributes:
  domain: "platform-control"
  doc_type: "deployment-guide"
  scope: "Running zuri-ai locally with Docker Compose and optionally exposing it through ngrok"
---

# Deploying zuri-ai with Docker Compose and optional ngrok

For the opt-in private inference connection, see [Private Runtime integration](private-runtime.md).
It adds verified internal HTTPS and preserves this deployment's database and job owners.

**Version:** 1.3.5b · **Status:** current · Decision: [ADR-058](../decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md) · Requirements: FR-142, [FR-289](../requirements/FR-289.md)

For the owner-requested Windows reinstall and existing-database move, start with
[Windows recovery and Docker handoff](windows-recovery-and-docker-handoff.md).
It covers backup/config custody, restore rehearsal and the separate PostgreSQL
Marketing receiver gate; this guide's start commands are not restore instructions.

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

`web` is the only public-facing service. Run the Compose commands from
`apps/server`; Compose reads `apps/server/.env` as its interpolation file and as the
web container's `env_file`, with the optional `apps/server/.env.docker` overlay.
The repository-root `.env`, if present, is not the Server app's dotenv source for
these commands. The standalone Edge CLI has separate working-directory dotenv
behavior, and managed Desktop disables dotenv in favor of its private settings.

The legacy zuri-cli forwarding seam remains **`POST https://<NGROK_DOMAIN>/api/agent/line-webhook`**.
The optional Server transport also exposes the account-scoped
`/api/line-oa/accounts/{id}/webhook` route under ADR-061; configure that account
from LINE OA Studio. Platform Integrations shows status/model metadata and is not a
second LINE webhook setup surface.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine 24+ with the Compose plugin
  (`docker compose version` ≥ 2.24 — `env_file: required: false` and
  `depends_on: required: false` are used).
- An ngrok account, **authtoken**, and **assigned/static domain** only when opting
  into public ingress. Local Docker deployment does not require ngrok.
- A Postgres database: either the bundled `local-db` profile or an external one
  (Supabase). Production mode refuses SQLite by design
  (`src/lib/db.js` → `PRODUCTION_DATABASE_URL_REQUIRED`).

## Setup

From the repository root, enter the Server app before running the following commands:

```bash
cd apps/server
```

1. Copy `.env.example` → `.env`.
2. Fill the required values:
   - `ZURI_SESSION_SECRET` — random, ≥ 32 characters.
   - `DATABASE_URL` — a Postgres URL (see the two options below).
   - `PUBLIC_BASE_URL` — local origin for local-only deployment, or
     `https://<your assigned ngrok domain>` for public deployment (left empty,
     Compose derives it from `NGROK_DOMAIN`).
3. To enable public ingress, add `NGROK_AUTHTOKEN` and an assigned `NGROK_DOMAIN`
   (e.g. `my-zuri.ngrok-free.app`). Temporary/random ngrok URLs are disabled.
4. `npm run docs:graph` from the repository root. This refreshes the ignored graph
   used by the Knowledge Studio read-only mount.
5. `docker compose build`
6. Start local-only with `docker compose up -d web`, or opt into the assigned public
   endpoint with `docker compose --profile public up -d`.

or, on Windows, run the two steps and the URL lookup in one go:

```powershell
.\scripts\deploy.ps1
```

For an isolated checkout or a separately named local stack, keep its private
Compose values in a dedicated env file and select the Compose project explicitly.
The selected file must set `ZURI_WEB_ENV_FILE` to the runtime env file that
contains that stack's database URL and secrets. If `.env.docker` exists, set
`ZURI_WEB_DOCKER_ENV_FILE` explicitly as well so a custom stack cannot silently
inherit its overrides. If `apps/server/.env.knowledge` exists, set
`ZURI_KNOWLEDGE_ENV_FILE` to a separate per-project file; the wrapper rejects
inheritance of the default knowledge credentials. Each named project must use web and (when `local-db` is
active) tools image tags that end in `.<ProjectName>`; the wrapper checks this
before building so two projects cannot retag or consume one another's images.
Both wrappers validate the effective name returned by `docker compose config`,
so an inherited `COMPOSE_PROJECT_NAME` receives the same check as an explicit
PowerShell `-ProjectName`. The dot marker cannot be part of a Compose project
name, so suffix-related names such as `studio` and `knowledge-studio` remain
distinct.
Project names scope containers and volumes, while external database targets are
shared unless configured separately.

The PowerShell wrapper accepts quoted selector paths and trailing inline comments
in Compose dotenv syntax. It requires the three runtime selector values to be
literal paths and rejects variable interpolation so its isolation checks compare
the same paths Compose loads. Other values in the selected env file retain normal
Compose interpolation behavior.

```powershell
.\scripts\deploy.ps1 -EnvironmentFile .env.knowledge-studio.local -ProjectName zuri-knowledge-studio-local
```

`-EnvironmentFile` accepts a path relative to `apps/server` or an absolute path;
`-ProjectName` scopes build, start and status commands to that Compose project
and is appended to each image tag after a dot as the uniqueness marker (for
example,
`ZURI_WEB_IMAGE=zuri-ai-knowledge-studio:next15.zuri-knowledge-studio-local`).
The default remains `.env` and the default Compose project name, so existing
deployments keep their current behavior. The env file's values stay out of the
command line. For public mode, the Windows wrapper also reads
`NGROK_INSPECT_PORT` and passes it to the tunnel URL probe; the default remains
4040.

The wrapper defaults to local-only deployment. Add `-Public` to opt into ngrok;
the token and assigned domain are checked before the public profile can start:

```powershell
.\scripts\deploy.ps1 -Public
```

(`scripts/deploy.sh` accepts `--public`.) Both scripts refresh the graph before
building or starting. The host needs the repository's Node dependencies installed
for that step. Local-only mode stops before deployment if the resolved
`COMPOSE_PROFILES` already includes `public`, so a shell or `.env` override cannot
silently start ngrok without the explicit wrapper option.

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

### Knowledge Studio source data (FR-289)

The operator-only Knowledge Studio API reads the generated graph and canonical
Markdown through read-only mounts from the deployment checkout. Compose mounts
`docs/` and `registry/document-registry/index.json` at
`/app/knowledge-studio-data`; the web container uses that path as its explicit
data root. `scripts/deploy.ps1` refreshes the ignored `docs/.doc-graph.json`
from canonical sources before building or starting the stack. The generated
graph stays local and is not committed.

The graph canvas remains a local-browser bridge to the captured renderer at
`http://127.0.0.1:19860`. The Zuri image does not include or publish that
renderer. The operator's browser must be on the same machine as its local host;
other browsers can load the Zuri console but cannot use the local canvas unless
they separately have that host running.

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

Public checks (only when the `public` profile is explicitly enabled):

- `https://<NGROK_DOMAIN>/api/health` → same body over HTTPS.
- `https://<NGROK_DOMAIN>/login` → the console (on the free tier ngrok shows a
  one-time browser interstitial; API and webhook requests are not affected).
- `https://<NGROK_DOMAIN>/api/agent/line-webhook` — `POST` only; an empty batch
  from an unbound caller is refused by the fail-closed scope resolver (a 4xx,
  never a 404), which is the expected signature of the seam being reachable.

The URL lookup helper reads ngrok's inspection API on
`http://127.0.0.1:4040/api/tunnels` (published on the host loopback only).
`docker compose logs ngrok` shows the same `url=` line. It requires the public
profile to be running with its assigned domain.

## Public URL and the LINE webhook

| Mode | `NGROK_DOMAIN` | Public URL | Survives restart |
|---|---|---|---|
| Public profile | `my-zuri.ngrok-free.app` | `https://my-zuri.ngrok-free.app` | yes |
| Local-only default | empty | no public URL | not applicable |

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
docker compose up -d web          # start / apply local web changes (idempotent)
docker compose up -d --build web  # build and start local web in one step
docker compose ps                 # status + health
docker compose logs -f            # follow all logs (or: logs -f web)
docker compose restart web        # restart the app only
docker compose down               # stop everything, keep the data volume
```

PowerShell wrappers: `scripts/deploy.ps1 [-NoBuild] [-Pull]`, `scripts/logs.ps1
[service]`, `scripts/stop.ps1 [-RemoveVolumes]`, `scripts/ngrok-url.ps1`.

Local development is unchanged: `npm run dev` (SQLite) still works from the same
checkout; Docker is an additional execution path.

**Production includes the LINE server overlay on every deploy.** The ADR-061
server transport lives in `docker-compose.line-server.yml` (worker token, reply
sealing key, the read-only credential mount, `ZURI_LINE_SERVER_ENABLED`) plus the
`line-worker` service behind the `line-server` profile. The production `.env` makes
that the default for every command in this section:

```bash
COMPOSE_FILE=docker-compose.yml;docker-compose.line-server.yml   # ':' on Linux/macOS
COMPOSE_PROFILES=line-server
```

Two traps. An explicit `-f` replaces `COMPOSE_FILE`, so
`docker compose -f docker-compose.yml up -d` silently drops the overlay — list both
files and `--profile line-server` whenever you pass `-f`. And a host without the LINE
credential must not set these, because the overlay refuses to interpolate without
its variables. Dropping the overlay is not a degraded mode: `web` answers every LINE
delivery and every edge job claim with 503 until it is back
([RCA 2026-09-11](../../.brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md)).

**Every checkout of this repo shares the one Compose project.**
`docker-compose.yml` pins `name: zuri-ai` explicitly, so `docker compose`
commands run from a git worktree of this repo resolve to the *same* project
and act on the *same* live containers as the primary checkout — there is no
directory-based isolation the way there is for `git`. A worktree carries no
`.env` by default, so `docker compose up` there would recreate the running
deployment from a tree missing every secret. If a genuinely separate stack is
ever needed, pass an explicit `-p <other-name>` (and mind that only one agent
can hold a given ngrok domain).

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

1. Image publication is suspended under [ADR-062](../decisions/ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md).
   `.github/workflows/docker-image.yml` validates Compose and builds on all existing
   triggers, but never logs into or pushes to GHCR. Existing public image versions
   remain available; new commits do not update those tags. A later VPS deployment
   must first verify a private image destination and authenticated pull before
   selecting its immutable image digest with `ZURI_WEB_IMAGE`.
2. Put a domain + TLS terminator (Caddy/Nginx/Cloudflare Tunnel) in front of
   `web:3000` and set `PUBLIC_BASE_URL=https://<domain>`.
3. Disable the tunnel: `docker compose --profile public stop ngrok`, or remove the
   service.

## Database connection pooling (FR-145, ADR-058 D9)

If `DATABASE_URL` points at a Supabase `*.pooler.supabase.com` host, `src/lib/db.js`
picks the Supavisor pooler MODE automatically — no operator action needed:

- **Session pooling** (port 5432, default): correct for this deployment. One
  container is one long-running process; a small, stable connection count and
  one Postgres round trip per query is both sufficient and fast.
- **Transaction pooling** (port 6543, `pgbouncer=true`): only when the `VERCEL`
  env var is present — a serverless platform with many concurrent short-lived
  invocations, where transaction-mode pooling protects Postgres from a
  connection burst at the cost of a per-transaction backend checkout on every
  query.

Measured 2026-09-04 against a real production Supabase project from this exact
deployment, same host, a pre-warmed connection pool: transaction mode cost
~650-750ms per trivial query with no improvement across repeated calls; session
mode cost ~130-145ms, matching raw TCP round-trip time — a sustained ~5x
difference. `GET /api/health`'s `dbLatencyMs` field is the fastest way to see
which mode is active on a given deployment.

Set `ZURI_DB_POOL_MODE=transaction` in `.env` only for a topology this
auto-detection cannot see — e.g. several container replicas sharing one
Postgres, which needs transaction-mode's connection-limit protection despite
not being Vercel. Leave it unset otherwise.

## Known limits

- FR-045 local file mounts use Windows path semantics on purpose (SEC-007); the
  feature is unavailable inside the Linux container.
- Ollama on the host is not reachable as a container "loopback" provider; the
  Phase 1 runtime should use its production provider path.
- The edge-device heartbeat registry is process-local (FR-141); one container is
  one instance, which is the simplest case.

## Publication containment revision

2026-10-20, version 1.3.3b → 1.3.4b: public ingress requires explicit profile
selection, an authtoken and an assigned domain; default deploy is local-only. A
temporary ngrok URL can no longer be created by the Compose service.

2026-10-20, version 1.3.4b → 1.3.5b: the PowerShell deploy wrapper accepts a
private Compose env-file path and an explicit project name for isolated local
deployments, while retaining local-only defaults and the public-ingress gate.

2026-10-20, version 1.3.2b → 1.3.3b: documents the read-only Knowledge Studio
source mounts and local-renderer requirement; the deployment script refreshes the
generated graph before starting Compose.

2026-10-06, version 1.3.1b → 1.3.2b: adds navigation to the owner-requested Windows recovery/Docker handoff; no Compose, runtime, database, migration or deployment change.

2026-09-06, version 1.1.0 → 1.2.0b: private source conversion completed; registry
publication suspended pending private release review. The observed local service
uses `zuri-ai-web:local` and was healthy. This change does not restart it or change
its environment, database, ngrok configuration or existing public image versions.

2026-09-10, version 1.2.0b → 1.3.0b: documented app-local Compose dotenv ownership,
separated the legacy forwarding webhook from the account-scoped Server webhook, and
corrected the deployment script's repository-root wording.
