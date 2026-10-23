---
id: FEAT-045
namespace: ZAI
family: FEAT
version: 1
status: reviewed-migration
migration_base_revision: fa10e309ac1e2833ad518f5432e921a5822d5d4d
migration_document: docs/change-requests/integration/LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 655c2e04617a0933df33d21a7ea43259862f34e9b35f9500e06c0b606e987a96
statement_cell: 2
requirement_cells: [3]
subject_anchor: line oa on api keys only
---

# ZAI:FEAT-045

<!-- canonical-row:start -->
```text
| FEAT-045 | LINE OA on API keys only — the existing public-provider and PRP paths require the Business-owned, browser-provisioned key; the Studio's EDGE execution mode, its edge conversation-job claim surface and the LOCAL_ONLY deterministic-answer branch are retired. For those keyed provider paths, the Business owner enters the model provider API key in the browser, write-only, through the same credential vault that already holds the LINE channel secret (ADR-100, amending ADR-061 D2/D3 for LINE OA; ADR-110 D1 retires Zuri-owned pairing and Edge extraction surfaces, while D3 preserves existing records and schema). A separate, default-off, explicitly allowlisted main-dev Ollama test profile is scoped by FR-079/FR-080 and does not change the public-provider or PRP key flows or production provider selection. | FR-265, FR-266, FR-267 | building |
```
<!-- canonical-row:end -->
