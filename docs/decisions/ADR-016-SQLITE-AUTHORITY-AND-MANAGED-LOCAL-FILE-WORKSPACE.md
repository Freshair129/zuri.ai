---
version: "0.1.0b"
created_at: "2026-08-14T00:39:27+07:00,ATHER"
last_update: "2026-08-14T01:15:39+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "architecture-decision"
  domain: "local-first-storage"
  scope: "Zuri V2"
---

# ADR-016 — SQLite authority and managed local file workspace

**Status:** Accepted (beta) — approved 2026-08-14
**Risk:** HIGH
**Relates to:** FR-013, FR-037, FR-045, NFR-009, BR-010, SEC-007, SDD-023, ZV2-CR-001

## Context

Zuri V2 already uses SQLite as its local transactional store, while FR-037 stores
only Project file references (`url` or `blobRef`). A separate filesystem mock was
created to make Business, Product, Project and Workstream relationships visible.
That mock is useful for explaining shape, but JSON files cannot safely become a
second writable relationship database.

Users still need two local-first capabilities:

1. see and edit real working files in normal folders on their machine; and
2. browse the same files through Business- and Project-scoped File Manager views.

The design must prevent SQLite and filesystem metadata from becoming competing
sources of truth, while preserving FR-037 compatibility during migration.

## Decision

### D1 — SQLite is the authority

SQLite is the only transactional authority for file identity, ownership, links,
status, audit, versions and relation queries. DuckDB may be used for analytics, but
never for CRUD authority. JSON cache files are disposable projections.

### D2 — Filesystem stores content and rebuildable cache

The filesystem contains real user files plus managed cache/temp data. A Business
may have one device-local mounted root:

```text
<business-root>/
  README.md
  Business Files/
  Projects/
    <project-code>/
      Documents/
      Data/
      Deliverables/
      Working/
  Inbox/
  .zuri/
    workspace.json
    cache/
      business-overview/
      active-workstreams/
      thumbnails/
      previews/
    temp/
    audit/
```

`Products` and `Workstreams` are not editable folder hierarchies. They remain
relations in SQLite and appear in the UI through IDs/links. This avoids forcing a
many-to-many graph into one physical tree.

### D3 — Relative path is portable; absolute root is device-local

File identity is an internal UUID plus human code. SQLite stores a normalized path
relative to the selected mount. The absolute mount path is device-local metadata,
is excluded or remapped during portable restore, and is never a relational key.

### D4 — One asset, multiple views, no copied file

`FileAsset` owns content metadata and one primary Business/Project scope.
`FileLink` supplies secondary typed links (initially Business, Project and
WorkItem; additional entity types require a separately approved contract). Business
File Manager aggregates Business-owned and Project-owned assets through SQLite;
it does not duplicate content into a Business folder.

### D5 — Cache is explicitly non-authoritative

Only expensive derived artifacts are cached: Business overview DTOs, active
Workstream summaries, thumbnails, previews/OCR and search indexes. Every cache item
records `sourceRevision` and `generatedAt`. Deleting `.zuri/cache` must not lose
domain data and a rebuild must reproduce the same canonical result.

### D6 — File mutations are staged and reconciled

Managed ingest stages content in `.zuri/temp`, validates and hashes it, records the
SQLite mutation/audit, then atomically promotes content to its final relative path.
Failures leave a recoverable reconcile state. An external move/delete marks an
asset `MISSING`; Zuri never silently rebinds a file by filename alone. A hash match
may be proposed, but an ambiguous relink requires confirmation.

### D7 — Local OS access is a capability, not a web-route assumption

Normal browser access streams/downloads content through an authorized API. “Reveal
in Explorer” is available only through a local runtime bridge that verifies local
session, Business authorization, CSRF/origin and path containment. Hosted mode must
disable the capability. A remote request may never launch a process on the server.

### D8 — Paths fail closed

The boundary rejects absolute paths, `..` traversal, invalid normalization and
symlink/junction/reparse-point escape beyond the mounted root. Access is checked
against viewer-visible Business and Project ownership before filesystem IO.

### D9 — FR-037 migrates; it is not erased

Existing `ProjectFile` rows and `/api/projects/{id}/files` remain readable during
the first delivery phase. Rows migrate to `FileAsset` plus a Project link without
changing UUID semantics or losing audit history. Removal of the old model/adapter
requires parity, rollback and backup/restore gates in ZV2-CR-001.

### D10 — Backup separates metadata from content

The normal snapshot includes file metadata, links, hashes and a content manifest.
Binary inclusion is an explicit export option, not an accidental database dump.
Restore previews missing content and mount remapping before confirmation.

### D11 — Add a governed change-control slot

ADR-004 is amended to allow `docs/changes/ZV2-CR-*.md` for a bounded cross-cutting
change that has migration, compatibility or retirement work. V1 evidence keeps the
`V1-CR-*` namespace; V2 change records use `ZV2-CR-*` and never replace FR/ADR ids.

## Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| JSON filesystem as relationship authority | Rejected | creates two writable truths and weak transactional/isolation semantics |
| SQLite stores binaries only | Rejected as default | hides working files from normal local workflows and inflates backup/locking cost |
| DuckDB as operational database | Rejected | optimized for analytics, not authoritative CRUD/audit workflow |
| Mirror every domain entity as folders | Rejected | a tree cannot faithfully express Product/Project/Workstream many-to-many links |
| SQLite authority + managed files + disposable cache | Accepted | preserves relational correctness and normal local file access |

## Consequences

- New schema and service ports require a Postgres-equivalent representation even
  though the first adapter is SQLite/local filesystem.
- File Manager becomes a query projection rather than a folder-tree renderer.
- A native bridge is a separate capability seam and security surface.
- The existing external JSON mock is evidence/scaffold only; its relational
  placeholders retire according to ZV2-CR-001, never by an untracked cleanup.

## Approval and exit gate

This ADR is accepted only when the owner approves ADR-016, FR-045 and ZV2-CR-001
together. Implementation may start only after document graph/preflight pass.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner approved original scope; W0-W3 foundation verified | — | ATHER |
