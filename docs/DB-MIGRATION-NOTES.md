# Database Migration Notes — SQLite → PostgreSQL

| Field | Value |
|-------|-------|
| **Version** | 1.0.8 |
| **Status** | Approved |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-09-06 |

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

## Migration discipline — production columns come from `supabase/migrations/` only

Three files describe the schema and they are not interchangeable:

| File | What it is | How it reaches a database |
|---|---|---|
| `prisma/schema.prisma` | the canonical model; SQLite for dev and test | `prisma db push` — the file IS the migration locally, so a field with no migration file is normal here |
| `prisma/schema.postgres.prisma` | GENERATED from the canonical model (`npm run db:pg:schema`); what production is supposed to match | never applied directly |
| `supabase/migrations/*.sql` | the production lineage | applied by an operator on the owner's instruction (ADR-057), dry run first |

So a column that exists in the schema but in no Supabase migration is a column
production does not have, and every Prisma query that selects it — including
`GET /api/backup/export`, which selects every column of every snapshot model —
fails there while every local test passes. That happened with
`RawExternalRecord.artifactId` from 2026-08-29 to 2026-09-05
(`.brain/rca/2026-09-06-a-schema-column-with-no-migration.md`).

**The rule:** a change that adds a model or a column to `prisma/schema.prisma`
ships, in the same change, an idempotent migration under `supabase/migrations/`
(`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, header
comments with `@req`/`@spec`, and the "NOT APPLIED" note naming the operator
step) and a `prisma/migrations/` twin for local history. Applying is a separate,
owner-instructed step and is never claimed by the change that writes the file.

**The guard:** preflight `schema-migration-drift` (Check 18,
`scripts/schema-migration-drift.mjs`) parses the columns every model declares in
`prisma/schema.postgres.prisma` and every `CREATE TABLE` / `ALTER TABLE … ADD
COLUMN` across `supabase/migrations/*.sql` — comment-stripped, string literals
blanked, `IF NOT EXISTS` and quoting tolerated, DDL inside `DO $ … $` blocks
included — and raises a CRITICAL for any declared column no migration creates.
It is a static diff and touches no database, so CI runs it on every pull
request.

**What the guard cannot see, and the check that replaces it.** Check 18 compares
columns. It says nothing about the *security block* a new table needs — row
security enabled and forced, the `zuri_app_runtime_all` policy, and `REVOKE ALL
… FROM public, anon, authenticated, service_role` — and no static check can, because
several migrations create that policy inside a `DO` loop over `pg_class` rather
than per table. Scanning the SQL text for `CREATE POLICY` reports 75 of 84 tables
as missing one; on the database, 83 of 84 have one. A file-based guard here would
be almost entirely false positives and would be muted, which is the failure this
document already warns about one section up.

So the check is operational, not static. **After applying any migration that
creates a table, and before reporting the apply as done, ask the database:**

```sql
select c.relname,
       c.relrowsecurity                                              as rls,
       c.relforcerowsecurity                                         as forced,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
       (select count(*) from information_schema.role_table_grants g
         where g.table_name = c.relname and g.grantee = 'service_role')  as service_role_privs
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname = '<NewTable>';
```

Expected: `rls=t forced=t policies>=1 service_role_privs=0`. **`policies=0` with
`rls=t` is the dangerous shape** — it denies every row to every role that is not
the table owner and does not hold BYPASSRLS, so it is invisible while the runtime
connects as `postgres` and fails closed the moment it does not. `LineConversationJob`
landed exactly that way on 2026-09-06 and was repaired by
`20260906180000_line_conversation_job_rls_policy.sql`; the same apply also showed
`service_role_privs=7`, because Supabase default privileges re-grant on every new
table and only a per-table `REVOKE` in the creating migration takes it back. It deliberately anchors on the generated Postgres schema and not on
`prisma/schema.prisma`: a check on the dev schema would fire on every ordinary
`db push` change and be muted within a week. Presence only — types, defaults
and indexes are out of its scope.

**The baseline:** `docs/.schema-migration-baseline.json` listed the drift that
existed on 2026-09-06 when the check landed — 33 columns across `PersonCredential`,
`PasswordResetToken`, `PlanImportReceipt` and eight `Workstream` execution-contract
columns, all of which the deploy-role session verified production already had,
created outside the lineage. They were repaid to zero the same day by a
**recording** migration (`20260906120000_record_pre_lineage_tables_and_columns.sql`:
every statement `IF NOT EXISTS` or guarded, a no-op on production). The file
stays and may only shrink; preflight reports an entry that gains a migration so
it can be removed. A baseline entry is repaid by a migration file, never by
checking that production happens to have the column — the guard reads files,
not databases, and that is what makes it runnable in CI.

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
   selects the Postgres client when a server-provided URL is
   `postgres:`/`postgresql:` and keeps SQLite when the URL is `file:` in local
   development. Production fails closed when no server-provided Postgres URL
   exists; it never falls back to a credential embedded in source. Next.js
   production-build analysis may run without the runtime URL, but deployed
   requests fail closed until the server environment is configured. Re-run the
   suite against the selected provider; integration tests remain
   provider-independent.

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
