---
version: "0.1.0b"
created_at: "2026-08-14T00:39:27+07:00,ATHER"
last_update: "2026-08-14T00:39:27+07:00,ATHER"
status: "candidate"
attributes:
  doc_type: "change-inventory"
  domain: "local-first-storage"
  scope: "ZV2-CR-001 W0"
---

# ZV2-CR-001 W0 — Contract and migration inventory

## Gate result

W0 freezes the input to W1/W2/W3. It authorizes additive work only and authorizes
no migration commit, legacy removal or external filesystem mutation.

## Legacy ProjectFile contract

| Item | Current truth |
|---|---|
| SQLite model | `ProjectFile` with UUID id, unique code, Project FK, optional WorkItem FK, metadata/reference fields and version |
| Active routes | GET/POST `/api/projects/[id]/files`; DELETE `/api/projects/[id]/files/[fileId]` |
| Input rule | non-empty name/mime, non-negative integer size, and at least one `url` or `blobRef` |
| Scope rule | Project must exist; optional WorkItem must belong to that Project |
| Audit | create/delete append `PROJECT_FILE` audit events |
| Compatibility fixture | `tests/fixtures/fr045-project-file-contract.js` |
| Contract proof | `tests/unit/fr045-w0-contract.test.js` |

## Current local database inventory

Read-only query against `prisma/dev.db` on 2026-08-14:

```json
{"model":"ProjectFile","count":0,"rowsSha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e8f6f7d8e11ba873c2f11161202b945"}
```

The empty developer database does not waive migration behavior. W1/W4 must use
non-empty fixtures and prove accepted/conflict/rejected counts.

## External mock filesystem inventory

| Field | Value |
|---|---|
| Root | `D:\zuri-workspace\client\client-01\organization\etohcolsgroup` |
| Files | 39 |
| Bytes | 15,077 |
| JSON placeholders | 26 |
| README scaffolds | 13 |
| Machine-readable inventory | `docs/changes/artifacts/ZV2-CR-001-w0-filesystem-inventory.json` |
| Mutation authorized | **No** |

Classification is intentionally conservative: JSON is a generated-placeholder
candidate; README is retained for review. Hash drift after this inventory blocks
any later delete/archive proposal until the inventory is regenerated and reviewed.

## W1/W2/W3 ownership seams

| Lane | Exclusive write scope | Read-only shared inputs | Must not touch |
|---|---|---|---|
| W1 | Prisma SQLite/Postgres schema, additive migration artifact, schema-focused tests/report | W0 fixtures, ADR-016, FR-045 | service/UI/filesystem port |
| W2 | path-security/filesystem-port modules and focused unit tests/report | W0 inventory, SEC-007 | Prisma schema, read-model/UI |
| W3 | pure File Manager DTO/read-model module and focused tests/report | W0 fixtures, FR-045 state contract | Prisma schema, filesystem IO, routes/UI |

Shared contract/schema integration after these lanes remains controller-owned.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | W0 contract, data and filesystem inventory | — | ATHER |
