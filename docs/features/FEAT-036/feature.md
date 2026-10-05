---
id: FEAT-036
namespace: ZAI
family: FEAT
version: 1
status: source-preserved
source_revision: a34ceaf79c112e02b1bcfdbf0a84122d835b002e
source_path: docs/FEATURES.md
source_row_eol: LF
source_row_sha256: 1d69dabed5ea700d673ef26d21f6be9e68cf4c15e062e58e0fa359d9e689f990
statement_cell: 2
requirement_cells: [3]
subject_anchor: connect line oa yourself
---

# ZAI:FEAT-036

<!-- canonical-row:start -->
```text
| FEAT-036 | Connect LINE OA yourself — a Business owner connects a LINE Official Account from the browser: after a TOTP step-up they enter the Channel ID and Channel secret once, the server proves them with LINE, claims the bot for this installation, stores the secret write-only in the Integration vault (Supabase Vault, or an encrypted store on self-host) and mints short-lived tokens itself, sets and tests the webhook through LINE's API and decides on its own when the old transport has gone quiet — with no operator and no host file (ADR-089, `DOM-INTEGRATION`, `DOM-IDENTITY`, `DOM-LINE-OA-STUDIO`) | FR-223, FR-224, FR-225, FR-226, FR-227, FR-228 | building |
```
<!-- canonical-row:end -->
