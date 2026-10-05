# E2E login helper returns before authentication completes

## Symptom

After the FR-252 autofocus repair, its seven cases passed without retries, but
the full browser suite still failed: FR-220 pairing failed twice and Edge denial
passed only on retry (220 passed, 4 skipped, 1 failed, 1 flaky).

## Evidence

The failed FR-220 retry trace shows the login click at 648.533 ms, followed by
navigation to `/harness/pair` at 738.131 ms. Network timestamps show POST
`/api/auth/login` at 15:42:02.816Z, followed by GET `/harness/pair` at
15:42:02.824Z and GET `/login` at 15:42:02.864Z. The login POST has status -1
(no completed HTTP response in the trace). The failure screenshot is the login
page with empty fields. No credential values or pairing tokens are reproduced.

Both callers await `loginAsOwner()` then immediately navigate to the approval
URL. That helper awaits only the click, whereas the login page asynchronously
fetches credentials and calls router.replace after success. Most other callers
implicitly wait by locating the Business chooser before continuing.

## Root Cause

The helper's completion boundary is a submitted click, not authenticated
navigation. A caller can replace the document while login is still pending,
arrive without a session, and correctly be refused by the protected surface.

## Why the issue escaped detection

Fast login responses and callers that wait for Business chooser controls mask
the race. The previous entry test also waited for the URL after the helper, so
it did not verify the helper's own completion contract.

## Proposed prevention

Make loginAsOwner wait for the normal `/businesses` destination after its real
credential submission. Add a delayed-login browser regression that checks the
destination immediately when the helper resolves. Do not retry mutations,
increase timeouts, or weaken session/authentication behavior. This is test-only
setup correction needed to close the requested full browser gate (C-2/MEDIUM).

## Verification

The delayed-login regression fails against the old helper with retries disabled:
expected `/businesses`, received `/login` (1 failed, exit 1), recorded in
`output/playwright/e2e-login-before.log`.

After the one-line waitForURL correction, all 13 tests across FR-046, Edge
pairing, FR-220 and FR-252 pass with retries disabled (exit 0), including the
delayed response and both formerly failing pairing journeys. Evidence:
`output/playwright/fr252-and-pairing-focused.log`. Final full-suite evidence is
recorded in the implementation report's browser-gate follow-up.
