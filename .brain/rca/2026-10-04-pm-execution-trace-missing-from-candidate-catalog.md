# PM execution trace records missing from the candidate catalog

## Symptom

The Project Manager candidate model had a `ProjectRunBinding.executionRunId`
reference to `ProjectExecutionRun`, and its human-readable E04 ERD showed
`ProjectExecutionRun` and `ProjectExecutionStep`. The machine-readable table
catalog did not declare either parent record, so the reference could not resolve.

## Evidence

At review, `data-model.candidate.json` declared 87 table records and contained no
`ProjectExecutionRun` or `ProjectExecutionStep` name. Its `ProjectRunBinding`
record referenced `ProjectExecutionRun`, and the relationship list used it as a
parent. Document 18's E04 ERD already named both trace records. A candidate
integrity check therefore failed with `missing model ProjectExecutionRun`.

## Root Cause

The architecture refinement separated the Project Manager workflow trace from
Integration's data-pipeline ledger in prose, API contracts and the ERD, but the
source table catalog was not updated with the PM run and step records. The
diagram and dictionary were maintained ahead of the machine-readable source.

## Why the issue escaped detection

The earlier checks verified JSON parsing, workflow schema/example shape,
blueprint nodes and edges, and document-generated views. They did not assert
that every table field reference, relationship endpoint and ERD entity exists in
the canonical `tables[].name` inventory.

## Proposed prevention

Keep Project Manager execution state in explicit `ProjectExecutionRun` and
`ProjectExecutionStep` records. Validate all `fields[].references`, relationship
endpoints and ERD entity names against the candidate table inventory. Keep
Integration `PipelineRun` / `PipelineStep` and their `StepAttempt` extensions
scoped to data-pipeline work; do not use their IDs as aliases for PM workflow
execution.

## Validation

The corrected catalog contains 89 unique records, including both PM trace
records. Every field reference, relationship endpoint and ERD entity resolves to
a catalog record; the workflow example validates against schema 1.1; the
blueprint has 19 nodes and 30 valid edges. No application code, Prisma schema or
migration changed.
