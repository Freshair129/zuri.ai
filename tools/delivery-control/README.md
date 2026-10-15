# Delivery-control tools

The active v4 path checks ordinary task readiness from one task record. The WF01
packet and DAG validator remains available for historical v1 records and audit;
it does not authorize work or write a ledger. See the active
[coding-delivery policy](../../docs/architecture/delivery-control/WORKFLOW-POLICY.md)
and [machine policy](../../docs/architecture/delivery-control/contracts/model-policy.json).

## Ordinary task readiness

A task file is one JSON object with required `schemaVersion: "task-readiness/v1"`.
It contains stable task identity, objective, acceptance strings, write scope,
declared check commands and a mandate provenance reference. Dependencies are
optional; each names a `taskId` and may include a `revision`.

    {
      "schemaVersion": "task-readiness/v1",
      "taskId": "TASK-EXAMPLE",
      "objective": "Update the example documentation flow",
      "acceptance": ["The documented path matches the current implementation"],
      "writeScope": ["docs/example.md"],
      "checks": [
        {
          "shell": false,
          "executable": "node",
          "argv": ["--test", "tools/tests/task-preflight.test.mjs"],
          "cwd": "."
        }
      ],
      "mandateReference": "trusted conversation task reference",
      "dependencies": []
    }

Each declared check uses `shell: false` with `executable`, `argv` and `cwd`.
Write scopes without a trailing `/` name exact files. A trailing `/` explicitly
allows a directory and its descendants, including when that directory is new.
Filesystem existence never broadens an exact-file scope.
Preflight checks that the declaration is usable and the environment can support
it; it does not execute the command. The `mandateReference` records provenance
only. Root reconciles it against trusted conversation or harness context and
decides which in-scope effects are authorized.

Store this record in the private Git common directory so it does not become an
untracked product file outside its own scope. Resolve the directory once from
the selected worktree, save the record there, and run from the repository root:

    $taskFile = Join-Path ((git rev-parse --path-format=absolute --git-common-dir).Trim()) 'zuri-delivery-control/tasks/TASK-EXAMPLE.json'
    node tools/delivery-control/preflight.mjs --task-file $taskFile --base origin/main

The selected base defaults to `origin/main`. Optional flags are:

- `--changed` — include `changedPaths`, `committedChangedPaths` and `dirtyPaths`
  in the result. Preflight checks all changed paths against `writeScope` even
  when this flag is omitted.
- `--json` — print the machine-readable result.
- `--repo <path>` — use the specified repository root.

The equivalent npm entry point is:

    npm run delivery:preflight -- --task-file $taskFile --base origin/main

Preflight checks the Git base and working state, all changed-path scope,
dependency evidence and declared executable/environment capability. When a
listed dependency is completed in `docs/roadmap/ROADMAP.md`, its completion row
and evidence cell from the selected base commit are exposed in the result.
Working-tree or unmerged ledger edits cannot accept a dependency. A named revision must
resolve and be compatible with the selected base.

The result uses `task-preflight-result/v1` and includes status, `taskId`,
objective, baseline, dependency evidence, capability-only checks, typed issues
and a metadata repair summary. It records no authority grant, command execution,
dispatch or state write. Statuses are:

- `READY` — readiness evidence passed. This is not permission to act.
- `REPAIR_METADATA` — the task record needs a parse, schema or required-field
  correction.
- `BLOCKED_DEPENDENCY` — dependency acceptance evidence is not ready.
- `BLOCKED_SCOPE` — a requested path is unsafe, escapes the repository or is
  outside `writeScope`.
- `BLOCKED_ENVIRONMENT` — a declared check or repository environment cannot be
  supported.

## Ordinary delivery and failure resume

The ordinary path is `AUTOMATIC_TASK_PREFLIGHT`, worker implementation,
independent verification, independent review and one root delivery
responsibility. Required tests and exact-head CI remain mandatory. An authorized
commit, push or pull request may collect pending CI; merge and release wait for
all applicable acceptance, review, test, CI and authority gates. Documentation
has no blanket CI exemption.

A metadata defect proven to have no product effect is `METADATA_DEFECT` and is
repaired with `REPAIR_METADATA`. It consumes no implementation repair,
submission, control-plane-successor or execution-cycle capacity, and does not
start the execution deadline. Unsafe or out-of-scope paths return
`BLOCKED_SCOPE`. Metadata no-progress at the active cap returns
`YIELD_REASSESS`, remains resumable and preserves task identity. Preflight does
not retry a corrected record automatically.

The exported failure classifier also maps the canonical no-progress class to
resumable reassessment. A transient retry requires explicit same-input safety,
idempotence or proven effectlessness, and positive remaining capacity from
`retryAndLineage.limits.maxToolRetriesPerExecutionCycle`. Root records the retry
against that cycle before acting; the pure classifier does not persist counters.
Unknown effects always select read-only reconciliation first.

Implementation and submission caps and execution deadlines apply per bounded
cycle under the same stable `taskId`. The deadline starts at the cycle's first
worker dispatch; retries and resumes within that cycle do not reset it. An
exhausted cycle pauses with its history intact. Root may admit a dated numbered
cycle only after material new evidence or a corrected implementation plan,
linking the prior history and reason. The semantic no-progress guard is
cumulative across cycles. Unknown effects are quarantined for read-only
reconciliation and are not retried while unknown. External authority gaps block
the affected action; eligible independent work may continue.

`READY` never grants credentials, production, Business, provider or other
external authority. Production, destructive and security-sensitive effects
require their actual risk-specific grants and evidence. Use all
repository-required tests, independent review and exact-head CI.

The Node regression suite is
[tools/tests/task-preflight.test.mjs](../tests/task-preflight.test.mjs); run it
with:

    npm run delivery:test

The governance workflow includes this test job. Test completion and workflow
results must be verified on the exact revision before claiming a gate passed.

## Historical WF01 v1 validation

The v1 packet, delivery-DAG, execution-DAG and G0-preparation schemas remain
available. They are structural validators for historical records, not the
ordinary v4 task format. They do not dispatch work, execute declared commands,
authenticate trusted context, grant authority, or persist a workflow ledger.
Preserve the v1 schemas, receipts, source pins and WF00
[SOURCE-RECONCILIATION.md](../../docs/architecture/delivery-control/SOURCE-RECONCILIATION.md)
as historical evidence.

The legacy G0 command is an audit only under v4:

    node tools/delivery-control/prepare-g0.mjs --root-lineage-id TASK-EXAMPLE --packet .\packet.json --preparation .\preparation.json --dependency-proofs .\proofs.json

It returns `LEGACY_STRUCTURAL_AUDIT_ONLY` or
`LEGACY_STRUCTURAL_AUDIT_REJECTED`, with `authorityGrant: false`,
`dispatchAllowed: false` and `stateWritePerformed: false`. The publish flag is
rejected before any file write. Do not create new v3 preparation reservations
or receipts. The machine policy retains a frozen v3 audit projection and its
historical caps; those caps do not govern ordinary v4 readiness or repair.

The lower-level validator remains available for packet, delivery-DAG,
execution-DAG and fixture inputs. For example:

    node tools/delivery-control/validate.mjs --kind packet --input .\packet.json --dependency-proofs .\proofs.json
    node tools/delivery-control/validate.mjs --kind delivery-dag --input .\delivery-dag.json --trusted-context .\trusted-context.json --dependency-proofs .\proofs.json
    node tools/delivery-control/validate.mjs --kind execution-dag --input .\execution-dag.json --delivery .\delivery-dag.json --trusted-context .\trusted-context.json --dependency-proofs .\proofs.json

A validator `PASS` is structural evidence only. It cannot replace trusted
authority reconciliation, independent verification, review, mandatory tests,
exact-head CI or any required external grant. The local tools do not establish
that a persistent controller or ledger is installed.

Version diff (2026-10-15): documents the v4 single-record, read-only ordinary
preflight, active delivery path and per-cycle resume rules; keeps v1 validation
available only for historical audit and preserves all mandatory gates.
