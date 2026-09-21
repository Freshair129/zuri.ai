---
version: "0.2.0b"
created_at: "2026-09-20T00:00:00+07:00,Codex"
last_update: "2026-09-20T00:00:00+07:00,Codex"
status: "candidate"
superseded_by: null
attributes:
  domain: "procurement"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-053 supplier cost-sheet intake documentation and governance evidence"
---

# RCA — TASK-ZAI-053 implementation outran its canonical documentation

## Symptom

The approved SmartGift cost/quote proposal scheduled TASK-ZAI-053 as planned,
but the isolated branch contained a supplier cost-sheet implementation with no
remote branch or pull request. Its six API routes and two database models were
not represented in the API/DB appendices, and the route files had no requirement
anchors.

## Evidence

- `git show 843b4ee5` contains the TASK-ZAI-053 implementation, migrations and
  focused tests; the source commit was not present on a branch or remote pull
  request before this audit.
- The approved proposal assigns `SupplierCostSheet` to Procurement, carton
  attributes to Inventory, and explicitly schedules preview → commit with
  locked FX and confirmed mapping for TASK-ZAI-053.
- The first strict `npm run govern` run reported six missing API appendix
  routes, a stale handler count (322 versus 328), and six route-anchor
  CRITICALs; it also reported the two new models absent from the DB appendix.
- The focused acceptance suite passed 60 tests before documentation
  reconciliation: workbook, route, Inventory/Procurement, OpenAPI and
  TASK-ZAI-053 integration coverage.

## Root Cause

The implementation was created without the same change carrying the canonical
charter, appendices, requirement anchors and generated roadmap/SOT update.
The repository's preflight checks can only verify route requirements when a
route opts into the `@req` annotation, so the missing anchors hid the new
handlers until strict governance was run.

## Why the issue escaped detection

The implementation commit was dangling rather than on a tracked branch, so the
normal PR and hosted governance path had not run. Local feature tests exercised
the behavior but did not assert the generated API/DB views or the roadmap state.

## Proposed prevention

1. Land the approved charter, API/DB appendix and roadmap/SOT reconciliation in
   the same pull request as the implementation.
2. Require every new route to carry a real `@req` anchor and run
   `npm run govern` with strict preflight before push.
3. Keep the migration as a written, unapplied artifact until the ADR-057
   operator and production gates are separately completed.

## Scope and release limit

This RCA covers only TASK-ZAI-053 documentation and governance drift. It does
not authorize TASK-ZAI-052/054/055/056 changes, deployment, credentials,
MSP/GKS writes, production migration or production activation.

## Reconciliation result

The proposal and completed TASK-ZAI-052 dependency establish TASK-ZAI-053 as
an approved bounded implementation slice. The six route anchors, Procurement
charter ownership, API/DB appendices and generated roadmap/runtime projections
were reconciled without changing adjacent task rows. The focused acceptance
proof is green, strict governance has zero CRITICAL findings, the server build
is green, and the programme-container projection is fresh. Both migrations are
written as release artifacts; no production migration, deployment or activation
was performed or claimed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-20 | candidate | Recorded the TASK-ZAI-053 code-to-documentation drift and the strict governance evidence that bounded its reconciliation. | working-tree | Codex |
| 0.2.0b | 2026-09-20 | candidate | Recorded the approved bounded reconciliation: focused proof, strict governance, build and generated container evidence are green; migrations remain written and unapplied. | working-tree | Codex |
