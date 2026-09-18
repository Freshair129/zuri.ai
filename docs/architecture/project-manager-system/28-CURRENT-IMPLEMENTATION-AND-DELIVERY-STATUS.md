---
title: Current Project Manager implementation and delivery status
doc_type: evidence-snapshot
version: "0.1.0b"
created_at: "2026-09-18T20:42:13+07:00,RWANG"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
domain: project-manager
status: candidate
snapshot_type: CURRENT_IMPLEMENTATION_STATUS
snapshot_at: 2026-09-18T02:59:30+07:00
source_of_truth: github
attributes:
  doc_type: evidence-snapshot
  domain: project-manager
---

# Current Project Manager implementation and delivery status

This document is the repository copy of the Site status snapshot. It records source-derived evidence at a point in time; it does not promote candidate design into runtime activation.

## Snapshot

| Area | Value | Evidence or limit |
|---|---|---|
| Design baseline | v0.9.0b / CANDIDATE | Candidate review set |
| PM tasks | 17 total; 2 done, 3 review, 12 planned | Snapshot, not a product route |
| PM features | 9 total; 1 ready, 6 with tasks remaining, 2 unmapped | Task/registry gate only |
| PM FRs | 55 total; 1 ready, 16 with tasks remaining, 38 unmapped | Direct mapping/readiness is incomplete |
| Release | MERGED_AND_DEPLOYED | PR #454, merge SHA 65587f1a1f2a47169eca1b173582d99c9b9c748c |
| Production image | zuri-ai-web:main-65587f1a | Health evidence is separate from PM activation |
| Post-merge E2E | NOT_FINALIZED_AT_LAST_OBSERVATION | Do not call full PM activation proven |

## Canonical artifacts

- [PM domain document spine](../../domains/project-manager/README.md)
- [Canonical FR index](../../domains/project-manager/FR-INDEX.md)
- [Proposal requirement index](../../domains/project-manager/requirements/README.md)
- [PM requirement JSON index](contracts/pm-requirement-index.json)
- [Machine-readable status snapshot](contracts/current-implementation-status.snapshot.json)
- [TaskUsageLedger implementation packet](27-TASK-USAGE-LEDGER-IMPLEMENTATION-PACKET.md)
- [G14 registry packet](26-G14-REGISTRY-IMPLEMENTATION-PACKET.md)

## TaskUsageLedger interpretation

The snapshot reports 0 task-bound rows and availability NOT_REPORTED. Actual task tokens and active time therefore remain NOT_REPORTED.

- Actual used tokens = inputTokens + cacheWriteTokens + outputTokens.
- cacheReadTokens is informational and is not included in used tokens.
- predictedTokens, container totals, lane aggregates and done status never become task actuals.
- Missing rows remain NOT_REPORTED; they are not converted to zero.

## Release and activation boundary

PR #454 merged at 65587f1a1f2a47169eca1b173582d99c9b9c748c and produced zuri-ai-web:main-65587f1a. The release record says governance, tests, build and verify passed, while post-merge E2E was NOT_FINALIZED_AT_LAST_OBSERVATION.

G14 remains candidate with codegenReady=false, implementation NOT_STARTED and production NOT_RUN. Full PM feature activation is not implied by this merge or by the static Site.

## Evidence policy

This snapshot preserves UNKNOWN, NOT_REPORTED and NOT_RUN. It is time-bound evidence; refresh it from source and commit a new snapshot when the underlying release or ledger changes.
