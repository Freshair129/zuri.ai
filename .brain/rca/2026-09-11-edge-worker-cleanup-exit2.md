---
version: "0.1.0b"
created_at: "2026-09-11T00:00:00+07:00,RWANG,base 73f93a00"
last_update: "2026-09-11T01:00:00+07:00,RWANG"
status: beta
attributes:
  domain: agent
  scope: Optional Edge managed-worker lifecycle
---

# RCA — graceful Edge stop can return exit 2 after `stopped`

## Scope and evidence boundary

This RCA covers the existing FR-150 optional Edge managed-worker stop path. It does not
change the worker's execution, provider, credential or delivery authority. No installed
device, provider, credential or production runtime was touched.

## Symptom

The desktop-worker integration test can observe a `stopped` event and then receive process
exit code 2. The event makes the stop look graceful while the exit code reports a failure.
The failure was intermittent in ordinary runs; 40 consecutive unforced runs passed in the
isolated Edge worktree.

## Evidence

In `apps/edge/src/desktop-worker.ts`, the normal `runManagedWorker` path emits `stopped`,
releases the worker lock, changes back to the package root, and then calls
`fs.rmSync(privateCwd, { recursive: true, force: true })`. That removal is not guarded.
The surrounding `catch` emits `failure` and returns `2`, while its equivalent private-CWD
cleanup already swallows removal errors. Therefore an exception from the normal cleanup
call occurs after `stopped` has been emitted and is reclassified as worker/configuration
failure.

A real child regression test injects a temporary test-only preload that makes removal of a
`.worker-runtime-*` directory throw. Against the pre-fix code the test observes the
expected `stopped` event and exit code **2**, reproducing the ordering defect. The injected
error uses `EBUSY` only as a deterministic test label; no claim is made that a particular
OS error was captured during the intermittent run. The unforced test suite does not
reproduce the filesystem race.

## Root cause

Best-effort private runtime-directory cleanup shares the worker's fatal-error catch boundary
on the normal stop path. A cleanup exception therefore changes a completed graceful stop
into exit 2 after its terminal event has already been sent.

## Why the issue escaped detection

Existing lifecycle tests exercise normal cleanup and EOF/stop ordering, but they do not
inject a failure at the private runtime-directory removal boundary. Ordinary cleanup
usually succeeds, so a filesystem timing or handle-release race is not visible in the
green path. No test asserted that a cleanup-only failure preserves the stop result.

## Prevention

Treat normal private-CWD removal as best effort, matching the existing catch-path cleanup.
Keep lock release and the already-emitted lifecycle events unchanged. Return `1` only for
the existing fatal-worker result and `0` for a graceful stop; retain exit `2` for actual
initialization/worker failures. The real-child regression must prove that cleanup-only
failure emits `stopped`, emits no failure event, releases `.zuri-worker.lock`, and exits 0.

## Validation

The new real-child test failed against the pre-fix code with 2 passing tests and one failure
(`2 !== 0` after the `stopped` event). After the best-effort cleanup change it passed with
the other lifecycle tests (3/3). The focused desktop unit/integration run passed 10/10.
The full Edge JavaScript suite passed 944 tests with 3 opt-in skips (947 total), Edge
typecheck passed, the Edge TypeScript build passed, and `npm run govern` passed with zero
critical findings. No browser, installed-device or provider evidence is implied.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-11 | beta | Record the post-stop cleanup exception path and deterministic regression boundary | pending | RWANG |
