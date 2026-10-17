# Coding-delivery workflow policy

**Status:** Active autonomous agent procedure, version 4, adopted 2026-10-15.
The sole machine-readable authority for role bindings and numeric caps is
[model-policy.json](contracts/model-policy.json). This procedure defines the
agent workflow; it does not establish that a durable workflow controller or
ledger has shipped.

## Ordinary task readiness

Each ordinary repository code or documentation task uses one
`task-readiness/v1` record. Required fields are `schemaVersion` with value
`task-readiness/v1`, `taskId`, `objective`, a nonempty list of acceptance
strings, `writeScope`, `checks`, and `mandateReference`. Each check declares
`shell: false`, an `executable`, an `argv` string list, and a `cwd`. Optional
`dependencies` name a `taskId` and may include a `revision`. The record carries
task intent and bounded scope; it is not an approval receipt, environment hash
bundle, or authority grant.

Write scopes name exact files unless they end with `/`, which explicitly
authorizes a directory and its descendants. This intent does not depend on
whether the target exists yet.

Dependency completion is read from the canonical ledger at the selected base
commit. Editing a dependency row in the current task cannot accept that dependency.

Derive the objective, acceptance criteria, write scope and dependency references
from the roadmap where it has the relevant source. Root may resolve technical
and product choices inside the user's delegated scope. Reconcile a legacy
owner-approved label with the current trusted delegation; a stale label alone
does not block the work.

Run read-only preflight with the repository and base selected for the task:

    node tools/delivery-control/preflight.mjs --task-file <path> --base origin/main

The base defaults to `origin/main`. `--changed` includes `changedPaths`,
`committedChangedPaths` and `dirtyPaths` in the result. Preflight always checks
the working and committed changed paths against `writeScope`, whether or not
`--changed` is supplied. `--json` prints machine-readable output and
`--repo <path>` selects the repository root. Preflight checks Git state and base,
dependency evidence, write-scope paths and environment capability. It validates
declared check commands but never executes them. A completed ROADMAP dependency
exposes its completion and evidence cell; a named revision must resolve and be
compatible with the selected base. Missing or malformed record fields are
`REPAIR_METADATA`; unsafe or out-of-scope paths are `BLOCKED_SCOPE`.
Dependency and environment failures remain typed blocks.

`READY` means only that readiness evidence passed. It grants no authority to
modify files, access credentials, dispatch external operations, publish, merge
or release. Root records the trusted mandate once with its source, repository,
objective, allowed effects and prohibitions. `mandateReference` points to that
provenance; it does not independently prove authority. The direct user task or
standing delegation is sufficient authority for in-scope work, so the user does
not need to author a packet or repeat approval at each gate.

Ordinary work does not require packet plus sidecar construction, per-criterion
environment or hash receipts, sealed G0 admission, reservations, or phase
receipts. Preflight creates no task state or implementation deadline. The active
preflight stage is `AUTOMATIC_TASK_PREFLIGHT`; the historical G0 label is not an
ordinary v4 admission prompt.

## Authority and ordinary delivery path

Respect the user's task scope and repository prohibitions. Worker, verifier and
reviewer use distinct `gpt-6-luna` sessions at `max`. The verifier and reviewer
may independently inspect the same exact patch and acceptance evidence.

The ordinary path is automatic task preflight, worker implementation,
independent verification, independent review, then one Sol root delivery
responsibility. Root resolves technical and product choices within the mandate,
integrates accepted work, and handles authorized delivery actions. The former
separate G3 decision, G3B integration and G5 final root forms are not active
ordinary gates.

A readiness pass does not grant external authority. Production, destructive and
security-sensitive effects require their actual risk-specific grants and
evidence. Do not infer production, Business, provider, credential or Supabase
permissions. Commit, push, pull request, merge and release actions are allowed
only when the trusted mandate covers them. Missing external authority blocks the
affected action; continue independent eligible work.

Required tests and repository checks remain acceptance gates. An already
authorized commit, push or pull request may be published while CI is pending so
the exact proposed head can be checked. Required CI must attest the exact head
before merge or release; any change to the reviewed head invalidates affected
review and CI evidence. Root merges or releases only after every applicable
acceptance, review, test, CI and authority gate passes. Documentation tasks have
no blanket CI exemption. A missing or failed required check is `NOT_RUN`,
`BLOCKED` or `FAIL`, never `PASS`.

Each worker, verifier and reviewer session must prove every declared task check
from its actual Codex `--json` JSONL stream. The backend matches only
`command_execution` items, correlates `item.started` and `item.completed` by
item id. It parses the serialized command string using platform quoting rules,
resolves executable aliases through the backend `PATH` and `PATHEXT`, requires
the exact declared arguments, and rejects shell or directory-changing
prefixes. Duplicate events for one item id count once. The machine policy
allows at most two invocations of each declared check in one role session, so
the role may make one corrective rerun. The backend stops the session as soon
as a third invocation starts. A check passes only when its latest correlated
invocation completed with `exit_code: 0`; missing, incomplete, malformed,
failed or over-limit evidence cannot support a role `PASS`.

When this evidence overrides a model-claimed `PASS`, an observed failed
command is `FAIL`; missing or incomplete evidence and unsupported declared
working directories are `BLOCKED`; malformed traces and invocation-cap
violations are `UNKNOWN`. No outcome starts an automatic retry.

Codex CLI 0.162.1 serializes a command item with its id, command string,
aggregated output, status and optional exit code, but omits the per-item working
directory. The controller therefore accepts only task checks whose declared
`cwd` resolves to the worktree root. For each invocation it records
`cwdProvenance: launch_cwd`, bound to the role process's
`codex exec --cd <worktree>` launch argument. This provenance comes from the
launch binding, not from an item field. If a future CLI event includes
`item.cwd`, that source is labeled `item_cwd`; mixed sources are labeled per
invocation and at check level. The JSONL trace cannot independently rule out
an unreported per-command working-directory override.

The private dispatch artifacts retain the JSONL stream for audit. The separate
`check-trace.json` summary stores the stream SHA-256, a hash of each declared
check and each item id, per-check invocation counts, exit codes, statuses and
per-invocation cwd provenance; it omits command output and raw command text.
This trace proves that Codex
reported a matching command execution item and its process exit code for that
session, and binds root `cwd` to the session launch setting. It does not prove
the per-command working directory independently, the command's semantic
correctness, the source state it observed during execution, test coverage, or
the quality of the resulting change. Exact-head validation, independent gates,
required test/CI evidence and root delivery remain separate checks. No session
is automatically retried.

## Failure handling and resume

Classify metadata separately from implementation and external effects.

- A parse, schema, missing-field, path-binding, quoting or historical receipt
defect proven to have had no product effect is `METADATA_DEFECT`. Repair the
record and retain the failure evidence. It consumes no implementation repair,
submission, control-plane-successor or execution-cycle capacity, and the
execution deadline has not started. Preflight does not retry a corrected record
automatically. Unsafe paths and scope escapes are `BLOCKED_SCOPE`; they are not
metadata repairs.
- Repeated identical semantic no-progress uses the active cap in
`model-policy.json`, cumulatively across cycles for the same `taskId`. At the
cap, return `YIELD_REASSESS`: preserve the task and stable identity, mark it
resumable, and take eligible independent work. This result is not terminal.
- Implementation and submission caps apply per bounded execution cycle. The
  controller's 120-minute execution deadline also remains per-cycle, anchored to
  that cycle's first worker dispatch; an admitted successor receives its own
  controller cycle cap. The supervisor's campaign timebox is an additional
  upper bound: it is anchored once to the earliest actual worker dispatch among
  bound tasks and remains fixed through successor cycles and service restarts.
  A successor cycle cannot admit or dispatch after that original campaign
  deadline. The root deadline guard is rechecked after runner preflight, after
  lease claim and after dispatch intent. Expiry after intent but before backend
  launch is durably recorded as a proven no-launch cancellation; it pauses the
  run and cycle without refunding counters or creating an unknown effect.
  If its 30-second lease expired while awaiting the final guard, cancellation
  is allowed only when the same owner and fencing epoch still hold the running
  row, the exact dispatch intent matches, and no backend session, reference,
  or effect evidence exists. Recovery or reclaim fences the stale cancellation.
  On every tick and restart the supervisor reconciles its checkpoint deadline
  to the earliest `occurredAt` of a verified `BACKEND_DISPATCH_INTENT` event
  whose role is `worker`, plus the pinned campaign duration. The read-only
  controller inspection covers every bound task and configured successor
  admission and verifies the full event hash chain. A valid earlier checkpoint
  deadline stays binding, a malformed or later value cannot extend it, and a
  stored non-null deadline without a verified dispatch anchor fails closed.
  The controller pins the effective bound in the append-only hash-chained
  `CAMPAIGN_DEADLINE_BOUND_PINNED` event under the stable campaign ID, along with
  the duration and cumulative task IDs. Reconciliation carries prior task IDs
  forward, rejects a duration change, and only tightens the bound when earlier
  verified dispatch evidence appears. Editing a checkpoint to a later value
  before the source deadline cannot extend a prior pin, including after restart.
  A task ID pinned under one campaign ID cannot be reassigned to another; any
  overlap across campaign IDs fails closed before writes.
  Each bound controller run must exist and have a safe positive
  current cycle with a complete contiguous history from cycle 1; missing,
  duplicate, or gapped cycle rows fail closed before deadline derivation. Every
  cycle's safe nonnegative submission counter must agree with
  its exact count of verified worker-intent events. Positive submissions
  require a canonical `startedAt` no later than the first worker intent (within
  the small skew from separate controller clock reads), and a start anchor
  requires positive submissions. Reset or inconsistent projections fail
  closed even when the checkpoint contains a later valid deadline.
  Before intake or runner dispatch, every configured cycle-admission reference
  must resolve to its matching controller run. A missing or unreadable run
  produces the typed `HOLD_CYCLE_ADMISSION` result and keeps the task held until
  a later tick can resolve that run.
  Successor admission revalidates the private task file's exact bytes after its
  awaited preflight and passes both the exact event-derived source deadline and
  the supervisor's effective `deadlineAt` bound into the controller transaction
  for a final check after Git/base validation. Before lock repair or writes, the
  controller re-verifies the full event chain and the same worker-intent/
  projection evidence for the campaign task IDs. It requires the source to
  equal the earliest verified worker intent plus the pinned campaign duration;
  the effective bound must match the durable pin, and the transaction enforces
  the immutable minimum before any lock repair or cycle write. A configured
  task omission cannot discard anchors from earlier pins. A missing bound is not accepted
  after worker dispatch has established the campaign anchor.
  Admission preflight uses the controller-pinned worktree root; after it
  returns, the supervisor rechecks the binding, canonical repository root, and
  Git common directory against that captured identity. A retargeted checkout is
  held without admission. The controller's read-only lock snapshot covers all
  conflicting worktree, overlapping write-scope, and semantic-domain locks.
  A lock conflict prevents preflight and stays suppressed until that snapshot
  changes, including when the conflict is released. SQLite lock-table triggers
  maintain a durable monotonic epoch, which detects a lock acquired and released
  during awaited preflight; the controller checks the captured epoch again
  inside its admission transaction. A checkpointed cycle is woken once per
  supervisor instance and once after restart, preserving same-instance runner
  failure suppression on later ticks. The controller validates complete,
  contiguous cycle history and safe submission/start-anchor consistency across
  all prior cycles before admission or lock repair; incomplete or inconsistent
  history is rejected without ledger writes.
  Unchanged environment holds are suppressed until the task digest or relevant
  PATH/PATHEXT executable presence/metadata changes; reassessment never resets
  execution counters or no-progress history.
  Exhaustion pauses the task
  while preserving the objective, cycle and evidence. Root may admit a new
  dated, numbered cycle under the same `taskId` only after material new evidence
  or a corrected implementation plan, with the reason and prior history linked.
  Unchanged input, cosmetic metadata edits or a new prompt alone do not admit a
  cycle or reset its caps. Prior cycles remain immutable; the cumulative
  semantic no-progress guard still applies.
- If an attempted operation's effect is unknown, quarantine it and use
read-only authoritative reconciliation. Do not retry while the effect is
unknown. Out-of-scope work remains blocked.
- Implementation, test, review and CI failures use the active per-cycle repair
bounds and rerun every affected downstream check. Missing authority, unavailable
capability and dependency failures block only the affected task or action.

A policy change never overwrites or refunds a historical terminal record. Root
may reassess a historical metadata-only block under the same stable task identity
using current authority and actual state; record a new dated result linked to the
old history. A genuine implementation, external-authority or unknown-effect
block is not waived by this v4 update.

## Historical v1 and v3 records

The v1 packet, delivery-DAG, execution-DAG and G0 preparation contracts remain
available for structural validation and historical audit. Under v4,
`prepare-g0.mjs` is an archival read-only audit path: it creates no new
reservation and publishes no new receipt. `--publish` is rejected before any
write. Historical v1 contracts and receipts, WF00 source pins, and
[SOURCE-RECONCILIATION.md](SOURCE-RECONCILIATION.md) retain their original bytes
and meaning. The v3 preparation and deadline caps are archived in the machine
policy; they do not govern ordinary v4 task readiness or execution cycles.

## Implementation boundary

`tools/delivery-control/preflight.mjs` is a local readiness tool. Its checks do
not execute task commands, dispatch a worker, authenticate a mandate, persist a
workflow ledger or prove that a production controller exists. Only root can
reconcile trusted conversation or harness authority. A structural or `READY`
result cannot replace that reconciliation.

The optional repository-local controller has a separate
[runtime and operations contract](LOCAL-CONTROLLER.md). Its private queue,
fenced leases, role dispatch and loopback dashboard do not change preflight's
read-only semantics or grant Business, provider, merge or deployment authority.
Runtime evidence must identify the actual backend and exact candidate; a local
queue or successful model response is not proof of accepted delivery.

Version diff (2026-10-15): v4 makes one task-readiness record and automatic,
read-only preflight the ordinary path; folds root decision, integration and
final delivery into one responsibility; separates metadata repair from
per-cycle implementation budgets; and makes metadata-only no-progress
resumable. Keeps risk-specific authority, independent verification and review,
required tests and exact-head CI, and all historical v1/WF00 records intact.
