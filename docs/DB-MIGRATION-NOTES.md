# Database Migration Notes — SQLite → PostgreSQL

| Field | Value |
|-------|-------|
| **Version** | 1.0.3 |
| **Status** | Approved |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-18 |

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

1. `npm run db:pg:sql` — regenerates `prisma/schema.postgres.prisma` (datasource swap
   only) and emits `prisma/postgres/0001_init.sql`. The two schemas can't drift.
2. In `.env` (see `.env.example`): set `DATABASE_URL` to the Supabase **pooler** URL and
   `DIRECT_URL` to the **direct** connection (migrations use direct, runtime the pooler).
3. Apply the DDL against Supabase: `prisma db execute --file prisma/postgres/0001_init.sql
   --schema prisma/schema.postgres.prisma` (or `prisma migrate deploy`).
4. Data move, **UUID-preserving** (printed docs / LINE bindings / ExternalRef keep
   resolving — the hard rule): `npm run db:pg:export` on the SQLite box → `snapshot.json`;
   then, with `DATABASE_URL` pointed at Supabase, `npm run db:pg:import` (refuses a
   non-empty target). `importSnapshot` recreates each row with its original id.
5. Re-run the suite against Postgres; integration tests are provider-independent.

### Phase 1 runtime connection metadata (FR-074 / ADR-031)

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

### Phase 1 Supabase Vault resolver (FR-075 / ADR-032)

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
