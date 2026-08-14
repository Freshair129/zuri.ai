---
version: "0.3.0b"
created_at: "2026-08-14T10:32:00+07:00,ATHER"
last_update: "2026-08-14T10:47:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "root-cause-analysis"
  scope: "FR-055 W4 disposable PostgreSQL cluster safety"
  requirements: "FR-055, NFR-013, BR-014, SDD-028, SEC-012"
  risk: "HIGH"
---

# RCA — FR-055 W4 disposable-cluster guard gap

## Symptom

The W4 PostgreSQL integration test accepted any loopback PostgreSQL server containing a database
named `zuri_fr055_test`. After that database-local check it dropped and recreated fixed
cluster-global roles. Cleanup also left `anon`, `authenticated` and `service_role` behind when the
test itself had created them.

## Evidence

1. Module collection checked only URL hostname and pathname before enabling the suite.
2. `beforeAll` executed `drop role if exists` for fixed runtime/operator roles without proving the
   server was a disposable cluster.
3. `beforeAll` conditionally created three API roles, while `afterAll` did not record whether those
   roles pre-existed and did not remove test-created API roles.
4. Node WHATWG URL parsing returns bracketed IPv6 hostname `[::1]`; the allow-list used only `::1`,
   so the documented IPv6 loopback case was not actually accepted.
5. The independent W4 review reproduced these facts statically and correctly changed the W4
   verdict from local PASS to FAIL.

## Root Cause

The original target guard treated the database name as the destructive-scope boundary. PostgreSQL
roles are cluster-global, so a database-local identity cannot authorize role DDL. The harness also
used symmetric-looking setup/cleanup SQL without retaining a baseline ownership inventory, which
made it impossible to distinguish pre-existing roles from roles created by the test.

## Why the issue escaped detection

- The first execution used a newly created Docker container, where external container deletion
  hid residual-role cleanup defects.
- Behavioral assertions focused on RLS/CAS semantics after setup rather than proving setup itself
  was safe on every accepted target.
- The safety test covered a remote hostname rejection but no loopback, correctly named,
  non-disposable cluster.
- The IPv6 allow-list was written from URL text rather than verified WHATWG hostname behavior.
- The first remediation assumed a caught node-postgres migration error left the session usable.
  Both migrations contain their own `BEGIN`/`COMMIT`; a mid-migration error instead leaves the
  session in PostgreSQL's aborted-transaction state until an explicit `ROLLBACK`.
- Normal-path cleanup passed, so no test forced an error after autocommit API-role creation but
  before an explicit migration transaction completed.

## Proposed prevention

1. Require three independent gates before cluster-global DDL: exact database name, explicit
   destructive-test opt-in, and an exact per-run marker read from a PostgreSQL custom cluster GUC.
2. Normalize bracketed IPv6 hostnames before loopback comparison.
3. Inventory all possibly touched roles before DDL; abort if any fixed Zuri test role pre-exists.
4. In every success or failure cleanup path, drop only roles absent from the baseline inventory and
   preserve every pre-existing role.
5. On every setup exception, issue a guarded `ROLLBACK` before cleanup; ignore only SQLSTATE
   `25P01` and always rethrow the original setup error after cleanup.
6. Force a deterministic error inside an explicit migration-like transaction after autocommit role
   creation, then prove catch-path cleanup and baseline preservation against PostgreSQL.
7. Unit-test URL/opt-in/marker parsing and database-marker verification before re-running the
   composed test once on disposable PostgreSQL 17.

## Verification target

- Guard unit test RED then GREEN.
- Composed PostgreSQL 17 test PASS with a fresh per-run marker and explicit opt-in.
- After the suite, no test-created Zuri/API role remains and pre-existing API roles are unchanged.
- Exact temporary container is removed; production/Supabase remote/LINE remain `NOT_RUN`.

## Remediation result

Local remediation is complete. The guard now requires the exact loopback database, the literal
destructive opt-in and a per-run UUID marker read back from
`current_setting('zuri.fr055_disposable_cluster', true)` before any role DDL. Setup inventories the
role baseline, refuses any pre-existing fixed Zuri role, and cleanup drops only roles absent from
that baseline in both setup-failure and normal-finally paths. A disposable PostgreSQL 17 run
preserved a pre-existing `anon` role, removed every test-created role and removed `zuri_core`.

The aborted-transaction gap found in re-review is also closed. Setup runs through a recovery
wrapper that attempts `ROLLBACK` before any cleanup query, treats only `25P01` as an ignorable
no-active-transaction result, records other recovery failures without replacing the original
exception, then performs baseline-aware cleanup. A forced `P0001` error after autocommit API-role
creation and inside an explicit transaction retained the exact original error, removed the schema
and test-created roles, and preserved the baseline sentinel role.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Documented cluster-global role DDL guard and cleanup root cause | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Added verified cluster marker, destructive opt-in and baseline-owned role cleanup evidence | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | beta | Added aborted-transaction rollback recovery and deterministic mid-migration cleanup proof | working-tree | ATHER |
