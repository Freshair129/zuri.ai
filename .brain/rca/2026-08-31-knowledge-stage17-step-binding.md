---
version: "0.1.0b"
created_at: "2026-08-31T12:35:00+07:00,ATHER"
last_update: "2026-08-31T12:35:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "knowledge-ingestion"
  doc_type: "root-cause-analysis"
  scope: "FR-110 Stage 17 shared pipeline event provenance"
---

# RCA - Stage 17 gate accepted without its canonical step

## Complexity and risk

- **Complexity:** C-2 - documentation-driven service correction
- **Risk:** HIGH - a gate decision could be attributed to the wrong pipeline stage or to no persisted stage at all.

## Symptom

`recordPipelineEvent` accepted a valid `DPL-KNOWLEDGE-INGEST-V1` `GATE_UPDATED` event when its
`executionStepId` named a same-run Stage 2 step, and also when the step id did not exist. Both
cases persisted Stage 17 gate evidence, a receipt and an audit event.

## Evidence

- The service checked a found step's run and attempt, but never compared
  `step.pipelineStageId` with `event.pipelineStageId`.
- `GATE_UPDATED` has no step status transition, so an unknown step did not use the existing
  step auto-creation branch and then proceeded to gate persistence.
- The new RED cases in `tests/unit/platform/pipeline-tracking-service.test.js` failed because
  both promises resolved with `status: 'CREATED'`.

## Root Cause

The shared event contract validated that Stage 17 carried non-empty identity fields, but the
service treated those fields as descriptive once it reached persistence. It did not bind the
Stage 17 decision to the run's existing quality-gate `PipelineStep` row.

## Why the issue escaped detection

The earlier service test covered a mismatched tenant scope and the contract tests covered the
shape and field presence. Neither sent a scope-correct Stage 17 event through the service with an
existing wrong-stage step or a nonexistent step identity.

## Proposed prevention

1. For Stage 17 `GATE_UPDATED` only, require an existing step in the named run whose
   `pipelineStageId` is `DPS-KI-QUALITY-GATE` and whose `attemptId` matches the event.
2. Keep legacy step-event auto-creation unchanged for FR-071 and other non-Stage17 events.
3. Keep a positive service test using the quality step created by `createPipelineRun`, plus
   wrong-stage and unknown-step rejection tests asserting no gate, receipt or audit is written.

## Resolution and verification

The Stage17-only guard is implemented in
`src/platform/integrations/core/pipeline-tracking-service.js`. The focused service file passes
20/20 tests; the Stage17 and shared envelope contract files pass 33/33 tests. The RED run was
performed before the guard and failed for the intended acceptance reason.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-31 | beta | Documented and corrected Stage 17 step/stage/attempt binding gap | working-tree | ATHER |