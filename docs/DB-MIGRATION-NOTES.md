# Database Migration Notes — SQLite → PostgreSQL

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Approved |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-19 |

The MVP schema was designed to move to Postgres without semantic changes.

FR-043 adds nullable `Project.businessId` alongside the existing `workspaceId`.
The additive backfill copies `Workspace.businessId`; null is retained only for
explicit portfolio/tenant shared Projects. The generated Postgres schema carries
the same relation and index, so export/import preserves both UUID references.

## What already migrates cleanly

- All enums are persisted as `String` + validated by Zod — swap to native Postgres
  enums later (optional) or keep text + CHECK constraints.
- UUID PKs are application-generated (`crypto.randomUUID` via Prisma `uuid()`)
  — no SQLite-specific identity.
- JSON columns are `String` in SQLite; change to `Json` type in Postgres and drop
  the stringify/parse layer incrementally (`safeParse` helpers isolate this).
- No SQLite-specific SQL is used anywhere (pure Prisma client API).

## Migration procedure (recommended)

1. Change `datasource db` provider to `postgresql`, set `DATABASE_URL`.
2. Optionally upgrade `String` JSON fields to `Json` and adjust the (small) JSON
   helper layer.
3. `prisma migrate dev` to generate the initial Postgres migration.
4. Move data by **domain-level export/import**, not file copy:
   - `GET /api/backup/export` on the SQLite instance → snapshot JSON,
   - `POST /api/backup/import {confirm:true}` on the Postgres instance
   (snapshot format is provider-agnostic).
5. Re-run the full test suite; integration tests are provider-independent.

## Supabase cutover — concrete steps (FR-030, ADR-007 P4)

The lab stays SQLite (`prisma/schema.prisma`); production is generated, not hand-edited:

1. `npm run db:pg:sql` — regenerates `prisma/schema.postgres.prisma` and emits
   `prisma/postgres/0001_init.sql`. The generated Postgres schema uses a separate
   `@zuri/prisma-postgres` client; the default `@prisma/client` remains
   SQLite for the lab/test provider.
2. In `.env` (see `.env.example`): set `DATABASE_URL` to the Supabase **pooler** URL and
   `DIRECT_URL` to the **direct** connection (migrations use direct, runtime the pooler).
3. Apply the DDL against Supabase: `prisma db execute --file prisma/postgres/0001_init.sql
   --schema prisma/schema.postgres.prisma` (or `prisma migrate deploy`).
4. Data move, **UUID-preserving** (printed docs / LINE bindings / ExternalRef keep
   resolving — the hard rule): `npm run db:pg:export` on the SQLite box → `snapshot.json`;
   then, with `DATABASE_URL` pointed at Supabase, `npm run db:pg:import` (refuses a
   non-empty target). `importSnapshot` recreates each row with its original id.
5. Production installs run `scripts/generate-prisma-clients.mjs`; `src/lib/db.js`
   selects the Postgres client when `DATABASE_URL` is `postgres:`/`postgresql:` and
   keeps SQLite when the URL is `file:`. Re-run the suite against the selected
   provider; integration tests remain provider-independent.

## Runtime bootstrap contract — ZV2-CR-009 / ADR-035

The Windows runners now make provider choice explicit:

- `run.bat` is the PostgreSQL/Supabase application runner. It loads the ignored `.env` into the
  child process, requires a PostgreSQL `DATABASE_URL`, performs a read-only application-schema
  check and starts Next.js. It never runs `db:push`, `db:reset`, `db:clean` or a demo seed against
  PostgreSQL.
- `run-local.bat` is the offline SQLite runner. It owns `file:./dev.db`, local `db:push` and the
  idempotent demo seed.
- `npm run db:push`, `npm run db:clean` and `npm run db:reset` are SQLite-only and fail closed when
  a PostgreSQL URL is present.
- `npm run db:seed` selects `@zuri/prisma-postgres` for a PostgreSQL URL, but requires the explicit
  `ZURI_ALLOW_POSTGRES_SEED=1` opt-in. Normal PostgreSQL startup skips demo seed because the target
  may be production.
- `run.bat` also leaves `ZURI_LOCAL_DEMO_AUTH` disabled for PostgreSQL. A separate
  `ZURI_ALLOW_POSTGRES_LOCAL_DEMO=1` opt-in is required for an approved non-production target.

The runtime URL should use the Supabase session pooler for a long-lived IPv4-only Windows process;
`DIRECT_URL` is reserved for migration/operator commands. Neither URL is printed or sent to the
browser. A missing application table is a bootstrap failure; apply the reviewed Supabase migration
history through the operator/deployment process before retrying the runner. This startup contract
does not apply migrations, import snapshots or enable LINE traffic.

### Application identity and review queue deployment (FR-076 / FR-078)

The private customer projection and the application RBAC store are separate
boundaries. The following tracked Supabase migrations provision the application
schema and project only the verified customer scope into it:

- `20260818084011_application_schema.sql` — Prisma/Postgres application schema,
  RLS enabled on public application tables and no `anon`/`authenticated` table
  grants;
- `20260818084047_application_smartgift_identity.sql` — Wannapa Workspace,
  `TNT-ETOHGROUP`, all four Businesses, `PER-BOSS` tenant employment and one
  `CUSTOMER_DATA_REVIEWER` binding for `BUS-SMARTGIFT`.
- `20260818090201_customer_review_runtime_login.sql` — a dedicated,
  unprivileged `zuri_customer_review_login` that may `SET LOCAL ROLE
  zuri_app_runtime` and has no direct private-schema grants.

The review adapter must receive an explicit server-only
`ZURI_CUSTOMER_REVIEW_DATABASE_URL` using the dedicated login, pointing at the
private `zuri_core` database connection. Provision its password with
`scripts/provision-customer-review-runtime-login.mjs` using deployment-only
`ZURI_ADMIN_DB_URL` and `ZURI_CUSTOMER_REVIEW_DB_PASSWORD` environment values;
the admin URL is never the review runtime URL. It must never be inferred from a
browser URL or a Data API client.

### Phase 1 runtime connection metadata (FR-079 / ADR-031)

Production Phase 1 connection metadata belongs to the private `zuri_core` schema,
not the exposed Data API. Apply
`supabase/migrations/20260818040000_phase1_line_runtime_connections.sql` only
after the production tenant/bootstrap migration. It creates provider,
Business-scoped connection and opaque credential-reference tables, forced RLS,
read-only `zuri_line_smartgift_ro` access, and the database-enforced single
`ACTIVE PRIMARY` `PHASE1_LINE_LLM` index. It does not create or migrate raw
provider credentials; those remain in the owner-selected external secret manager.

`prisma/postgres/0002_phase1_line_primary_connection.sql` is the corresponding
generic Prisma/Postgres lab invariant for the canonical SQLite schema. It is not
a substitute for the private Supabase migration or its role/RLS grants.

### Phase 1 Supabase Vault resolver (FR-080 / ADR-032)

Apply
`supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql`
after the connection metadata migration. It creates the `zuri_line_runtime`
NOLOGIN role, allows the dedicated login to set it locally, and exposes only the
`zuri_core.resolve_phase1_line_secret` `SECURITY DEFINER` function. The function
rechecks active primary connection scope and reads
`vault.decrypted_secrets.decrypted_secret`; no app/Data API/read-only role gets a
direct Vault view grant. The application stores only
`supabase-vault:<uuid>` in `IntegrationCredential.secret_ref`.

The migration has an apply-time guard requiring the migration executor (which
becomes the function owner) to resolve and `SELECT` the Vault decrypted view. A
live proof must record `pg_get_userbyid(p.proowner)` for the resolver and confirm
`has_table_privilege(function_owner, 'vault.decrypted_secrets', 'select')`, plus
the expected execute/revoke boundary. If this precondition fails, the migration
stops before creating a non-functional resolver.

The Supabase CLI was not available in this workspace, so the migration is a
reviewed repository artifact and static contract tests cover it. Applying it to
a live project, creating the Vault secret, recording its opaque UUID in the
metadata UI and proving the dedicated role are still production gates.

## DB boundary — Zuri DB ≠ MSP DB (do not merge)

MSP persists in **its own store** (the `D:\msp` repo, reached over stdio), configured by
`MSP_DB_URL` / `MSP_DB_PATH` — never `DATABASE_URL`. `src/lib/db-boundary.js`
(`assertDbBoundary`) refuses a shared store at startup. MVP may share one Postgres
*instance* but must use a separate database/schema/role, because MSP and Zuri have
different lifecycles: an MSP migration failure must never drag CRM/audit/invoice down.
DuckDB remains a local cache/analytics/eval tier — not the transactional store.

## Cautions

- `AuditEvent` stream should be append-only in Postgres too (no updates/deletes;
  consider a DB-level rule).
- SQLite dates round-trip as ISO strings in snapshots; Prisma coerces on create —
  verified by the round-trip test.
- Do NOT copy `dev.db` into anything production — per INTEGRATION-MAP, migration
  is export → schema migration → import/reconciliation.
