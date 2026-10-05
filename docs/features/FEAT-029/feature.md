---
id: FEAT-029
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 2c9b34a208171aa11c148bd2361cfe13ce076a19fb3c3d308f12786ed7d0aade
statement_cell: 2
requirement_cells: [3]
subject_anchor: access invite segregation of duties and operator lifecycle
---

# ZAI:FEAT-029

<!-- canonical-row:start -->
```text
| FEAT-029 | Access Invite, Segregation of Duties and Operator Lifecycle — a Business/Tenant-level invitation that becomes a real `Membership` grant on acceptance, bound to the accepting session rather than the invited address (generalising FR-067's Workspace-only `WorkspaceInvite`); segregation of duties as a write-time role-conflict refusal (with a Tenant-owner override) and a transaction-time self-verification refusal an OWNER does not bypass; and an operator grant that expires, that a standing operator can issue as a fresh row on renewal, and whose use reading the audit stream or a backup is itself recorded (ADR-079, 2026-09-12) | FR-195, FR-196, FR-197, FR-200 | implemented |
```
<!-- canonical-row:end -->
