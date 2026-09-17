---
id: ZAI:RCA-2026-09-17-USAGE-ROLLUP-TEST-CLOCK
title: Usage rollup replay test used an uncontrolled audit clock
version: "0.1.0b"
status: beta
created_at: "2026-09-17T14:09:39+07:00,Luna Max,bd99651f"
last_update: "2026-09-17T14:09:39+07:00,Luna Max"
superseded_by: null
attributes:
  domain: platform-control
  doc_type: root-cause-analysis
  risk: MEDIUM
  scope: "Existing NFR-023 once-per-day usage rollup unit test"
relations:
  - type: references
    target: ZAI:FR-248
  - type: references
    target: ZAI:FR-249
  - type: references
    target: ZAI:NFR-023
  - type: references
    target: ZAI:ADR-095
---

# RCA — usage rollup replay test used an uncontrolled audit clock

## Symptom

The W2 full-suite log reported one failure in
`apps/server/tests/unit/usage-events.test.js`:

```text
NFR-023 rollupUsageEvents > claims a UTC day inside the transaction and returns the same receipt on replay
expected { auditEventId: 'audit-2', …(3) } to match object { auditEventId: 'audit-1', …(3) }
```

The replay assertion requires the second call to return the first completion
audit, but the fake database created a second audit row.

## Evidence

At `bd99651f2322e7c15be04a834399dee4d397cbb4`,
`apps/server/src/modules/platform-control/application/usage-events.js` lines
74–97 derives the queried UTC day from the caller's injected `now` and checks
for an existing completion audit inside the transaction. Lines 126–130 create
the completion audit through `recordAudit`.

`apps/server/tests/unit/usage-events.test.js` lines 87–91 stamp fake audit rows
with `occurredAt: new Date()`, while lines 175–182 pass fixed
`2026-09-16T12:00:00.000Z` and `2026-09-16T23:59:59.000Z` values and require one
receipt. The observed host clock was 2026-09-17T07:06Z, outside the first
call's `[2026-09-16T00:00:00Z, 2026-09-17T00:00:00Z)` query window. The replay
therefore correctly found no matching fake row and created `audit-2`.

The service and test were introduced together by
`a12c5f57e1986ad7c20a4d27364f3bc7d1c21236` when transaction and once-per-day
behavior was added. No Phase B source change caused this mismatch.

## Root cause

The fake database had no clock contract. The service used the explicit logical
time supplied by the test for its UTC-day boundary, while the fake audit create
used process wall-clock time for the stored `occurredAt`. The replay lookup was
strict and correct; the fixture made its inserted row belong to another day.

## Why the issue escaped detection

The replay test was added with a fixed historical date, but the fake create
method retained its earlier `new Date()` behavior. A run while the host clock
was inside that historical day could pass. Later runs crossed the day boundary
and exposed the host-clock dependence. The test did not assert that the fake
completion audit timestamp was inside the claimed day.

## Proposed prevention

Keep production audit timestamp behavior unchanged. Give the test fake a
deterministic audit clock and set it to the explicit `now` before each rollup
call. Add a focused assertion that the created audit timestamp is within the
first UTC day. This keeps the real service's strict date-window behavior under
test and makes the replay proof independent of the host date.

The repair is limited to the existing unit-test fixture. No service, audit API,
schema, migration, or production behavior needs to change for this RCA.

## Closure evidence

The targeted `tests/unit/usage-events.test.js` run must pass all 10 tests with
the fixed historical times on a host outside 2026-09-16 UTC. The completion
audit must remain singular and replay must return `audit-1`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-09-17 | beta | Recorded the host-clock mismatch in the NFR-023 replay fixture | bd99651f | Luna Max |
