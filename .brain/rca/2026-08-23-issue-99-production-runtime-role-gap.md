# RCA — Issue #99 production runtime role gap

## Symptom

The additive IAM migration is ready and the linked `zuri-v2` project accepts
the migration dry-run, but the production application connection still uses a
privileged database role. Applying the IAM schema alone would not complete the
database runtime boundary.

## Evidence

- Supabase project `zuri-v2` (`qcnmhyglarzcpudjorzc`) is linked. Remote
  migration history now contains both `20260822195424_canonical_iam_phase0.sql`
  and `20260822204604_canonical_iam_runtime_role_cutover.sql`.
- Remote lint reports no schema errors, security advisors report no issues, and
  the post-apply direct dry-run reports `upToDate: true` with no pending
  migrations.
- Remote catalog audit shows the public application tables are owned by
  `postgres`, have RLS enabled, and the IAM tables now have RLS plus forced RLS.
  The runtime cutover has explicit runtime policies and DML grants for 61 public
  tables; Data API roles remain denied on the new IAM tables.
- `zuri_app_runtime` remains `NOLOGIN`, `NOBYPASSRLS` and is inherited by
  `zuri_web_login`, which is `LOGIN`, `NOBYPASSRLS`, non-superuser and has no
  create-role/create-database or replication privilege.
- A local logical backup (schema, data and roles) was created outside the
  repository before apply because managed backups are not available on the
  current free plan. This is a recoverable local artifact, not a point-in-time
  managed backup.
- The current `DATABASE_URL` metadata still points at the target Supabase
  pooler using the `zuri_web_login` role through the transaction pooler; no
  deployment secret is stored in Git. The Vercel Production `DIRECT_URL` and
  Preview/plugin environment variables were not changed.
- The local Prisma runtime constructs its Postgres client from `DATABASE_URL`,
  so changing the database role requires a deployment-secret rotation as well
  as database grants and policies.
- The new Vercel Production deployment is `READY` after redeploying the
  existing production artifact. A direct database login canary through the
  transaction pooler reports `current_user = zuri_web_login` and can read the
  IAM tables.
- The production root returns HTTP 200 and unauthenticated `/api/viewer`
  returns the expected `AUTH_REQUIRED` response. An authenticated application
  canary is still open: the redeployed artifact is the existing `main`
  production artifact, not the unmerged `codex/issue-99-iam` worktree, and no
  safe production test credential was used.

## Current status

The database schema, non-privileged runtime-role foundation, deployment-secret
rotation and direct login canary are applied and live-verified. The
authenticated application canary remains open: the app must prove
`current_user`, effective grants/RLS, authentication, logout, revocation and
cross-tenant denial before the Issue #99 runtime cutover can be called fully
complete.

## Root Cause

The production application schema was deployed with a privileged owner
connection while the governed role model defined `postgres` as a migration
identity and `zuri_app_runtime` as a non-login, non-bypass runtime role. The
role cutover was deferred when the application schema was created, so the IAM
schema can be additive without yet being a complete production runtime
boundary.

## Why the issue escaped detection

Local tests use SQLite and local Postgres schema checks, while the existing
production gate verified private `zuri_core` role paths rather than the public
Prisma application schema. No pre-apply catalog check compared the deployment
connection role with the ADR-018 runtime role contract.

## Proposed prevention

Prepare an additive runtime-role migration that creates a dedicated web login,
grants it only through `zuri_app_runtime`, gives the server-owned public tables
explicit runtime policies, and preserves Data API denial. Rotate the deployment
connection secret outside Git, then prove `current_user`, RLS, grants, login,
logout, revocation and cross-tenant denial in a canary before retiring
privileged runtime use. Keep schema apply and credential rotation as separate
gates with a reversible deployment-secret rollback.
