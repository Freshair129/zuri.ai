---
version: "0.1.0b"
created_at: "2026-08-15T07:00:00+07:00,Luna"
last_update: "2026-08-15T07:00:00+07:00,Luna"
status: "beta"
superseded_by: null
attributes:
  domain: "agent-governance"
  doc_type: "root-cause-analysis"
  scope: "Zuri V2 PR #12 semantic requirement and ADR identity collision"
---

# RCA — PR #12 semantic requirement and ADR identity collision

## Complexity and risk

- **Complexity:** C-3 — architecture/documentation identity reconciliation across a paused rebase
- **Risk:** HIGH — requirement keys, security boundaries, generated traceability, and MSP authorization semantics

## Symptom

Rebasing PR #12 onto `origin/main` stopped with two unmerged files:
`docs/PRD-SDD-v1.0.md` and `docs/.preflight-report.json`. The same requirement and
ADR keys represented different meanings on the two sides. The later Landing branch
used the Phase 1 production keys `FR-051` and `SDD-026`, while PR #12 used
`FR-055`, `NFR-013`, `BR-014`, `SDD-028`, `SEC-012`, and `ADR-020` for MSP
authorization even though those keys already belonged to production readiness and
controlled activation.

## Evidence

- The paused rebase had `origin/main` at `b4f52f8`, incoming commit `bddbd1c`, and
  exactly two unmerged paths (`git ls-files -u`): the PRD and generated preflight report.
- The first-merged Phase 1 registry at `f196212` defines the production meanings:
  `FR-051..055`, `NFR-011..013`, `BR-012..014`, `SDD-026..028`, `SEC-010..012`,
  and `ADR-018..020`.
- `origin/main` also contained `docs/ADR-018-ZURI-BRANDED-ENTRY-LANDING.md`,
  `docs/features/FR-051-zuri-branded-entry-landing.md`, and landing annotations
  using the production `FR-051`/`SDD-026`/`ADR-018` keys.
- The incoming PR #12 files introduced `docs/ADR-020-MULTI-TENANT-MSP-VAULTS.md`
  and MSP annotations using the controlled-activation `FR-055`/`ADR-020` family.
- The reserved local Typed Agent keys `FR-058`, `BR-016`, `SDD-031`, `SEC-014`,
  and `ADR-023` were not available for this repair. A pre-existing production SQL
  annotation using reserved `SEC-014` was corrected to `SEC-010`/`SDD-026`.

## Root Cause

Independent branches allocated sequential requirement and ADR labels without
consulting the first-merged registry as an immutable identity ledger. A later
Landing/PlanEnvelope branch reused keys that already had production meanings, and
PR #12 reused the controlled-activation family for MSP authorization. Generated
artifacts were then produced from each branch's local registry, so the rebase
exposed both Git conflicts and semantic duplicate keys at the same time.

## Why the issue escaped detection

The project treated requirement/ADR identifiers as editable labels during parallel
work instead of immutable keys. Existing unit tests and source annotations checked
feature behavior but did not enforce uniqueness across the PRD, ADR filenames,
feature frontmatter, annotations, and roadmap references. Generated graph/preflight
outputs were branch-local and were not regenerated after the semantic branches
diverged, allowing a clean individual branch to carry a conflicting registry.

## Resolution mapping

| Meaning | Resulting identity |
|---|---|
| Phase 1 production isolation/readiness/controlled activation | `FR-051..055`, `NFR-011..013`, `BR-012..014`, `SDD-026..028`, `SEC-010..012`, `ADR-018..020` unchanged |
| Later Zuri Landing | `FR-056`, `SDD-029`, `ADR-021` |
| PR #12 MSP authorization | `FR-057`, `NFR-014`, `BR-015`, `SDD-030`, `SEC-013`, `ADR-022` |
| Reserved Typed Agent allocation | `FR-058`, `BR-016`, `SDD-031`, `SEC-014`, `ADR-023` unused |

## Proposed prevention

1. Treat `FR/NFR/BR/SEC/SDD/ADR` identifiers as immutable registry keys and allocate
   new meanings only through the first-merged registry.
2. Make semantic renames atomic across PRD rows, ADR/feature filenames,
   frontmatter, annotations, tests, plans, roadmaps, and cross-references.
3. Regenerate `docs/.preflight-report.json`, `docs/.doc-graph.json`, and generated
   traceability outputs serially after any semantic merge or rebase.
4. Add a CI uniqueness gate covering registry definitions, annotations, generated
   nodes, and ID-bearing filenames, with an explicit reserved-ID list.
5. Keep generated artifacts source-derived and reject hand-edited graph/preflight
   output when its source hash does not match the repaired registry.

## Resolution status

The conflicts were resolved and the one-commit rebase continued as commit
`4bcf4ce323e3c6133c3b4b16574d21eb28a0e57b` on
`codex/pr-12-conflict-resolution`. The serial test, build, documentation, and
integrity gates remain the verification record for this RCA.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-15 | beta | Documented PR #12 semantic ID collision, evidence, mapping, and prevention | 4bcf4ce | Luna |
