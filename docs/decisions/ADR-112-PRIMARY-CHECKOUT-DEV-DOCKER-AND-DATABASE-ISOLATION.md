---
id: ZAI:ADR-112
title: Primary-checkout development Docker deployment and database isolation
version: "0.1.0"
status: accepted
created_at: "2026-10-20T11:21:35+07:00,Codex"
last_update: "2026-10-20T11:21:35+07:00,Codex"
author: Codex
superseded_by: null
attributes:
  domain: platform-control
  doc_type: architecture-decision
  scope: "Local primary-checkout Docker development deployment, database isolation and production promotion boundary; this decision does not approve production deployment or database access"
relations:
  - type: relates_to
    target: ZAI:ADR-018
  - type: relates_to
    target: ZAI:ADR-058
  - type: relates_to
    target: ZAI:ADR-104
  - type: references
    target: ZAI:FR-120
---

# ADR-112 — Primary-checkout development Docker deployment and database isolation

**Status:** Accepted on 2026-10-20. This is a retrospective record of the
primary-checkout development setup and the environment boundary chosen for it.
It does not authorize production access, migration, deployment, or data copying.

## Context

[ADR-058](ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md) defines the
Docker Compose and ngrok deployment path. Its runbook explains that every
checkout shares the Compose project name `zuri-ai` unless a distinct project name
is explicitly selected. A Knowledge Studio preview, a UAT stack, and a
primary-checkout development preview therefore cannot be assumed to use the same
application image, database, volume, or environment configuration.

On 2026-10-20, the primary checkout was deployed for development review in a
separate Compose project. Its web container uses a loopback-only host binding and
its PostgreSQL container has a separate named volume. An ngrok tunnel forwarded
to that local web port so the owner could sign in remotely. This setup made the
active application and database target explicit after a prior preview had opened
a different worktree.

The production data boundary remains governed by
[ADR-018](ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md). Production database
changes and image replacement remain subject to
[ADR-104](ADR-104-PRODUCTION-MIGRATION-LINEAGE-RECONCILIATION.md) and the
existing release gates. Creating a separate development database does not change
those authorities.

## Decision

### D1 — Isolate each runtime environment

The primary-checkout development preview must use its own Docker Compose project,
PostgreSQL database, persistent local volume, and environment configuration. It
must not share a live database connection with Knowledge Studio, UAT, or
production, or share its local PostgreSQL volume with another local stack. A
project name must be explicitly selected when the default `zuri-ai` project
could overlap another checkout.

The instance recorded here is `zuri-main-dev-20261020`, with database
`zuri_main_dev` and a web binding on `127.0.0.1:3100`. These values document the
verified local instance; a later instance may use different names or ports while
preserving the isolation boundary.

### D2 — Development is not a production promotion target

Finishing development work does not mean changing the development container's
`DATABASE_URL` to production. The production release runs as a separate runtime,
uses production-specific credentials and database configuration, and deploys a
reviewed app artifact or commit after its applicable checks pass. Production
schema changes use the approved migration process, backup evidence, and rollback
path. This ADR does not grant production access or approve any particular release.

UAT remains a separate acceptance environment. If representative data is needed
for development, it must be copied only into a separate development database
through a separately reviewed and authorized process; a live shared connection
is not an option.

### D3 — Treat the ngrok preview as internet-accessible

When the tunnel is active, the development app is reachable from outside the
machine. Development-only identities and suitable test data must be used there.
Passwords, tokens, and generated environment values never belong in source,
tracked documentation, or container images. A development credential must not be
reused in UAT or production.

Signup follows [FR-120](../requirements/FR-120.md): it creates a `Person` and
`PersonCredential` and records an audit event, but grants no `PlatformGrant`,
Tenant, Business, Space, Project, or `WorkspaceMembership`. An account created
to verify this preview therefore has no scope over another environment or
business.

## Alternatives and consequences

**Point the development app at UAT.** Rejected. It would couple everyday
implementation and resets to the acceptance database, making test state and
results harder to preserve and reproduce.

**Point the development app at production after the code is finished.** Rejected.
A database connection switch is not a release process and could let an
unreleased image operate on production data. Production receives a separate
runtime and configuration after the release gates.

**Use an isolated development Compose project and database.** Chosen. It keeps
local development state persistent and separate while using the same Docker
execution model. The tradeoff is an additional named project, volume, and local
configuration to maintain.

## Verification

The decision was recorded after these checks on 2026-10-20:

| Check | Observed result |
|---|---|
| Main development Compose project | `zuri-main-dev-20261020`; web and database containers reported healthy |
| App binding | `127.0.0.1:3100` to container port `3000` |
| Database | PostgreSQL database `zuri_main_dev`; named volume `zuri-main-dev-20261020_db-data`; no host port published |
| Application image | `zuri-ai-main-dev:30911f98`, built from source revision `30911f98e12d535133e77dbe3c3bd42ed6ee9864` |
| Authentication smoke check | Signup and login succeeded against the development database, locally and through the active ngrok route |
| Production state | No production database was configured or changed by this setup; this check is not evidence of production readiness or release |

The observed checks establish a local development preview and its authentication
path only. They do not establish hosted production deployment, UAT acceptance,
production migration readiness, or production security review.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0 | 2026-10-20 | accepted | Retrospectively records isolated primary-checkout Docker development, separate database ownership, ngrok exposure, and the production promotion boundary | uncommitted | Codex |