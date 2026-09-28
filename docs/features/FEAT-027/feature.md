---
id: FEAT-027
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 45b1e9023d841ae1c20496d991b1fd111535c01b7b1bfeb3f70e5be13e92b637
statement_cell: 2
requirement_cells: [3]
subject_anchor: access grant lifecycle
---

# ZAI:FEAT-027

<!-- canonical-row:start -->
```text
| FEAT-027 | Access Grant Lifecycle — making a `Membership` a withdrawable grant rather than a membership fact: provenance and an end on the row, suspend/reinstate/revoke/offboard services with mandatory reasons and last-owner guards, an explicit scope grammar shared with `RoleBinding`, referential invariants moved from application convention into the database, erasure refusing while grants are live, one writer in identity, and an `unreachable-state` preflight check so a declared state that nothing writes fails the build (ADR-077, 2026-09-12) | FR-191, FR-192 | declared |
```
<!-- canonical-row:end -->
