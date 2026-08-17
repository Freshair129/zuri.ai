---
version: "1.0.0b"
created_at: "2026-08-18T00:00:00+07:00,ATHER"
last_update: "2026-08-18T00:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "doc-governance"
  doc_type: "root-cause-analysis"
  scope: "semantic drift between route/code reality and manual API/interface inventories"
---

# RCA — the document graph was fresh, but the inventories were still raw

## Symptom

docs/appendices/A-api-spec.md and docs/INTERFACE-INVENTORY.md were present in
the document graph and the generated views could be regenerated, but their
human-readable inventories no longer described the repository:

- the Interface Inventory said 35 page files while its table total was 34;
- the actual page tree contained 37 routes, including /files,
  /platform/integrations and /projects/[projectId]/inventory that were not
  registered there;
- the Interface Inventory said 19 operational sub-domain entries, while the
  runtime registry contains 21 operational entries plus one Business Home shell
  slot;
- the API documents and route map carried stale 55/44/43 handler claims while
  the current route tree contains 63 API route handlers.

The graph therefore looked governed while the source-facing documentation was
still raw/stale.

## Evidence

The evidence was enumerated from the current worktree on 2026-08-18:

| Check | Observed result | Evidence |
|---|---:|---|
| page route files | 37 | src/app/**/page.jsx enumeration |
| API route handlers | 63 | src/app/api/**/route.js enumeration |
| source domain entries | 8 | src/config/domains.js: business-home plus seven operational keys |
| operational domain keys | 7 | source registry excluding business-home |
| source sub-domain entries | 22 | source registry including Business Home Dashboard |
| operational sub-domain entries | 21 | source registry excluding Business Home Dashboard |
| missing interface rows before this RCA | 3 | /files, /platform/integrations, /projects/[projectId]/inventory |
| current API paths absent from Appendix A | 0 after the preceding Phase 1 update | every current route path is now represented; deferred lifecycle paths are explicitly separated |

The mechanism explains why the discrepancy survived:

1. scripts/doc-graph.mjs scans documents, pages and API route files into graph
   nodes and checks graph hashes/edges. It does not parse the count claims or
   interface/API tables in the two manual documents.
2. Before this change, scripts/doc-preflight.mjs checked API appendix path
   coverage only as a warning and had no page/interface parity check or
   machine-checkable inventory count.
3. .github/workflows/governance.yml checked generated projections
   (FEATURE-MAP.md, DOMAIN-MAP.md, TRACE.md and Appendix D), not the
   semantic content of the manual inventories.
4. docs/changes/ZV2-CR-007-INTERFACE-INVENTORY-NORMALIZATION.md described the
   correct responsibility split, but remained proposed and was never executed.
5. The current working tree also contains a concurrent FR-076/FR-077 slice.
   Its new route and feature note make the graph/report stale until the owning
   session runs the governed regeneration; this is a contributing timing factor,
   not the primary design defect.

## Root Cause

The repository had a structural graph guarantee, not a semantic inventory
guarantee.

The graph treated A-api-spec.md and INTERFACE-INVENTORY.md as ordinary
document nodes: existence, links, annotations and generated projections were
checked, but the claims inside their manually maintained tables were opaque.
The generated graph could therefore be perfectly fresh while those tables were
wrong.

The manual documents also had overlapping responsibilities. Interface routes,
domain counts, API counts, feature coverage and change planning were copied into
one file. Each copy had a different update trigger, so a route change could
update the route tree and generated graph without updating the human inventory.

## Why the issue escaped detection

- npm run docs:check answered “does the committed graph describe the scanned
  filesystem?”; it did not answer “does each manual inventory describe the
  filesystem?”
- the old API parity check was warning-level and there was no equivalent page
  parity check;
- numeric prose such as 34, 43/43 and 19 had no source marker and was not
  derived by a check;
- generated-view freshness was mistaken for source-document correctness;
- CR-007 had the right design diagnosis but no completed migration or gate;
- concurrent work updated graph inputs in the shared worktree, which exposes the
  same weakness more quickly but did not create it.

## Prevention and remediation applied

### Documentation normalization

- docs/INTERFACE-INVENTORY.md is now a bounded canonical UI registry with one
  row per current page route, explicit shell/domain/state/access/status fields,
  and a machine-checkable coverage marker.
- docs/appendices/A-api-spec.md now separates current routes from deferred
  integration lifecycle contracts, declares the 63-handler marker, and defines
  the minimum endpoint contract fields.
- docs/changes/ZV2-CR-007-INTERFACE-INVENTORY-NORMALIZATION.md is being closed
  as an executed documentation migration, not left as an unimplemented proposal.

### Mechanical gates

scripts/doc-preflight.mjs now:

- fails critically when a current API route is absent from Appendix A;
- checks the Appendix A current-handler marker against route-file enumeration;
- derives every page URL (including route-group stripping) and fails critically
  when a page route is absent from the Interface Inventory;
- derives operational domain/sub-domain counts from src/config/domains.js and
  fails critically when the Interface Inventory marker drifts.

The graph remains responsible for graph/projection freshness. Preflight now
guards the semantic boundary that the graph cannot infer.

## Acceptance and exit criteria

This RCA is closed only when all are true:

1. npm run docs:graph completes and generated outputs are reconciled;
2. npm run docs:check reports the graph up to date;
3. strict preflight reports no new critical finding from API/interface parity;
4. all 37 current page routes are represented exactly as current interfaces;
5. Appendix A represents all 63 current API handlers, while deferred lifecycle
   paths remain explicitly non-current;
6. the shared FR-076/FR-077 worktree is reconciled by its owning session, so
   generated feature/DB outputs and pending code are not falsely reported as
   shipped;
7. the final commit contains only the scoped documentation/governance changes
   plus intentionally regenerated outputs.

The first three checks are intentionally not claimed as a clean final pass while
the concurrent FR-077 files remain dirty and the generated graph/report records
that external work. A local PASS after reconciliation is required before release
readiness is reported.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-08-18 | candidate | Recorded why graph/projection freshness failed to detect semantic API/interface inventory drift; added remediation and exit gates | working-tree | ATHER |
