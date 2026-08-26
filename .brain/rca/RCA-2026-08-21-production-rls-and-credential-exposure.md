---
version: "0.1.2b"
created_at: "2026-08-21T17:20:00+07:00,ATHER"
last_update: "2026-08-21T18:50:00+07:00,ATHER"
status: "under review"
attributes:
  domain: "supabase-security"
  doc_type: "root-cause-analysis"
  scope: "Production Supabase Advisor RLS findings and repository credential exposure"
---

# RCA - Production RLS findings and repository credential exposure

## Complexity and risk

- **Complexity:** C-3 - documentation-driven production security remediation
- **Risk:** HIGH - public-schema access control and production database credential exposure

## Symptom

The Supabase Advisor screenshot for `zuri-v2 / main / PRODUCTION` reports 14 critical
security findings. Four visible findings state that RLS is disabled on
`public.PersonCredential`, `public.PasswordResetToken`, `public.PlanImportReceipt` and
`public.Team`.

The repository also contains two tracked seed scripts with an inline production database
connection string.

## Evidence

- The supplied dashboard image shows the production project and 14 Advisor issues.
- The four visible Advisor cards identify the four public tables above as `RLS Disabled in Public`.
- `prisma/schema.prisma` and `prisma/postgres/0001_init.sql` declare all four tables.
- Repository migration search found no table-specific `ENABLE ROW LEVEL SECURITY` or policy
  statement for those four public tables.
- `scripts/seed_real_work_items.mjs` and `scripts/seed_pipeline_evidence.mjs` contain an inline
  production PostgreSQL connection string. The credential value is intentionally not recorded
  in this RCA.
- The production `DATABASE_URL` now connects to the expected Supabase project ref
  `qcnmhyglarzcpudjorzc` as the database owner connection.
- The read-only inventory found 13 public tables with RLS disabled and browser-role table
  privileges before remediation. No row contents were changed.
- The three previously missing migration versions were audited against production before apply:
  `MarketObservation` and all six pipeline tables had the expected columns and indexes; the
  document-intake objects were absent and were therefore applied rather than merely marked.
- After remediation, the direct inventory reports zero public tables with RLS disabled, zero
  public tables with `anon`/`authenticated` table privileges; the six pipeline tables now have
  forced RLS with no `service_role` table access while the `postgres` migration/runtime
  connection remains able to access them.
- The reconciled document-intake row is `ACTIVE` but `STAGING_ONLY`, and no
  `IntegrationCredential` exists for it.
- Live `supabase db advisors --type all --level info` reports no critical/error/warn findings;
  its remaining 153 findings are INFO only: 61 RLS-enabled/no-policy notices, 19 unindexed
  foreign keys and 73 unused-index notices.

## Root Cause

Two control failures overlap:

1. The public Prisma application tables were created through schema/migration paths that did not
   carry the private-schema forced-RLS contract used by `zuri_core`.
2. Operational seed scripts bypassed the repository's environment-based connection convention and
   embedded a production credential directly in source.

The live production database and the committed migration history therefore diverged: a Prisma
production lane had already created some application objects, while the Supabase migration ledger
did not contain the corresponding versions and the Advisor could observe exposed public tables.

## Why the issue escaped detection

- Local advisor evidence covered the migrated ephemeral database, not the current production
  project.
- The production project was not reachable through the active CLI/browser identity during this
  review.
- The governance/preflight chain checks document and code traceability but does not currently fail
  on inline database credentials or public tables without RLS.
- The screenshot exposed only four of the fourteen findings; the remaining ten require the project
  Advisor detail view or an authenticated management/API query.

## Proposed prevention

1. Rotate the exposed production database credential before any further use.
2. Require `DIRECT_URL` or `DATABASE_URL` for every database script; fail closed when absent.
3. Add a migration-level RLS inventory for every table in exposed schemas, with policies derived
   from the actual application access model.
4. Add a CI secret-pattern check that rejects PostgreSQL URLs containing credentials.
5. Run production Advisor and a read-only grant/policy inventory after migration, then verify the
   application route matrix before declaring the issue closed.
6. Keep production apply as an explicit gate separate from local migration generation and tests.

## Current resolution state

- **Local credential removal:** implemented; both seed scripts now require an explicit
  Postgres `DIRECT_URL` or `DATABASE_URL` and reject local SQLite URLs.
- **Local RLS migration:** prepared as an idempotent public-schema hardening migration;
  it enables RLS and revokes browser/Data API roles for every current public table.
- **RLS production apply:** completed with the idempotent public-schema hardening migration; the
  migration history entry `20260821103000_public_rls_hardening` was repaired as applied.
- **Production verification:** completed through the direct database inventory and live CLI
  Advisor. The browser dashboard still cannot be used for a visual recheck because the active
  browser identity lacks project access.
- **Credential rotation:** the environment contains a working PostgreSQL target, but it still
  uses the same database login identity as the exposed URL. The old password's revocation cannot
  be proven from a database connection, and this session has no Supabase Management API token or
  project-authorized Dashboard session. Reset the project database password in Supabase Database
  Settings, then update all external deployment secrets and re-run the read-only preflight.
- **Migration-history drift:** resolved. The MarketObservation migration is now idempotent,
  the document-intake migration was applied, the pipeline migration was applied, and
  `supabase db push --dry-run` reports the remote database is up to date.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.2b | 2026-08-21 | under review | Reconciled all Supabase migration history; applied staging intake and pipeline forced-RLS protections | working-tree | ATHER |
| 0.1.1b | 2026-08-21 | under review | Applied and live-verified public RLS hardening; recorded remaining credential and migration-history follow-ups | working-tree | ATHER |
| 0.1.0b | 2026-08-21 | under review | Recorded production RLS findings, credential exposure and external access gate | working-tree | ATHER |
| 0.1.0b | 2026-08-21 | under review | Removed inline database URLs and prepared idempotent public-schema RLS hardening | working-tree | ATHER |
