---
version: "1.0.0"
status: active
created_at: "2026-09-17T12:52:00+07:00,RWANG,b5d0da75"
last_update: "2026-09-17T12:52:00+07:00,RWANG"
---

# Usage rollup replay fixture uses two clocks

Complexity C-2; risk LOW for the approved test-only correction. Production release remains HIGH risk and held behind its existing checks.

## Symptom
PR448 hosted tests fail at usage-events.test.js:181: a same-UTC-day replay returns audit-2 and alreadyRanToday=false instead of the original audit-1 receipt. Hosted result: 6,147 passed, one failed, 32 skipped. Build, governance and Edge checks pass; required verify fails.

## Evidence
- Head b5d0da756c55d60b5065c898cd3747ec499f46a1; hosted run 35185810853, executed on 2026-09-17 UTC.
- The replay test injects 2026-09-16T12:00:00Z and 2026-09-16T23:59:59Z into rollupUsageEvents.
- fakeDb.auditEvent.create sets occurredAt with the real new Date(). Its findFirst filters that timestamp against the injected September 16 UTC window.
- recordAudit does not pass an occurredAt override. The rollup service derives the query window from its now option.
- A local unchanged-file run on September 17 reproduced the exact failure: nine passed, one failed. No production service or assertion was edited.
- Parent contract ADR-095 D3 specifies daily person-free retention aggregates. The peer service/test implements same-day receipt reuse inside a serializable transaction. This proposal preserves that behavior.

## Root Cause
The fixture combines a fixed simulated September 16 service clock with the host's actual audit timestamp. On September 17 the newly created receipt is outside the simulated query window, so the mock correctly excludes it. The test depends on the calendar date on which it runs. This evidence establishes the test-fixture defect; it does not establish a production clock defect.

## Why the issue escaped detection
Earlier local validation ran on the fixed fixture's UTC date. The test never controlled the clock used by its fake database, so the same source changed outcome after midnight without a code change.

## Proposed correction and prevention
The owner approved this document in the next turn. Implemented Date-only fake timers scoped to the existing replay test, set the clock to its declared first-call instant, advanced it to the declared replay instant, and restored the real clock in finally. Receipt identity, alreadyRanToday, counts and single-audit assertions are unchanged. Production service, audit helper, schema, runtime timeouts and other tests are untouched.

Local validation after the correction on September 17: all ten usage-events tests passed (27 ms test execution, 6.02 s run); the unmodified control had nine passed and one failed. Hosted validation of the new commit remains pending.

Acceptance: the full usage-events file passes all ten tests on a host date different from the fixture date; fake timers are restored even if an assertion fails; hosted tests and required verify pass on the resulting exact commit. The independent Marketing browser gate must also pass before production promotion. Do not treat this test-only correction as resolving that browser failure.

## Release disposition
Public publication was approved and completed: draft PR448 exists. No production migration was applied and no image was promoted. The approved test correction is implemented and locally validated; CI and the independent browser gate remain required.

## CHANGELOG
| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 1.0.0b | 2026-09-17 | candidate | Confirm calendar-dependent fixture and propose isolated Date control | b5d0da75 | RWANG |
| 1.0.0 | 2026-09-17 | active | Owner approved; Date-only fixture correction and ten passing local tests | working-tree | RWANG |
