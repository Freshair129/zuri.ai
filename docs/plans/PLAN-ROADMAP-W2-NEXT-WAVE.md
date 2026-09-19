---
id: ZAI:PLAN-ROADMAP-W2-NEXT-WAVE
title: "Roadmap W2 next-wave dispatch and evidence plan"
version: "0.1.0b"
status: candidate
created_at: "2026-09-19T22:25:00+07:00,RWANG"
last_update: "2026-09-19T22:25:00+07:00,RWANG"
attributes:
  domain: platform-control
  doc_type: execution-plan
  scope: "Documentation-only W2 candidate dispatch, serial integration, and evidence closeout"
  source_of_truth: false
relations:
  - type: references
    target: ZAI:ROADMAP
  - type: relates_to
    target: ZAI:PLAN-MISSION-CONTROL-DAG-OBSERVABILITY-IMPLEMENTATION
---

# Roadmap W2 next-wave dispatch and evidence plan

This is a candidate dispatch plan derived from `docs/roadmap/ROADMAP.md` and
its generated 119-node/133-edge/21-wave SOT. It creates no canonical task ID,
changes no task status, and authorizes no merge, deployment, production
activation, PORL write, or scheduler action.

## 1. Candidate set and dependency truth

| Task | Current canonical state | Dependency position | Dispatch interpretation |
|---|---|---|---|
| TASK-ZAI-017 | planned / UNKNOWN / NOT_STARTED | Dependency-ready on TASK-ZAI-005 | W2 candidate-parallel closeout candidate; only after all conflict gates pass |
| TASK-ZAI-045 | review / UNKNOWN / IN_PROGRESS | Dependency-ready on TASK-ZAI-005 | W2 candidate-parallel closeout candidate; only after all conflict gates pass |
| TASK-ZAI-041 | review / UNKNOWN / IN_PROGRESS | Depends on TASK-ZAI-001 | Not dispatch-ready until TASK-ZAI-001 exits review |
| TASK-ZAI-047 | review / ISOLATED / ISOLATED_ACCEPTED | Depends on TASK-ZAI-045 | Waits on TASK-ZAI-045; isolated evidence is not a W2 dispatch clearance |
| TASK-ZAI-049 | planned / UNKNOWN / NOT_STARTED | Depends on TASK-ZAI-045 | Waits on TASK-ZAI-045; no production-storage claim is implied |
| TASK-ZAI-119 | review / HOSTED_CI / MERGED | Mission Control implementation merged; PORL unavailable | Evidence-closeout lane only; not a new implementation duplicate |

TASK-ZAI-017 and TASK-ZAI-045 are in the same canonical topological wave and
both depend on TASK-ZAI-005. Same-wave placement means candidate-parallel only;
it does not establish merge safety. Before dispatch, independently check lane,
owner, active assignment, branch/worktree, shared-file, and capability-key
conflicts for both candidates.

## 2. W2 entry gates

The serial integrator records the result of every gate before either candidate
starts:

1. **Canonical dependency gate:** re-read the current ROADMAP SOT and verify
   TASK-ZAI-005 is the resolved predecessor for both candidates. A changed or
   blocked predecessor stops the wave.
2. **Lane and owner gate:** one declared lane, one accountable owner/PIC, one
   attributable branch/worktree, and no duplicate active assignment per task.
3. **Shared-file gate:** capture changed-file manifests before execution. The
   roadmap, generated projections, registries, and shared contracts are shared
   files; overlap requires a named serial integrator.
4. **Capability gate:** compare delivered capability keys and relations. An
   existing key is not reused unless the relation is explicitly adapter,
   legacy, fallback, or replacement.
5. **Evidence-scope gate:** label each proof as `SPEC`, `LOCAL`, `ISOLATED`,
   `HOSTED_CI`, or `PRODUCTION`. Missing execution records are `NOT_RUN`, not
   inferred success.
6. **Stop authority:** the serial integrator may hold or cancel dispatch when
   any gate is unknown; no candidate-parallel label is a merge approval.

## 3. Execution shape and serial integration

After entry gates pass, TASK-ZAI-017 and TASK-ZAI-045 may execute in separate
lanes. Each lane owns its own branch/worktree and writes only its declared
scope. Neither lane may hand-edit generated projections or overwrite the
other lane's evidence.

The serial integrator then:

1. reconciles the two manifests and detects overlap or duplicate capability
   claims;
2. regenerates the derived roadmap/projections from the canonical source;
3. runs the focused tests, governance and build appropriate to the changed
   surface, preserving each evidence scope; and
4. presents one composed diff for review. No branch is merged solely because
   both candidates completed independently.

## 4. Exit gates and stop/rollback conditions

The wave exits only when each dispatched task has an evidence record, the
canonical status/proof/implementation cells are updated truthfully, generated
outputs are fresh, focused tests and governance pass, and the serial integrator
has reviewed the composed diff. Production remains a separate gate.

Stop and preserve the last known-good state when:

- a dependency, owner, lane, revision, shared-file, or capability check is
  missing, contradictory, or changes during execution;
- a test/build/governance check fails, is flaky, or runs zero tests;
- a generated output differs from its source after reconciliation;
- a task attempts to write outside its approved scope or to claim another
  lane's evidence; or
- PORL, provider, production, or migration evidence is unavailable.

Rollback means discard or quarantine the unmerged candidate worktree/branch
according to the lane's review procedure and retain the evidence of the stop;
it does not reset shared main, delete another worktree, or fabricate a clean
status. Any production rollback is out of scope for this document.

## 5. TASK-ZAI-119 evidence closeout

TASK-ZAI-119 is already merged and hosted-CI verified. Its next action is an
evidence-closeout review of the read-only Mission Control projection, not a
second implementation. The PORL adapter is unavailable, so PORL observation,
production activation, deployment, and production readiness remain
`NOT_RUN`. No W2 dispatch may turn this row into a live orchestration claim.

## 6. Version diff

Before: the canonical DAG had no explicit W2 dispatch note separating
dependency readiness from merge safety and evidence scope.

After: this candidate plan names the two W2 candidate-parallel closeout
candidates, their dependency waits, entry/exit gates, serial integration,
stop/rollback rules, and TASK-ZAI-119's evidence-only boundary.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-19 | candidate | Added the documentation-only W2 dispatch, evidence, serial-integrator, and Mission Control closeout plan | pending | RWANG |
