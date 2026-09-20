# RCA — TASK-ZAI-040 roadmap evidence drift

## Symptom

The TASK-ZAI-040 roadmap row and task container still described the work as
in-progress | UNKNOWN | IN_PROGRESS, while bounded Campaign, Content and
Operations slices and the approved FR-185 planning/read continuation already
had local implementation and phase evidence. The task container also pointed
at a non-existent integration-test directory.

## Evidence

- docs/roadmap/ROADMAP.md carried the stale TASK-ZAI-040 row.
- docs/roadmap/marketing/tracking-status.json reported Operations as planned
  and counted five local DONE items, while
  marketing-implementation.plan.json contains six DONE items.
- The task-container test symbol link was
  apps/server/tests/integration/marketing, but the repository enumerates
  concrete Marketing integration test files instead.
- The existing phase reports and source/test files provide bounded local
  evidence, while their reports explicitly leave production and target
  environment gates open.

## Root cause

The canonical task ledger, generated task-container projection and marketing
tracking snapshot were not reconciled after the later bounded Marketing slices
landed. Their status fields were treated as independent notes instead of being
updated from the current code/test evidence and generated-output rules.

## Why the issue escaped detection

The stale status did not prevent the existing local tests from running, and the
broken task-container link was a documentation projection defect rather than a
runtime failure. Historical phase reports contained the newer evidence, but no
single TASK-ZAI-040 reconciliation pass had connected those reports to the
canonical roadmap and generated container.

## Proposed prevention

Keep one dated reconciliation report per bounded task handoff, use concrete
enumerated test-file links in task containers, regenerate programme outputs
after roadmap changes, and keep local, hosted, target-environment and
production evidence as separate explicit gates.
