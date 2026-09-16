# P3 memory trace causality review

## Symptom

The initial P3 guard could accept reused occurrence IDs across executions. A
memory validation failure also left the nested execution marked complete when
its model call was complete.

## Evidence

The initial `inspectMemoryWriteLink` filtered to the current execution before
checking parent IDs, hiding other same-turn occurrences. In `playbackTrace`,
memory reasons were added only after constructing `executionsDto`.

## Root Cause

Scope matching was confused with occurrence uniqueness, and aggregate memory
validation ran after the execution status projection.

## Why the issue escaped detection

Initial tests substituted foreign parents but did not create matching parents
in both executions with reused IDs. Incomplete-receipt tests also had missing
model output, masking an independently complete model execution.

## Proposed prevention

Check occurrence reuse across executions within the visible scoped turn before
selecting parents. Stable action intent IDs may repeat; context/attempt IDs may
not. Apply memory reasons before projecting execution DTOs. Regression tests
cover both duplicate-ID families, a complete model with incomplete memory
authority, and malformed imported rows. No runtime activation is involved.
