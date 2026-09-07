# FR-091 CI connection reset during scope discovery

## Status

Open. The observed transport failure is confirmed; its underlying cause is
not identified by the hosted artifacts. No application fix, blanket retry, or
test quarantine is justified by this evidence.

## Symptom

Hosted run `34147822885` (PR #290, e2e job `101823616117`) marked the Playwright
suite failed because the first attempt of the FR-091 consent test raised:

```text
Error: apiRequestContext.get: read ECONNRESET
GET http://localhost:3100/api/scope
```

The hosted test location was
`fr091-conversation-inbox.spec.js:122:3`; the failing setup call is
`apps/server/tests/e2e/fr091-conversation-inbox.spec.js:32:43`. The call happens
inside `ingest`, before the webhook POST and before the consent assertion. The
retry passed in 11.8 seconds. The final run had 111 passed, 4 skipped, and 1
flaky test, and correctly exited 1 because the repository's
`--fail-on-flaky` guard rejects a pass that required retry.

## Evidence

- `gh run view 34147822885 --repo Freshair129/zuri.ai --log-failed` records the
  reset on the first attempt and a passing retry. The log contains no response
  status or response body for the reset.
- The setup code gets `/api/scope` at line 32, then selects `BUS-001` at line
  33. It has no retry around that read; the later webhook fixture retry is a
  separate setup operation.
- The route's GET handler at
  `apps/server/src/app/api/scope/route.js:56-60` resolves the viewer and calls
  `listScope` through `handle`. It has no import or call to the FR-171 trace
  journal or memory-trace validation path.
- The run completed normally after the failure and the retry, so the available
  evidence does not implicate a workflow timeout.

## Root Cause

The confirmed failure is a transient connection reset at the local HTTP
boundary while Playwright requested `/api/scope`. The underlying cause is
unknown. The available failed-step log does not establish whether the server
process restarted or failed, the runner experienced resource pressure, or the
Node/Playwright transport closed the socket. It does not support attributing
the reset to `listScope`, the database, or the execution-trace changes.

## Trace-change assessment

There is no evidence that the trace changes caused this failure. The request
failed before the webhook or agent execution path was entered, and the scope
route has no trace-journal dependency. This is a bounded dependency finding,
not proof that every process-level interaction is impossible; server and
runner diagnostics are required before assigning causality.

## Why the issue escaped detection

The failure is transient and the same test passed on retry. The fixture's
existing bounded retry covers webhook setup after scope discovery, but the
initial read-only scope discovery has no equivalent diagnostic retry. A normal
pass therefore does not expose this setup gap, while `--fail-on-flaky` surfaced
it in this run instead of treating the retry as trustworthy.

## Proposed prevention and minimal investigation

1. Correlate the failure timestamp with the Next server's stdout, process exit
   or restart status, and runner resource metrics. Preserve those diagnostics
   with the e2e artifact; the current failed-step output is insufficient.
2. If the server terminated or logged an exception, repair that specific
   failure from its stack trace. If it remained healthy, inspect the CI
   runner's Node/Playwright transport and resource evidence instead.
3. Only after that evidence exists should a narrowly scoped mitigation be
   considered. A bounded, observable retry for this read-only bootstrap call
   may be appropriate if server health is proven, but it must not mask the
   failure or replace the `--fail-on-flaky` gate. Do not quarantine the test or
   rerun blindly.

The RCA remains open pending the server and runner diagnostics above.
