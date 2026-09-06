# FR-077 E2E blocks publication-containment merge

Status: investigation incomplete; underlying HTTP failure cause unconfirmed.

## Symptom

PR #259 head 5c31f3cc cannot merge under the repository's verification rules. Run 34033829080 reports 98 E2E passed, four skipped and one flaky. Inventory limit=1 failed first attempt and passed retry. Docker build, Compose validation and governance verify passed.

## Evidence

`tests/e2e/fr077-project-inventory.spec.js:58` asserts `response.ok()` after GET `/api/projects/${resolved.id}/inventory?limit=1`. The hosted log records expected true, received false. No status, response error code or resolver status was attached. The read wrapper retries connection failures and 503 once; the log does not identify which status ultimately returned. This PR changes workflow and documentation, plus a workflow contract test; it does not change Inventory application code or this E2E test.

## Root Cause

The immediate CI failure is the fail-on-flaky gate detecting a retry-pass. The underlying non-successful HTTP response is not diagnosed. Do not infer an authentication, SQLite, rate-limit or timing cause from a boolean assertion. Prior similar symptoms are not proof of this instance's cause.

## Why the issue escaped detection

The test reduces an HTTP response to a boolean and never asserts the fixture resolver response before consuming its id. This hides the evidence needed to distinguish fixture setup failure from Inventory behavior. The CI gate itself worked and blocked merge.

## Proposed prevention / next approved scope needed

Add status-only diagnostics and explicit fixture-resolution success/id assertions to this one E2E test. Do not log cookies, tokens, environment values or response payloads. Preserve the existing retry policy and fail-on-flaky gate. Run targeted reproduction with the same seeded fixture, then inspect final-head full CI. Only propose a behavior fix after evidence supports its cause. Do not rerun the unchanged failed job merely to obtain a green result.

No application/test remediation has been implemented. User approval is needed for the diagnostic code scope under R5; the approved workflow containment is already committed and pushed.
