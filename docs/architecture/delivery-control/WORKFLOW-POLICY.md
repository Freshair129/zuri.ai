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
- Implementation and submission caps and execution deadlines apply per bounded
execution cycle. The deadline starts at that cycle's first worker dispatch;
retries and resumes within the cycle do not reset its anchor. Exhaustion pauses
the task while preserving the objective, cycle and evidence. Root may admit a
new dated, numbered cycle under the same `taskId` only after material new
evidence or a corrected implementation plan, with the reason and prior history
linked. Unchanged input, cosmetic metadata edits or a new prompt alone do not
admit a cycle or reset its caps. Prior cycles remain immutable; the cumulative
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

Version diff (2026-10-15): v4 makes one task-readiness record and automatic,
read-only preflight the ordinary path; folds root decision, integration and
final delivery into one responsibility; separates metadata repair from
per-cycle implementation budgets; and makes metadata-only no-progress
resumable. Keeps risk-specific authority, independent verification and review,
required tests and exact-head CI, and all historical v1/WF00 records intact.
