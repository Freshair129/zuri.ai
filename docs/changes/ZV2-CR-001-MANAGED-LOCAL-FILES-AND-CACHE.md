---
version: "0.2.0b"
created_at: "2026-08-14T00:39:27+07:00,ATHER"
last_update: "2026-08-14T01:35:58+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "change-request"
  domain: "local-first-storage"
  scope: "Zuri V2"
---

# ZV2-CR-001 — Managed local files and cache

**Decision dependency:** ADR-016
**Requirement:** FR-045
**Risk:** HIGH
**State:** Implemented additively; legacy adapter retained; external mock retained unchanged

## 1. Change request

Replace the current “ProjectFile is only a URL/blob reference” boundary with a
managed local file workspace whose relational authority remains SQLite. Preserve
the existing Project Files contract while adding Business aggregation, real file
content, reconcile, cache rebuild and local-only reveal capability.

## 2. Systems and contracts touched

| Area | Current | Proposed | Compatibility obligation |
|---|---|---|---|
| SQLite schema | `ProjectFile` reference | `FileAsset`, `FileLink`, `LocalWorkspaceMount` | migrate rows; preserve ids/audit |
| Project Files API/UI | Project metadata references | managed assets plus compatibility response | existing route remains in phase 1 |
| Business UI | no aggregate File Manager | Business + child Project asset projection | no content copying |
| Filesystem | external mock hierarchy | real working files + `.zuri` managed area | relative path portability |
| Backup | JSON domain snapshot | metadata + content manifest; optional binaries | preview mount/content gaps |
| Local runtime | no OS bridge | capability-gated reveal/open | hosted mode disabled |
| Cache | no governed contract | disposable revisioned projections | deletion/rebuild parity |
| Postgres readiness | `ProjectFile` parity | new metadata models parity | filesystem root remains device-local |

## 3. Deprecation and deletion inventory

Nothing is deleted in the documentation slice. The following inventory becomes
eligible only after migration proof and owner approval of the cutover gate.

| Candidate | Action | Earliest gate | Rollback |
|---|---|---|---|
| `ProjectFile` Prisma model | retain during compatibility window | future separately approved removal after usage evidence | restore model + migrated snapshot |
| old ProjectFile service internals | replace behind compatibility adapter | new service unit/integration parity | switch adapter back |
| relational mock JSON under `D:\zuri-workspace\client\client-01\organization\etohcolsgroup` | **retain all 39 files as reference**; no archive/delete | W9 retention decision | W0 hash inventory remains the provenance record |
| duplicate Product/Workstream physical folders | do not create as canonical structure | ADR approval | n/a |
| current `/api/projects/{id}/files` route | **do not delete** in initial change | replacement API parity and consumer inventory | compatibility handler |
| human-authored working files | **never delete automatically** | out of scope | n/a |

Generated placeholder removal must produce an exact path, SHA-256 and disposition
manifest before any filesystem mutation. Unknown files are retained and reported.

## 4. Migration sequence

1. Add new schema and ports without removing ProjectFile.
2. Backfill ProjectFile → FileAsset + Project FileLink in a dry-run/commit flow.
3. Serve the legacy route through the new read model and compare fixtures.
4. Enable managed ingest, content read and Business aggregation.
5. Add reconcile/cache/local bridge behind explicit capability flags.
6. Validate backup/restore and remount on a second root.
7. Classify external mock files and request deletion approval separately.
8. Retire ProjectFile only after the compatibility window and rollback rehearsal.

## 5. Rollback

- Keep the pre-migration SQLite snapshot and file hash manifest.
- New schema is additive until the final retirement gate.
- Disable new capability flags and switch the legacy route adapter back.
- Never roll back by deleting physical user content.
- Restore cache by rebuilding; cache is not part of rollback authority.

## 6. Approval gates

- [x] ADR-016 approved.
- [x] FR-045 stories, AC and security rules approved.
- [x] Schema/API changes reviewed against Postgres parity.
- [x] Migration dry-run/conflict behavior and zero-row W0 inventory reviewed.
- [x] W9 exact hash inventory reviewed; disposition is retain-reference, so no deletion is authorized.
- [x] Snapshot preview/confirm rollback path passes; legacy removal remains out of scope.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Original scope approved; additive W0-W3 complete; destructive gates remain closed | — | ATHER |
| 0.2.0b | 2026-08-14 | beta | W4-W9 implemented; legacy and all external mock files retained; no destructive cutover | fb5906a | ATHER |
