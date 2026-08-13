---
version: "0.1.0b"
created_at: "2026-08-14T01:35:58+07:00,ATHER"
last_update: "2026-08-14T01:35:58+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "change-request"
  domain: "local-first-storage"
  scope: "ZV2-CR-001-W9"
---

# ZV2-CR-001 W9 — External mock retention decision

## Decision

`RETAIN_REFERENCE`. The complete 39-file, 15,077-byte tree rooted at
`D:\zuri-workspace\client\client-01\organization\etohcolsgroup` remains unchanged.
No archive, delete, move, rename or content rewrite is authorized or performed.

## Rationale

The tree remains useful as a human-readable hierarchy reference while SQLite is the
only runtime relationship authority. Keeping it avoids irreversible loss and does
not create a second database because FR-045 never reads it as canonical state.

The exact pre-decision path/size/SHA-256 evidence remains in
`artifacts/ZV2-CR-001-w0-filesystem-inventory.json`. `mutationAuthorized` remains
`false`; `w9Disposition` records the non-destructive outcome.

## Exit

W9 is closed without invoking destructive gate G2. Any future archive or deletion
requires a new explicit owner approval and a fresh hash comparison.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Retain all external mock files as reference; no mutation | pending | ATHER |
