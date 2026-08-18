---
version: "0.1.0b"
created_at: "2026-08-18T16:15:00+07:00,ATHER"
last_update: "2026-08-18T16:15:00+07:00,ATHER"
status: "candidate"
attributes:
  domain: "supabase-deployment"
  doc_type: "root-cause-analysis"
  scope: "FR-078 customer review runtime role"
---

# RCA - Customer review runtime could not assume its bounded role

## Complexity and risk

- **Complexity:** C-2 - provider-specific runtime role and RLS deployment fix
- **Risk:** HIGH - production database authorization boundary

## Symptom

The production customer-review runtime smoke stopped before reading the held
queue with SQLSTATE `42501`: `permission denied to set role "zuri_app_runtime"`.

## Evidence

- The failing path is `withRuntimeRole()` in
  `src/modules/crm/customer-import-review-store.js`, which starts a transaction
  and executes `SET LOCAL ROLE zuri_app_runtime`.
- A remote read-only query reported `current_user = postgres`,
  `session_user = postgres`, and a membership row for `postgres` →
  `zuri_app_runtime` with `set_option = false`.
- The target role is correctly bounded (`NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`),
  but the admin migration connection is not the application runtime identity.
- The review tables retain their private-schema grants and forced-RLS boundary;
  no queue row, decision, or customer row was changed by the failed smoke.

## Root Cause

The smoke used the Supabase migration/admin connection as the customer-review
application connection. Supabase's managed `postgres` role is allowed to deploy
the schema but its membership in the bounded runtime role does not have the
`SET` membership option. The runtime therefore had no dedicated login identity
that could assume `zuri_app_runtime`.

## Why the issue escaped detection

The migration and unit tests verified the target role grants and RLS policy text,
but the live smoke reused `DATABASE_URL`/`DIRECT_URL` instead of first proving a
dedicated login role. Static role membership checks do not prove the PostgreSQL
`set_option` needed by `SET LOCAL ROLE`.

## Proposed prevention

1. Create a dedicated `zuri_customer_review_login` with explicit unprivileged
   attributes and no direct table grants.
2. Grant only `zuri_app_runtime` to that login, with the normal `SET` membership
   option; keep the migration/admin role out of the application path.
3. Provision the login password out-of-band and pass only its server-side URL via
   `ZURI_CUSTOMER_REVIEW_DATABASE_URL`.
4. Add a live probe that verifies `session_user`, `current_user`, role
   membership options, queue counts and absence of raw PII.

## Acceptance criteria

- A dedicated customer-review login can assume `zuri_app_runtime` and read only
  the approved SmartGift review queue.
- The login has no direct `zuri_core` table grants and cannot mutate the
  append-only decision ledger outside its approved insert path.
- The Supabase `postgres` migration connection is not used as the review runtime.
- The live probe reports the expected 65 cases, 130 held items, zero decisions,
  and `rawPii = false` without writing data.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Captured the managed-role SET privilege failure and dedicated-login remediation | working-tree | ATHER |
