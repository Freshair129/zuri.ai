---
version: "1.0.0b"
status: under review
created_at: "2026-09-17T05:13:00+07:00,RWANG,e2d9665f"
last_update: "2026-09-17T05:13:00+07:00,RWANG"
---

# Marketing Save revision release-test flake

## Symptom
The composed pricing release browser rerun finished with 200 passed, four skipped and one flaky test. `marketing-strategy.spec.js:110` timed out waiting for the revision PATCH response at line 128 after the Save revision click; its retry passed. The wrapper correctly returned exit 1.

## Evidence
- Full-run log and JSON, failure screenshot and retry trace are preserved in the local pricing-release-ops evidence directory outside git.
- The failure screenshot shows revision 1 and an enabled Save revision button; it does not prove whether a PATCH request was sent.
- The corrected pricing fixtures and Marketing independent-review path both passed; the prior signup HTTP 429 did not recur.
- A separate diagnostic used the unchanged Marketing test five times, real isolated SQLite/server, trace on every attempt, zero retries, and no warm-up dependency. All five passed (43.4 seconds). This diagnostic is not a replacement for a clean full-suite result.
- The test, PlanForm and StrategyWorkspace are unchanged from origin/main in the pricing branch.
- Source review confirms the response waiter is registered before clicking, and PATCH requests are not coalesced. It does not establish a failed-attempt cause.

## Root Cause
UNKNOWN. Available evidence cannot distinguish validation, a lost submit, a remount, a canceled request or a missing response. No production or Marketing code is changed on speculation.

## Why the issue escaped detection
The failure did not reproduce in the focused five-run diagnostic. The normal suite captures network traces on retry, so the available trace describes the successful retry rather than the failed first attempt; the screenshot cannot establish request/submit timing.

## Proposed prevention
Capture first-attempt request, console, form-validity and remount evidence when reproducing under the full-suite conditions. Keep the existing timeout, assertions and fail-on-flaky gate. Do not count repeated successful focused runs as resolution, disable the limiter or quarantine this test implicitly. A product fix requires a supported RCA and its applicable reviewed scope.

## Release disposition
Browser gate remains NOT_PASSED. Production migration and image promotion are not performed. Remote publication separately awaits the explicit public-repository approval requested after automatic approval review rejected the push.

The browser run had completed every case but its Windows dev-server teardown remained alive. Only that identified test-server process tree was stopped to allow the runner to write the final JSON/result. This was not a production process. A diagnostic command whose spaced grep was split by the Windows shell was stopped and excluded from acceptance evidence; the five-run result uses an unambiguous no-space regex.
