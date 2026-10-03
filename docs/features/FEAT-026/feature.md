---
id: FEAT-026
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 745ccb22ae055ead8a0610c940077695646a9330bf5e20ab921eea7a5e3fadfb
statement_cell: 2
requirement_cells: [3]
subject_anchor: smartgift catalog convergence
---

# ZAI:FEAT-026

<!-- canonical-row:start -->
```text
| FEAT-026 | SmartGift Catalog Convergence — converging the three independent writers of SmartGift product-catalog data into GenesisBlockDB (SmartGift's own 5-stage ETL direct write, `apps/edge` Genesis RAG v4's direct sibling-checkout read/serve, and the unactivated 17-stage pipeline) onto one entry path: a structured-record source adapter before Stage 1, SmartGift recast as a source producer keyed by its own SHA-256 registry, Zero-PII enforced at Stage 5 classify, a structured parser profile and `ontology_v2` contract for catalog facts, and edge reading the published generation through MSP with v4 as a time-boxed transitional fallback (ADR-075, approved 2026-09-11; Phase 1 authorized) | FR-187, FR-188, FR-189 | approved |
```
<!-- canonical-row:end -->
