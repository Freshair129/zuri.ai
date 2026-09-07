# FR-091 CI scope fixture connection reset

## Symptom

PR #290 run `34147822885`, job `101823616117`, failed the FR-103 consent
test before its webhook setup: `apiRequestContext.get: read ECONNRESET` on
`GET /api/scope`. The complete test passed on retry; `--fail-on-flaky`
correctly rejected the run (111 passed, 4 skipped, 1 flaky).

## Evidence

- `fr091-conversation-inbox.spec.js` uses the authenticated `page.request`
  context for scope discovery before constructing the webhook payload.
- Installed Playwright's `lib/server/fetch.js` defaults `maxRetries` to zero.
  Its bounded reconnect handles only `ECONNRESET`, logs the reconnect, and
  returns HTTP responses without retrying their status codes.
- The repository already permits transport recovery during fixture setup
  (`reconnecting-request.js`), but that helper also retries 503 and other
  connection errors. It is broader than this incident requires.
- The failed job log supplies no HTTP response and no server-crash evidence.
  The scope route resolves the viewer and reads scope; it does not call the
  execution-trace journal. Session cookie values are omitted from this RCA.

## Root Cause

The confirmed failure mechanism is an unhandled connection reset in a read-only
fixture, before the behavior under test. Playwright defaults to no reconnect,
so one transport interruption forces a retry of the entire consent test.
The historical reason the socket was reset is still unknown: the available
artifacts do not establish a keep-alive race, process restart, or resource
pressure. This change is a bounded transport mitigation, not a claim to repair
an identified server defect.

## Why the issue escaped detection

Ordinary local passes cannot exercise a dropped connection. Existing reconnect
tests cover another fixture helper; this raw scope read bypasses that policy.
The fail-on-flaky gate exposed the gap rather than accepting the retry-pass.

## Proposed prevention and acceptance criteria

User authorized remediation with "fix it". C-2; medium risk limited to the E2E
harness. Parent contracts FR-091/FR-103, SDD-053 and ADR-017 remain unchanged.

1. Keep the caller's signed request context and add exactly one native
   Playwright reconnect to the read-only scope fixture. No new context,
   authorization bypass, mutation retry, assertion retry, or timeout increase.
2. Test against a real local HTTP server that destroys its first socket:
   recovery must preserve the cookie and request path; repeated reset must
   fail after two attempts. HTTP 401/403/500/503 must fail without retry.
3. Check HTTP success before decoding scope. Do not print response bodies or
   credentials in setup errors.
4. Run focused transport regression tests, the full unit suite, build,
   governance and E2E with the existing fail-on-flaky gate. Hosted CI remains
   a separate merge requirement.

## Version diff

Before: a raw scope read loses the whole consent test on one socket reset.
After: only this read-only setup read can reconnect once; actual HTTP failures,
repeated resets, webhook writes and consent assertions keep their failure paths.

## Verification

- The real HTTP regression reproduced the gap with the original raw GET:
  both reset cases failed while five response/error cases passed. With one
  native reconnect all seven cases pass; the existing broader helper's seven
  cases also pass unchanged.
- `npm run verify` exited 0: 4,248 unit/integration tests passed, 15 skipped;
  production build including lint/type checks passed; server governance passed;
  E2E 112 passed, 4 skipped, zero flaky. Both execution guards passed.
- The previously failing consent scenario passed on its first attempt in 2.4s.
  Full E2E took 9.2 minutes, including 375s warming 293 route/page modules.
- Root `npm run govern` passed, including the combined Server/Edge graph:
  no dangling edges, duplicate IDs or link findings.
- Independent review verified native retry semantics and tightened the error
  message test to exact equality and the import to the declared dependency.

Hosted CI must verify the updated PR head. The historical socket-reset trigger
remains open; this evidence establishes bounded fixture recovery, not a server
keep-alive diagnosis or production deployment validation.
