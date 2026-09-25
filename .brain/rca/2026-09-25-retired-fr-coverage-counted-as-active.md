---
version: "0.1.0b"
created_at: "2026-09-25T00:00:00+07:00,Codex S1"
last_update: "2026-09-25T00:00:00+07:00,Codex S1"
status: "beta"
superseded_by: null
attributes:
  domain: "doc-governance-tooling"
  doc_type: "root-cause-analysis"
  scope: "FR coverage in apps/server/scripts/doc-graph.mjs"
---

# RCA — superseded FRs remain in active coverage gaps

## Symptom

After the S1 Edge surface retirement, `npm run govern` still reported FR-220 and
FR-222 as having no code anchor, and reported FR-222 as having no test path,
even though ADR-109 D5 retires those requirements and their former surfaces.

## Evidence

The composed S1 tree's generated graph listed FR-220 and FR-222 in
`stats.coverage.fr_without_code`, and FR-222 in `fr_without_tests`. The registry
marks FR-220, FR-221, and FR-222 superseded by ADR-109 D5. The graph parser
records that status as `superseded`; the coverage function filtered planned FRs
but did not filter superseded FRs. The same function already excludes
superseded BR/SEC/SDD rows from their active denominator.

## Root Cause

FR active coverage selected every non-planned FR, regardless of `status`. As a
result, retired FRs were treated as active requirements and generated false
coverage gaps. This was a filtering inconsistency in the graph generator, not a
missing implementation for the retired surfaces.

## Why the issue escaped detection

The retired-rule coverage code and its regression test covered BR/SEC/SDD only.
There was no assertion that a struck-through FR remains visible in the graph
while being excluded from active coverage. The generated graph therefore
surfaced the inconsistency only after the retirement rows were introduced.

## Fix

Exclude only FRs with parsed `superseded` status from active code/test coverage,
and retain their identifiers in a separate `fr_superseded` list for auditability.
Add regression assertions that FR-220/221/222 remain represented as retired,
while active FR-050/140/141/144 remain visible in the code-coverage gaps.

## Proposed prevention

Keep retirement status explicit in coverage outputs and test both sides of the
boundary: retired requirements must not inflate active gaps, and active
requirements must not be hidden by the retirement filter.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-25 | beta | Recorded and fixed superseded FRs being counted as active coverage gaps | pending | Codex S1 |
