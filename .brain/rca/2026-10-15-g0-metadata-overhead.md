---
version: "0.1.0"
created_at: "2026-10-15T06:33:56+07:00,CODEX"
last_update: "2026-10-15T06:33:56+07:00,CODEX"
status: "candidate"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "ordinary G0 metadata overhead, deadline anchoring and repair disposition"
---

# RCA — ordinary G0 metadata could consume task capacity

## Summary

The v3 delivery procedure put ordinary repository work through sealed G0 packet
preparation. At the pinned base, the helper reserved a preparation attempt before
reading the packet, sidecar or dependency-proof files. The v3 policy capped
preparations at three and started the run deadline at the first preparation or
G0 attempt. Metadata construction could therefore consume capacity before a
worker started.

For ZAI010, the reported PowerShell quoting error stopped draft construction
before formal preflight. The current primary Git state has only the recorded
ZAI010 mandate; there is no packet and no worker dispatch. No product change or
implementation attempt is observed. This incident exposed a workflow design
risk; it did not demonstrate that ZAI010 consumed a v3 reservation.

The v4 correction uses one read-only `task-readiness/v1` record for ordinary
work. Metadata repair consumes no implementation or execution-cycle capacity,
and the execution deadline starts at first worker dispatch. Risk-specific
authority, independent review and mandatory test, CI and merge gates remain.

## Evidence and limits

### ZAI010 metadata construction

- Reported in the trusted task conversation: PowerShell quoting failed while
  constructing the ZAI010 draft, before formal preflight.
- Root-reported primary Git state: the ZAI010 mandate exists; there is no packet
  and no worker dispatch.
- Observed at this change's starting point: the v4 worktree was clean at base
  commit `73c104ed6834089b580e49b2647eca35bc67f91b`.
- Root-confirmed for this v4 work: the new policy task was recorded once as
  `task-readiness/v1`, with no packet, sidecar, hash pins or reservation
  counters. Its mandate reference points to the direct trusted user instruction.

### v3 behavior at the pinned base

At base commit `73c104ed`, `prepare-g0.mjs` reads the active preparation cap and
creates a shared reservation before it reads the candidate packet, preparation
sidecar or dependency-proof JSON. A malformed candidate therefore consumes a
preparation attempt. The v3 machine policy capped preparation attempts at three,
set the run cap to 120 minutes and anchored that run at the first draft
preparation or G0 attempt. See the [pinned v3 helper
source](https://github.com/Freshair129/zuri.ai/blob/73c104ed6834089b580e49b2647eca35bc67f91b/tools/delivery-control/prepare-g0.mjs)
and the v3 policy at that same base.

Those values describe historical policy; they do not quantify time lost or
product impact in ZAI010. The v3 policy described local helper behavior and did
not claim that a durable controller or ledger had shipped.

### Related earlier delivery evidence

ZAI009 PR #663 is separate historical evidence, not part of ZAI010's direct
failure chain. Root's earlier observation was that `govern` failed after
generated documents and the operations README were stale outside the one-file
task scope. Root rechecked PR #663: it remains open at commit
`ef391aa6299f285fe77942f1c0f7b7747a8a87b`; `govern` and `verify` fail, while all
four test shards and the build pass. Root located YAML 2.9.0 in an existing
isolated dependency cache and copied it into ignored `node_modules` for the
specified generator run. No system PATH or dependency lockfile changed.

This evidence confirms that generated-document and operations checks remain
acceptance gates. It does not establish timing, percentage impact, or that
preflight can waive them; those impact measurements are unknown.

## Root cause

1. Preparation metadata and task execution shared an attempt lifecycle. The v3
   helper reserved capacity before reading candidate files, so quoting or JSON
   defects could consume preparation attempts even when no task code ran.
2. The deadline started before implementation. Draft construction and preflight
   consumed the run window before worker dispatch.
3. Ordinary work inherited packet, sidecar, dependency-proof and per-criterion
   environment receipt fields that repeated intent root could derive from the
   roadmap and trusted delegation. Each extra binding introduced a path,
   quoting or consistency failure point.
4. A local helper reservation and optional receipt did not provide the durable
   dispatch, authority or recovery controls of a workflow controller.

## Corrective actions

- Adopt one ordinary `task-readiness/v1` record with required
  `schemaVersion`, `taskId`, objective, acceptance strings, `writeScope`,
  `shell: false` check declarations and `mandateReference`; optional dependency
  references name a task and may name a revision.
- Add read-only automated preflight for Git base, ROADMAP dependency evidence,
  changed-path scope and environment capability. It does not execute declared
  checks, dispatch work, write state or grant authority. `READY` is evidence
  only. The `--changed` flag includes changed path sets in output; scope checks
  always run.
- Classify a malformed record as `METADATA_DEFECT` only when the failed action
  is proven to have had no product effect. Repair it with `REPAIR_METADATA`
  without implementation, submission, control-plane-successor or execution-cycle
  spend. Unsafe paths and scope escapes return `BLOCKED_SCOPE`; they are not
  metadata repairs. Unknown effects remain quarantined for read-only
  reconciliation.
- Bound identical semantic no-progress by the active machine-policy cap. At the
  cap, yield `YIELD_REASSESS`, preserve the stable task identity and evidence,
  and continue independent eligible work. This outcome is resumable, not
  terminal; the guard remains cumulative across execution cycles.
- Start each bounded execution-cycle deadline at its first worker dispatch.
  Retries and resumes within the same cycle keep that anchor. Exhaustion pauses
  the cycle with its history intact. Root may admit a new dated, numbered cycle
  under the same `taskId` only after material new evidence or a corrected
  implementation plan, recording the reason and linking prior history. A new
  cycle does not overwrite or refund the prior one.
- Keep unknown effects quarantined, scope escapes blocked, and actual
  risk-specific grants required for production, destructive and
  security-sensitive actions.
- Keep v1 validators, contracts, receipts, source pins and WF00
  `SOURCE-RECONCILIATION.md` available for historical audit. Under v4,
  `prepare-g0.mjs` is read-only and cannot create a reservation or publish a new
  receipt. Root may reassess a historical metadata-only block under the same
  task identity and current authority, with a new dated record linked to the
  original. Implementation, external-authority and unknown-effect blocks are
  not waived.
- Retain distinct worker, verifier and reviewer sessions, independent review
  of the same exact patch, all mandatory tests, repository checks and exact-head
  CI. One Sol root delivery responsibility covers in-scope decisions,
  integration and authorized delivery. An authorized commit, push or PR may
  collect pending CI; merge and release wait for all applicable gates. No
  documentation CI exemption is added.

The active procedure is in
[WORKFLOW-POLICY.md](../../docs/architecture/delivery-control/WORKFLOW-POLICY.md).
Its numeric caps and explicit v3 archive are in
[model-policy.json](../../docs/architecture/delivery-control/contracts/model-policy.json).
The CLI guidance is in [tools/delivery-control/README.md](../../tools/delivery-control/README.md).

## Acceptance and exit gates

This correction remains a candidate until implementation, tests and required CI
are reviewed on the exact integrated revision. The Node suite is
[tools/tests/task-preflight.test.mjs](../../tools/tests/task-preflight.test.mjs),
run through `npm run delivery:test`; the governance workflow is
[.github/workflows/governance.yml](../../.github/workflows/governance.yml).
The implementation worker reports the focused Node suite passed 11/11; root
confirms current task preflight returned `READY` and the valid legacy ZAI009
structural audit returned read-only `PASS`. These results do not establish the
integrated documentation governance, independent review or exact-head CI gates;
root is running those on the composed revision. Acceptance must demonstrate
that:

1. A valid record returns `READY` with no authority grant, dispatch, command
   execution or state write.
2. Malformed JSON and missing required fields return `REPAIR_METADATA` without
   reservations, implementation/submission spend or a started execution cycle.
   Unsafe, escaping or out-of-scope paths return `BLOCKED_SCOPE`.
3. ROADMAP dependencies expose their completion evidence; unresolved
   dependencies and unavailable check environments return their typed blocked
   states.
4. Preflight validates declared check capability without executing the check;
   `--changed` controls path reporting while scope checks always run.
5. Repeated identical metadata failure at the active cap returns
   `YIELD_REASSESS`, remains resumable and preserves task identity across cycles.
6. Implementation, external-authority and unknown-effect failures remain
   distinct; unknown effects are not retried automatically.
7. The legacy G0 audit is read-only, returns an archival structural result with
   `authorityGrant: false`, `dispatchAllowed: false` and
   `stateWritePerformed: false`, and rejects `--publish` before any write.
   Historical v1 validation works without changing pinned records.
8. The focused Node suite and every mandatory repository test, review,
   `govern`, `verify`, build and exact-head CI gate pass. Merge waits for the
   applicable acceptance, review, test, CI and authority evidence.

**Evidence at authoring:** the focused suite and source checks are recorded above.
Integrated governance, independent review and hosted CI results are recorded by
root on the delivered revision and its pull request. This RCA does not infer
those results from a documentation reference; merge requires the passing checks.

## Version diff

0.0 → 0.1.0 (2026-10-15): records the v3 metadata-capacity failure mode and
adopts the v4 single-record, read-only preflight correction with per-cycle
execution caps. ZAI010 had no packet, worker dispatch or observed product effect
at the time of the reported quoting failure. Historical PR #663 results are
recorded separately. Integrated test and CI acceptance remain pending.
