---
id: FEAT-028
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 151170ad50d821b394f0f1a0d80ad060381e68464194cb3d0398acd940c85d38
statement_cell: 2
requirement_cells: [3]
subject_anchor: org employment legal entity
---

# ZAI:FEAT-028

<!-- canonical-row:start -->
```text
| FEAT-028 | Org Employment & Legal Entity — separating "who works here" from "who may log in here": a new `Employment` HR assignment record (title, type, lifecycle status) that `resolveViewer` never reads, with system access shown as a column derived FROM `Membership` rather than the reverse; and moving `LegalEntity` from `Portfolio` to `Tenant` so a Business can only reference a legal entity within its own isolation boundary, splitting its VAT branch registrations into `TaxRegistrationBranch` so an operating site (a warehouse, say) is never asked to carry a tax identity it does not have (ADR-078, 2026-09-12) | FR-193, FR-194 | implemented |
```
<!-- canonical-row:end -->
