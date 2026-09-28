---
id: FEAT-032
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 7793a2e84ca9d5abda3efc8d60b383de296346a839c0a50d908170ad2b258285
statement_cell: 2
requirement_cells: [3]
subject_anchor: catalogue intake that resolves before it creates
---

# ZAI:FEAT-032

<!-- canonical-row:start -->
```text
| FEAT-032 | Catalogue intake that resolves before it creates — one envelope that JSON, a Business-specific Excel workbook and a LINE `#sku` command all convert into; a planner that looks up every item by its barcodes, partner codes and SKU code (following merges) before it plans a create, matches without overwriting, and applies ADR-083's guards across the catalogue and the batch; a persisted preview whose plan hash a commit must match; an all-or-nothing commit through the existing catalogue writers; the Import tab; and LINE previews that only a verified staff sender with Inventory write authority can confirm (ADR-084, `DOM-INVENTORY`) | FR-208, FR-209, FR-210 | implemented |
```
<!-- canonical-row:end -->
