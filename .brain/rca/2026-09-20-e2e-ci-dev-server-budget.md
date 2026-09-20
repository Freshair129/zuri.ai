---
version: "0.1.0b"
created_at: "2026-09-20T00:00:00+07:00,RWANG,uncommitted"
last_update: "2026-09-20T00:00:00+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "platform"
  doc_type: "root-cause-analysis"
  scope: "Hosted Playwright E2E used a dev server and a long sequential warm-up, so valid workflows exhausted their test budgets under CI load"
---

# RCA — hosted E2E exhausted its dev-server test budget

## Symptom

The main governance E2E run failed two tests and marked the warm-up flaky:

- FR-203/FR-204 SKU identifiers and unit conversions timed out at 60 seconds
  while waiting for the final conversion/retirement state.
- The marketing campaign closure test timed out at 60 seconds during the final
  reload; its closure PATCH had already succeeded.
- The warm-up test used its full 45-minute budget on one attempt and passed on
  retry in 3.9 minutes.

## Evidence

Run `35456785244` recorded 220 passed tests, two failed tests and one flaky
warm-up. The retained traces show:

1. The SKU flow's conversion PATCH returned HTTP 200 at about 54.6 seconds and
   its identifier PATCH returned HTTP 200 at about 58.1 seconds. The subsequent
   refresh requests were aborted when the 60-second test budget ended.
2. The marketing closure PATCH returned HTTP 200 at about 59.4 seconds. The
   page reload GET was aborted at about 60 seconds, and the error surfaced from
   `secondaryContext.close()` in the `finally` block.
3. The warm-up's retry completed 442 module requests in 232 seconds, while the
   first attempt reached the 45-minute timeout. The first attempt did not retain
   a route-level trace, so this RCA does not invent which request stalled.

The same SKU test passed locally in 9.9 seconds when the warm-up dependency was
disabled, which separates the product assertions from the hosted dev-server
latency.

## Root Cause

CI ran the browser suite against `next dev`. Every first request could compile a
route on demand, and the suite added a sequential 442-request warm-up to reduce
that cost. Under hosted load, the remaining request and page-navigation latency
was enough for two valid multi-step workflows to consume their entire 60-second
test budgets. The warm-up itself could also hang for the duration of its global
budget, so the retry was the only successful execution of that setup path.

The test timeout was not the failing product boundary: the writes returned
success before the test ended. Raising the timeout would hide the execution
environment's cost and would leave the warm-up stall unchanged.

## Why the issue escaped detection

The suite's assertion timeout was calibrated from individual expectations and
local/dev runs, while the affected cases were long end-to-end workflows whose
cost is the sum of many navigations and API refreshes. The dev warm-up reduced
cold-compile failures but did not remove the dev server's on-demand execution
model or provide a bounded per-module progress guarantee.

## Prevention

CI now builds the application, prepares the isolated SQLite database, and starts
the built `next start` server outside Playwright with
`E2E_SERVER_MODE=production`. Playwright reuses that server and an `always()`
cleanup step owns its Windows process-tree termination; the CI path does not run
the dev-only warm-up. The server still runs with `NODE_ENV=test` so the E2E
database remains SQLite and the production Postgres fail-closed guard is not
weakened. Local runs retain the existing dev server and warm-up so local route
development remains convenient. Unit coverage guards the mode selection,
database hand-off, and CI workflow wiring.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-09-20 | beta | Record hosted E2E dev-server budget and warm-up failure; use production serving in CI | uncommitted | RWANG |
