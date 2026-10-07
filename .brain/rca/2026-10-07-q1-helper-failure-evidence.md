---
status: active
superseded_by: null
version: "0.2.0"
assessment: SOURCE_CONFIRMED_FOCUSED_REPAIR_VERIFIED
---

# Q1 helper failure-path gaps

## Symptom

Independent review found two P2 failures: timeout completion lacked complete
owned-tree termination evidence, and rejected CI control validation lost requested
and observed identity. The review did not demonstrate surviving processes.

## Evidence

The original review inspected staged tree 9ea3ee2d750a49513c52547c46dca62792544298,
patch SHA-256 58036310a86d27319ed47238bc7a71f3c2c2a7ec2e96f7d8c4c46005bdf10ec7,
based on a787834ea422363f3eaf7fbdf472c53eb6c7d2be. Original patch, independent
report and failures remain in the task's implementation-evidence directory.

- scripts/verification-qualify.mjs, original lines 156-163, used spawnSync with
  a wrapper timeout and immediately wrote completion. No owned descendant proof
  accompanied it. The shared Windows guard also introduces a shell wrapper.
- Node's Windows implementation gives its direct-child job breakaway flags;
  terminating a wrapper does not establish termination of all descendants.
  [Pinned Node 24.16.0 source](https://raw.githubusercontent.com/nodejs/node/v24.16.0/deps/uv/src/win/process.c).
- Original helper lines 194-197 omitted requested control identity. Line 213
  assigned receipt.control only after fetchControl returned successfully, losing
  provenance whenever it threw. Tree checking followed that assignment.
- Bounded post-run inventories in the original local runs found no attributable
  survivors. They did not prove every descendant/timeout shape was handled.

## Root cause

R1: wrapper lifetime was treated as the lifetime of all work it launches, without
complete ownership or cleanup evidence. This is a lifecycle guarantee gap, not a
demonstrated orphan incident.

R2: provenance existed only as the successful validation return value. Requested
and observed-but-unvalidated identity were not persisted separately from success.

Neither finding identifies the cause of the existing SQLite test timeout.

## Why the issues escaped detection

Execution tests injected fake spawn results and never observed actual Windows
descendants. Control tests validated helper functions but did not inspect main's
saved failure receipt. Happy-path fields hid both missing failure guarantees.

## Prevention and approved repair

The owner approved the bounded repair on 2026-10-07. A Q1-specific Windows Job
Object contains a blocked bootstrap before release, with kill-on-close and no
breakaway flags. Termination uses the owned job/handle, then queries zero active
processes before marking cleanup VERIFIED. Timeout/cancellation remains FAIL,
and unverifiable cleanup stops the next engine. stdout/stderr, adapter observations
and execution/cleanup durations remain available on failure. Native job semantics:
[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Requested repository/workflow/run ID is saved before API access. Bounded allowlisted
observations, request status and pagination progress remain UNVALIDATED; transport
errors use fixed codes. Validated control is assigned only after all checks,
including the checkout tree. Tokens, headers and arbitrary response bodies are excluded.

Seven saved-receipt cases cover 403, wrong head/tree, missing step, changed attempt,
incomplete pagination and sanitized network failure. Engine regressions ensure
passing assertions cannot mask timeout, cancellation, failed containment or
unverified cleanup. Native synthetic tests require a live unrelated sentinel and
exercise detached descendants, normal exit, two timeout shapes, cancellation,
native Bind rejection and bootstrap spawn failure. No Core/PG profile is launched.

## Development failures retained during verification

The first native run had 2 passed, 2 failed and 4 cancelled tests including the
parent. Console.In.ReadLineAsync blocked before bootstrap release, so supervision
never entered its timeout loop. Microsoft's API documents synchronous behavior
even for the Async method. Moving the read to a worker task corrected it.
[Console.In remarks](https://learn.microsoft.com/en-us/dotnet/api/system.console.in?view=net-10.0#remarks).

The second run passed normal execution but failed the early-parent fixture's
survivor assertion: ordinary Node direct children had already been stopped by
libuv at parent exit. Detached synthetic children bypass that direct-child job
while remaining in Q1's enclosing non-breakaway job. The suite now stops after a
failed case and awaits cancellation on a fixture readiness failure. Raw adapter
observations are retained separately from the parent result.

After these corrections, native checks passed 8/8 (seven cases plus parent) in
10.765 s; focused planner/helper checks passed 92/92 at the checkpoint. Original
failed logs and receipts remain intact. Final independent review and source-hash
evidence accompany the composed repair snapshot. Broader Q1 qualification remains
incomplete because the selected Core run failed and PG/hosted execution is NOT_RUN.

Read the [qualification record](../../docs/migrations/scoped-verification/QUALIFICATION.md)
and [policy](../../docs/architecture/VERIFICATION-POLICY.md) for the active contract.

Version diff 0.0 -> 0.1.0: source-backed review findings and proposed prevention.
0.1.0 -> 0.2.0: promotes the task RCA, records the owner-approved repair, focused
verification and two development failures. No application fix or hosted PASS.
