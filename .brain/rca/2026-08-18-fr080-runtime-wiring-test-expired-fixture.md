---
version: "0.1.0b"
created_at: "2026-08-18T20:11:45+07:00,ATHER"
last_update: "2026-08-18T20:11:45+07:00,ATHER"
status: "candidate"
attributes:
  domain: "integration"
  doc_type: "root-cause-analysis"
  scope: "FR-080 production runtime wiring test"
---

# RCA - FR-080 runtime wiring test used an expired secret fixture

## Complexity and risk

- **Complexity:** C-1 - deterministic test-fixture correction
- **Risk:** MEDIUM - secret-manager fail-closed boundary; no production secret or data is changed

## Symptom

The full test suite failed in `tests/unit/fr080-runtime-wiring.test.js` with
`SECRET_MANAGER_EXPIRED` while resolving the production Supabase Vault-backed
model.

## Evidence

- The test supplied `expires_at: 2026-08-18T13:00:00.000Z`.
- The test did not inject a clock into the automatically created SecretManagerPort,
  so the port correctly used the current wall clock.
- Reproducing the focused test at 20:11 ICT failed at
  `internalResolution` because the fixed expiry had already elapsed.
- The same SecretManager behavior is covered by deterministic unit tests that
  provide an explicit `now` value and must remain fail-closed for expired rows.

## Root Cause

The FR-080 runtime-wiring test combined a fixed historical expiry with a live
clock. The fixture became invalid as time advanced; the implementation correctly
rejected it as expired.

## Why the issue escaped detection

The fixture was valid when the test was first written, and the test did not use
a deterministic clock or a relative expiry helper. No freshness check warned
that the test data would expire on a later day.

## Proposed prevention

1. Use a short relative future expiry for tests that exercise automatic wiring
   with the real clock.
2. Keep explicit-clock tests for expiry and cache semantics.
3. Never weaken the production fail-closed expiry check to accommodate a test
   fixture.

## Acceptance criteria

- FR-080 runtime-wiring tests pass after the fixture correction.
- Expired secret rows still return `SECRET_MANAGER_EXPIRED` in deterministic tests.
- Full test, build and governance checks pass.
- No production secret, Supabase schema, or customer data is modified.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Recorded and corrected the expired FR-080 runtime-wiring fixture | working-tree | ATHER |
