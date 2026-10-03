---
id: FEAT-040
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: d743088a66e681e0fee973d5ca62d62d45fe06a7d193e1a0422ff96da5a417ca
statement_cell: 2
requirement_cells: [3]
subject_anchor: conversation sessions and model residency
---

# ZAI:FEAT-040

<!-- canonical-row:start -->
```text
| FEAT-040 | Conversation sessions and model residency — a long LINE conversation reads as separate sittings: each message and event belongs to a session that closes after 30 quiet minutes (10 to 120 per account), carried on the LINE job and trace and shown as a divider in the inbox, and the local model stays loaded only during each account's business hours, with a fixed reply outside them (ADR-094, `DOM-CRM`, `DOM-LINE-OA-STUDIO`) | FR-243, FR-244 | declared |
```
<!-- canonical-row:end -->
