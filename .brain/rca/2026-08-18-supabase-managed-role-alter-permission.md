---
version: "0.1.0b"
created_at: "2026-08-18T14:55:38+07:00,ATHER"
last_update: "2026-08-18T14:55:38+07:00,ATHER"
status: "candidate"
attributes:
  domain: "supabase-deployment"
  doc_type: "root-cause-analysis"
  scope: "20260814023027 controlled LINE activation migration"
---

# RCA - Supabase managed role alteration during migration

## Complexity and risk

- **Complexity:** C-2 - migration correctness and security-boundary fix
- **Risk:** HIGH - production database role and RLS deployment

## Symptom

The first production `supabase db push --include-all --skip-vault` attempt stopped
while applying `20260814023027_controlled_line_activation.sql` with
`permission denied to alter role` and SQLSTATE `42501`. No migration was applied.

## Evidence

- Supabase CLI reported the failure at `alter role zuri_line_activation_operator`:
  `Only roles with the SUPERUSER attribute may alter roles with the SUPERUSER attribute.`
- The remote migration list still shows `20260814023027`, `20260818040000`,
  `20260818050000` and `20260818073000` as unapplied after the failed attempt.
- A post-failure read-only query found no `zuri_line_activation_operator`,
  `zuri_line_activation_login` or `zuri_line_runtime` rows, confirming the
  migration transaction rolled back the role creation.
- The executor is the Supabase `postgres` connection, not an unrestricted
  self-managed PostgreSQL superuser.

## Root Cause

The migration unconditionally used `ALTER ROLE` to normalize security attributes.
That assumes the migration executor can alter any role, including a role that
Postgres treats as having the `SUPERUSER` attribute. Supabase-managed database
connections do not provide that unrestricted role-management capability. The
migration also omitted an explicit `NOSUPERUSER` clause on the first `CREATE ROLE`,
so the security contract depended on the executor's implicit role defaults.

## Why the issue escaped detection

Local migration tests checked SQL text and ran against a local/superuser-shaped
database. They did not execute the migration through a Supabase-managed
`postgres` connection with restricted role-alteration privileges. The repository
therefore proved the intended policy text but not the provider-specific role
operation boundary.

## Proposed prevention

1. Create the operator role with explicit `NOSUPERUSER`, `NOINHERIT`, `NOLOGIN`,
   `NOCREATEDB`, `NOCREATEROLE` and `NOREPLICATION` attributes.
2. Create the login role with the same explicit restrictions plus `LOGIN`.
3. Do not normalize roles with unconditional `ALTER ROLE`; inspect existing role
   attributes and fail closed with an actionable error if an existing role is
   privileged or otherwise unsafe.
4. Add a migration unit assertion for explicit `NOSUPERUSER` and the absence of
   unconditional role alteration.
5. Run a remote dry-run and a read-only post-failure migration-history check before
   retrying a production push.

## Acceptance criteria

- The migration can create both roles through the approved Supabase executor
  without requiring superuser role alteration.
- An unsafe pre-existing role causes a clear rollback rather than being silently
  weakened or reused.
- The remaining migration sequence can continue only after the first migration
  succeeds; no Customer rows or review decisions are written by this migration.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Captured the Supabase-managed role alteration failure and fail-closed remediation | working-tree | ATHER |
