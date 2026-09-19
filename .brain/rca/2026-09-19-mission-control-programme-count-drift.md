---
version: "0.1.0b"
created_at: "2026-09-19T21:25:00+07:00,RWANG"
last_update: "2026-09-19T21:25:00+07:00,RWANG"
status: "under review"
attributes:
  domain: "platform-control"
  doc_type: "root-cause-analysis"
  scope: "Mission Control roadmap registration and programme projection cardinality"
---

# RCA - Mission Control programme count drift

## Complexity and risk

- **Complexity:** C-2 — documentation-driven programme projection repair
- **Risk:** MEDIUM — canonical roadmap and existing programme consumers must remain aligned

## Symptom

PR #468's hosted unit/integration job failed three assertions after the approved
Mission Control task row was added: the canonical generated projections contained
119 tasks while existing programme tests and the hand-maintained task projection
still described 118.

## Evidence

- Hosted `programme-containers.test.js` reported 119 generated containers versus an expected 118.
- Hosted `platform-control-route-contract.test.js` reported a 119-container key set versus the 118-task projection.
- `ROADMAP.md`, `roadmap-sot.js` and `program-roadmap-containers.js` all contained `TASK-ZAI-119`.
- `program-roadmap-data.js` stopped at `TASK-ZAI-118`, leaving the member/operator programme projection on the old cardinality.

## Root Cause

The canonical roadmap source was extended with `TASK-ZAI-119`, and the sanctioned
programme generator correctly produced 119 containers and a 119-node DAG. The
separate `program-roadmap-data.js` task-definition projection and its fixed-count
tests were not part of that generator, so they retained the previous 118-task
snapshot.

## Why the issue escaped detection

The focused Mission Control tests exercised the new roadmap SOT and generated
container modules but did not exercise the legacy programme-data projection. The
local full suite was run before the final roadmap source registration, so the
stale 118-task assertions were not rerun against the completed source set.

## Proposed prevention

1. Keep the hand-maintained `PROGRAMME_TASK_DEFINITIONS` projection aligned whenever a canonical programme task is registered.
2. Prefer source-derived cardinality assertions where the count is not itself the contract; retain explicit DAG edge and wave assertions where topology is the contract.
3. Run the full unit/integration suite after any canonical roadmap row or generated programme module changes.

## Current resolution state

- Added `TASK-ZAI-119` to the programme-data projection.
- Updated only the affected route, container and mobile projection expectations.
- The Mission Control implementation remains read-only/operator-only; no PORL writer, scheduler, migration, deployment or production claim was added.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-19 | under review | Reconciled the programme-data projection and its cardinality contracts with canonical TASK-ZAI-119 | pending | RWANG |
