---
feature: FR-045
module: project-manager
source: v2-native
version: "0.3.0b"
created_at: "2026-08-14T00:39:27+07:00,ATHER"
last_update: "2026-08-14T01:35:58+07:00,ATHER"
status: "beta"
---

# FR-045 — Managed local file workspace

**Risk:** HIGH
**Decision:** ADR-016
**Change envelope:** ZV2-CR-001
**Extends:** FR-037 by replacing its metadata-only limitation after compatibility gates

## Problem

Project Files currently records references but cannot manage actual local content.
A pure folder hierarchy cannot express the Business/Product/Project/Workstream graph
without duplicating or misplacing entities. Users need real folders for daily work,
while Zuri needs authoritative relations, isolation, audit and aggregate File Manager
views.

## Delivery status

Owner approved the FR-045 scope on 2026-08-14. W0-W9 are complete. Delivery now
includes additive SQLite/Postgres metadata, contained filesystem IO, Business and
Project File Manager surfaces, migration compatibility, reconcile/relink, disposable
cache, local-only reveal and portable backup/remount. The external 39-file mock is
retained unchanged as reference; no destructive cutover was needed.

## User stories

| ID | Story |
|---|---|
| US-045-01 | As a Business user, I see Business-owned and child Project files in one Business File Manager without duplicated content. |
| US-045-02 | As a Project worker, I see actual files in a predictable Project folder and can access them through Project Files. |
| US-045-03 | As an authorized owner/member, I add a Business- or Project-owned file and Zuri records identity, relative path, hash/version and audit. |
| US-045-04 | As a user who moved/deleted a file outside Zuri, I see `MISSING` and an explicit relink flow rather than a silent wrong match. |
| US-045-05 | As an operator, I can delete and rebuild `.zuri/cache` without losing files or domain relations. |
| US-045-06 | As a local-first user, I can remount the same workspace at another absolute root while stable IDs and relative paths remain valid. |
| US-045-07 | As a hosted user, I cannot trigger server OS file reveal; as an authorized local user, I can use the explicitly enabled local capability. |
| US-045-08 | As an existing FR-037 user, my ProjectFile references migrate without lost rows, ids, links or audit history. |

## Functional contract

### Ownership and linking

- Every FileAsset is tenant- and Business-authorized.
- Primary ownership is Business or Project; WorkItem and future relation views use
  validated FileLink records.
- Business aggregation includes the selected Business and its owned Projects only.
- A file is never copied merely because it appears in multiple UI views.

### Storage kinds

`LOCAL_FILE`, `MANAGED_BLOB` and `EXTERNAL_URL` are explicit. A local file requires
a mount plus normalized relative path. An external URL never grants filesystem IO.

### State contract

| State | UI/API behavior |
|---|---|
| `ACTIVE` | metadata and content are available |
| `MISSING` | metadata remains; content operation explains missing path and offers authorized relink |
| `QUARANTINED` | content is withheld pending validation/reconcile |
| cache `STALE` | canonical SQLite query is used or cache is rebuilt; stale data is not presented as current |
| local bridge unavailable | reveal action is disabled with capability explanation; content download remains separate |

## Implemented data design (SDD-023)

```text
LocalWorkspaceMount
  id, tenantId, businessId, deviceKey, rootPath, status, lastScanAt

FileAsset
  id, code, tenantId, businessId, projectId?, workItemId?
  storageKind, relativePath?, externalUrl?, blobRef?
  name, mime, size, sha256?, status, version, timestamps

FileLink
  id, fileId, entityType, entityId, relationType, timestamps
```

Polymorphic FileLink targets require service-level existence, tenant and Business
validation. New entity types are not accepted by free-form input.

## Implemented API surface

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/files` | authorized asset query/managed ingest by Business or Project scope |
| GET | `/api/business/files?businessId=` | aggregate Business + owned Project projection |
| GET/POST | `/api/projects/{id}/files` | compatibility and Project asset surface |
| GET | `/api/files/{id}/content` | authorized content stream/download |
| POST | `/api/files/{id}/relink` | confirm a missing asset's new contained relative path |
| POST | `/api/files/{id}/reveal` | local capability only; denied in hosted mode |
| POST | `/api/files/reconcile` | dry-run/confirm missing/untracked reconciliation |
| POST | `/api/files/cache/rebuild` | rebuild disposable derived projections |

All endpoints use the resolved viewer boundary. Local content and reveal additionally
require an active Business/device mount; reveal remains disabled unless the local
bridge capability is explicitly enabled on a same-origin loopback runtime.

## Acceptance criteria

- [x] AC-045-01 SQLite is the only authority for file identity, links, versions, status and audit.
- [x] AC-045-02 Business File Manager returns no asset outside viewer-visible Business IDs and does not duplicate content.
- [x] AC-045-03 Project Files returns only the opened Project's assets and preserves the legacy FR-037 response during compatibility.
- [x] AC-045-04 Managed ingest uses stage → validate/hash → record/audit → atomic promote, with deterministic recovery after failure.
- [x] AC-045-05 Paths reject absolute input, traversal and symlink/junction/reparse escape outside the mounted root.
- [x] AC-045-06 External move/delete becomes `MISSING`; relink is explicit and never guesses among candidates.
- [x] AC-045-07 Removing `.zuri/cache` and rebuilding yields a canonical DTO equal to a direct SQLite query.
- [x] AC-045-08 Remounting at another absolute root preserves asset IDs, links and relative paths.
- [x] AC-045-09 Hosted mode cannot invoke OS process/file reveal; local mode requires explicit capability and authorization.
- [x] AC-045-10 Backup preview reports mount/content gaps; binary export is explicit; restore never silently overwrites.
- [x] AC-045-11 Every existing ProjectFile migrates or appears in an explicit rejected/conflict report; no silent drop.
- [x] AC-045-12 Postgres metadata schema preserves SQLite semantics; device-local root remains outside shared relational identity.

## Test design

| Level | Required proof |
|---|---|
| Unit | path normalization/containment; reparse escape; storage-kind validation; ownership/link rules; cache revision; missing/relink decision |
| Integration | atomic ingest rollback; Business/Project isolation; ProjectFile migration parity; cache rebuild equivalence; reconcile; backup/remount |
| Contract | old Project Files fixtures; new endpoint Zod request/response; SQLite-direct vs cached DTO equivalence |
| Security | traversal, absolute path, cross-Business, unauthorized reveal, hosted reveal, malicious link target |
| E2E | Business aggregation, Project Files, add/open/download capability states, missing/relink, narrow/keyboard states |
| Release | full Vitest, Playwright slice, build, Postgres schema generation, docs graph/check/preflight |

## Exit gate

All AC-045 checks must pass; ZV2-CR-001 migration and rollback evidence must be
reviewed; no unknown files may be deleted; generated traceability must link FR-045,
NFR-009, BR-010, SEC-007 and SDD-023 to implementation and tests. Until then the
feature remains candidate and FR-037 stays operational.

## Out of scope

- cloud sync and collaborative conflict resolution;
- full-content version history;
- automatic Product/Workstream folder mirroring;
- unapproved native desktop packaging;
- deletion of any external mock or user content in this documentation change.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Initial stories, TDD, AC, security and compatibility boundary | — | ATHER |
| 0.2.0b | 2026-08-14 | beta | Added verified W0-W3 delivery status without promoting full AC | — | ATHER |
| 0.3.0b | 2026-08-14 | beta | Completed W4-W9, all AC, compatibility, backup/remount and retained-reference decision | fb5906a | ATHER |
