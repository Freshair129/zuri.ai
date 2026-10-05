---
id: FEAT-030
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 6f3317872d6c62aa624f9e022d55d9db5749b4531dd9fd24a65fa5e423be76a4
statement_cell: 2
requirement_cells: [3]
subject_anchor: audit access evidence
---

# ZAI:FEAT-030

<!-- canonical-row:start -->
```text
| FEAT-030 | Audit Access Evidence — closing the read-side gap ADR-077's lifecycle assumed was already open: `AuditEvent` gains seven nullable columns (`tenantId`, `businessId`, `reason`, `beforeJson`, `afterJson`, `requestId`, `sessionId`) so scope and the change made are queryable rather than living only inside `payloadJson` for whichever writer happened to include them, and identity gains `listAccessHistory` (a Business/Tenant owner, oneself, or the operator reads the event stream for their own scope, 404-shaped identically for unowned and nonexistent) and `listBusinessAccess` (the current grant roster with provenance) — the access review a reason on every FR-191 transition is only worth writing if someone can read it back (ADR-080, 2026-09-12) | FR-198, FR-199 | implemented |
```
<!-- canonical-row:end -->
