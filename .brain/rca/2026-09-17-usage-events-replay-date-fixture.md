---
version: "0.1.0b"
created_at: "2026-09-17T13:00:00+07:00,Codex"
last_update: "2026-09-17T13:00:00+07:00,Codex"
status: "under review"
attributes:
  domain: "platform-control"
  doc_type: "root-cause-analysis"
  scope: "Deterministic unit fixture for usage-event daily replay"
---

# RCA - Usage-event replay test depended on wall-clock date

## Complexity and risk

- **Complexity:** C-1 - isolated test-fixture correction
- **Risk:** LOW - no production source, schema or runtime behavior changes

## Symptom

The hosted `tests` job for PR #449 failed one test in
`tests/unit/usage-events.test.js`: the second `rollupUsageEvents` call did not
return the first call's audit receipt and created a second audit event.

## Evidence

- GitHub Actions run `35186411343` passed 715 test files and 5,979 tests, with
  one failure in the UTC-day replay case.
- The failure returned `audit-2` and `alreadyRanToday: false` instead of
  `audit-1` and `alreadyRanToday: true`.
- Local reproduction on 2026-09-17 produced the same failure without any
  working-tree changes.
- The fixture's `auditEvent.create()` used `new Date()` for `occurredAt`, while
  the test passed a historical injected `now` of 2026-09-16 to the service.

## Root Cause

The fake audit store used the host wall clock instead of the test's logical
clock. The service searches for a completed audit inside the UTC day supplied
by `now`; when the host date moved to the following day, the fixture placed the
audit outside that queried interval.

## Why the issue escaped detection

The test only passed while the host clock remained on the same UTC date as the
hard-coded service input. Earlier local and CI runs therefore did not expose
the date coupling.

## Proposed prevention

Allow the fake database to receive an explicit audit clock and use the logical
test time in the replay case. Keep the production implementation unchanged and
avoid system-clock-dependent assertions in this fixture.
