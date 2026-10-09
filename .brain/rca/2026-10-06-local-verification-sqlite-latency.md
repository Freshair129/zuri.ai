---
status: active
superseded_by: null
version: "0.1.0"
---

# Local SQLite verification latency

## Symptom

The isolated Core/reader verification run spent 446.37 seconds creating its
SQLite schema. The first completed Runtime memory/group suite reported 12
failures among 29 cases, including 30-second test timeouts, subsequent SQLite
query timeouts and assertion mismatches. WorkToolPort then passed 23 cases.
This is local evidence, not the unidentified older GitHub Actions incident.

## Evidence

- The datasource was the run-specific database under this worktree's
  `apps/server/prisma/.test-dbs`; no shared production database was used.
- Application sources, Prisma schema, Core contract tests and test timeouts are
  unchanged from base `71e5dde06104c5e1ff30fa5f890031b5fcdb514b`.
- A disposable Node SQLite probe used default synchronous mode 2 and 20 separate
  insert transactions. C: measured 76 ms, O: measured 5,264 ms, and a second C:
  probe measured 68 ms in the same session.
- Diagnostic logs and the raw probe receipt are retained under the worktree's
  ignored `.verification.local/` directory.
- After relocating only SQLite fixtures, the 24-file batch passed 467 of 468
  tests. Its remaining failure was the 277-FR/46-feature canonical-source case:
  `makeFixture()` uses `os.tmpdir()`, which still resolved to O: for that run.
- Rerunning the complete canonical-source file with a private C: TEMP/TMP
  directory passed all 27 tests in 71.59 seconds overall. The large-registry
  case took 18.771 seconds under its unchanged 30-second timeout.

## Root cause and limits

The O: fixture location imposed enough synchronous SQLite write latency to exceed
the timed memory/group test budgets. With the same code and timeout settings,
redirecting only the disposable database directory to C: reduced schema setup
from 446.37 seconds to 3.26 seconds. The same 29-case memory/group suite then
passed all cases in 29.652 seconds; its prior failed run took 598.405 seconds.
This supports a storage-dependent cause for that local failure without relaxing
any assertion or timeout. The final selected-run outcome is recorded separately
in `docs/migrations/scoped-verification/VALIDATION.json`.

The remaining canonical fixture failure was also sensitive to temporary-storage
location. Its passing rerun supplies the missing scoped evidence; the original
24-file batch remains recorded as failed, rather than relabeled successful. The
probe and reruns do not identify the physical device, driver or competing load
responsible. They establish no cause or speedup for the reported hosted CI run.

## Why the issue escaped detection

Selecting fewer test files still invokes the Server's complete SQLite schema
setup. The successful selector baseline did not exercise the same number of
timed business transactions as the Runtime memory/group contract suite.

## Proposed prevention

Record fixture location and setup time in local validation receipts. Diagnose
storage before treating an elapsed deadline as a product regression or extending
timeouts. For this bounded rerun, redirect only this worktree's disposable
`.test-dbs` directory to its own temporary directory; preserve the failed run and
restore the original directory arrangement afterward. No production database,
dependency installation or hosted CI timeout is changed.

The test database junction was removed after testing, and the preserved original
physical directory was restored. The empty private C: database directory was
removed. The runner directory contains only its Node compile cache and was
preserved after automatic approval review rejected recursive cleanup with
`blocked by policy`. Its location is recorded in the ignored cleanup receipt;
no test process or environment redirection remains active. Logs and raw test
reports remain in the worktree.

Version diff 0.0 → 0.1.0: records local storage-dependent failures, controlled
reruns and environment restoration without modifying test behavior.
