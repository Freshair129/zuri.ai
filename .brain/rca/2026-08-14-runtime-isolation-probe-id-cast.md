# RCA — Runtime isolation probe PostgreSQL contract mismatches

**Date:** 2026-08-14
**Scope:** FR-054 live dedicated-login isolation probe

## Symptom

The tracked probe was not safe to promote to a live production run for two PostgreSQL contract
reasons. Its SQL cast Tenant and Business parameters to `uuid`, while production stores those
identifiers as `text`. After correcting that mismatch under a PostgreSQL 17 integration test, the
direct-grant assertion still failed because it resolved a table name through a schema the login is
intentionally forbidden to use.

## Evidence

- The pre-remediation `src/modules/knowledge/runtime-isolation-probe.js` used `$1::uuid` and
  `$2::uuid` in the cross-scope, positive-scope and rollback-only mutation assertions.
- `supabase/migrations/20260813213654_production_tenant_bootstrap.sql` declares
  `tenant_id text` and `business_id text` on the production binding and knowledge
  tables.
- The focused unit suite injects a fake query client. It verifies assertion flow and
  rollback behavior, but does not ask PostgreSQL to type-check the emitted SQL.
- No live dedicated-login report exists; the activation readiness report correctly
  records this gate as `NOT_RUN`.
- A PostgreSQL 17 RED run returned `42501 permission denied for schema zuri_core` from the
  name-based `has_table_privilege` call. The existing production isolation SQL avoids this by
  passing the table OID from `pg_class`/`pg_namespace`.

## Root Cause

The probe implementation made two assumptions that conflict with the least-privilege production
contract:

1. it inferred UUID SQL column types from the canonical value format, conflating value identity
   with physical `text` storage; and
2. it used the name-resolving overload of `has_table_privilege`, even though the login must have no
   direct schema `USAGE`.

## Why the issue escaped detection

The implementation tests asserted query ordering, redaction and rollback against a
mock client. There was no schema-contract test binding the probe's parameter casts
to the applied production migration, and the live gate had not yet been executed.

## Proposed prevention

1. Change probe comparisons to the production contract (`text`) without changing identifier
   values or the applied migration.
2. Resolve the protected table to an OID inside the privilege check, matching the existing
   production isolation SQL without granting schema access to the login.
3. Add a regression on PostgreSQL 17 that exercises the actual role, RLS, parameter typing,
   cross-Tenant denial and rollback-only mutation path.
4. Re-run focused tests, build, documentation graph and preflight.
5. Keep the live probe `NOT_RUN` until a dedicated unprivileged login and exact
   production project are operator-confirmed.

## Status

Owner approved the gate packet/RCA. Local remediation is complete:

- all five scope parameters now use the deployed `text` contract;
- direct table privilege inspection uses the OID overload and preserves zero direct schema usage;
- unit and dedicated-loopback PostgreSQL 17 integration tests pass 7/7; and
- no production query or mutation was attempted.

The live dedicated-login gate remains `NOT_RUN` until its external credential, exact target and
recovery prerequisites are approved.
