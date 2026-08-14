# RCA — Runtime isolation probe identifier cast mismatch

**Date:** 2026-08-14
**Scope:** FR-054 live dedicated-login isolation probe

## Symptom

The tracked probe is not safe to promote to a live production run because its SQL
casts Tenant and Business parameters to `uuid`, while the production tables store
those identifiers as `text`. A live execution can fail on PostgreSQL operator type
resolution before any isolation assertion is proved.

## Evidence

- `src/modules/knowledge/runtime-isolation-probe.js` uses `$1::uuid` and `$2::uuid`
  in the cross-scope, positive-scope and rollback-only mutation assertions.
- `supabase/migrations/20260813213654_production_tenant_bootstrap.sql` declares
  `tenant_id text` and `business_id text` on the production binding and knowledge
  tables.
- The focused unit suite injects a fake query client. It verifies assertion flow and
  rollback behavior, but does not ask PostgreSQL to type-check the emitted SQL.
- No live dedicated-login report exists; the activation readiness report correctly
  records this gate as `NOT_RUN`.

## Root Cause

The probe implementation inferred UUID SQL column types from the canonical value
format. In this production adapter, UUID-shaped identifiers are deliberately stored
as text, so value identity and physical SQL type were conflated.

## Why the issue escaped detection

The implementation tests asserted query ordering, redaction and rollback against a
mock client. There was no schema-contract test binding the probe's parameter casts
to the applied production migration, and the live gate had not yet been executed.

## Proposed prevention

1. Change probe comparisons to the production contract (`text`) without changing
   identifier values or the applied migration.
2. Add a regression test that reads the production migration and rejects a probe
   cast incompatible with `tenant_id text` / `business_id text`.
3. Re-run focused tests, build, documentation graph and preflight.
4. Keep the live probe `NOT_RUN` until a dedicated unprivileged login and exact
   production project are operator-confirmed.

## Status

Root cause confirmed. Code remediation is pending owner review of this RCA and the
updated activation packet; no remote query or mutation was attempted.
