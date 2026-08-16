# Appendix A — API Specification

| Field | Value |
|-------|-------|
| **Version** | 1.4.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-14 |

ทุก endpoint เป็น local route handler โดย protected routes ใช้ trusted request-session
seam; local demo capability เปิดได้เฉพาะ non-production เท่านั้น Error shape คือ
`{ error, issues? }` — 400 validation/domain, 401 auth, 404 not found,
503 session unavailable และ 500 unexpected failure

## Scope

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/scope` | รายการ portfolio/tenant/business/workspace/project ทั้งหมด |
| POST | `/api/scope` | สร้าง scope entity: `{entity: portfolio\|tenant\|business\|workspace\|legalEntity\|branch, data}` |
| GET | `/api/viewer` | viewer gate สำหรับ Home: role + ธุรกิจ/โดเมนที่เห็นได้จาก `resolveViewer()` |
| GET | `/api/profile` | resolved local account, linked identity state, and local session boundary |
| PATCH/DELETE | `/api/workspaces/[id]` | แก้ไข / archive workspace |

| GET | `/api/business/strategy?businessId=` | Business-scoped Roadmap, two/three ordered goal horizons, and goal progress read model (FR-041) |
| GET | `/api/people?businessId=` | viewer-filtered Business People Directory over Person/Membership (FR-042) |

## Business Strategy mutation (FR-059)

OWNER-only writes. `src/modules/business` stays a read slice (SDD-032) — every
handler here delegates to `src/modules/project-manager/application/business-strategy-mutation-service.js`,
which records one `AuditEvent` per mutation and returns the same serialized
Roadmap/Goal shape the FR-041 GET already produces. A `BusinessRoadmap` always
has 2–3 `horizons`; a Goal↔Project link is rejected when the Project's owning
Business differs from the Goal's (FR-043 isolation, extended to writes).

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/business/roadmaps` | `{businessId, title, description?, status?, startAt?, targetAt?, horizons: [{key, label, position, description?, targetAt?}, ...]}` (2–3 entries) | serialized Roadmap |
| PATCH | `/api/business/roadmaps/[id]` | partial of the same fields; `horizons` present ⇒ reconciled by `key` (2–3 entries); removing a key that still has goals attached is refused, not silently orphaned | serialized Roadmap |
| POST | `/api/business/goals` | `{businessId, roadmapId?, horizonId, title, description?, status?, priority?, progress?, startAt?, targetAt?}` — `horizonId` is required | serialized Goal |
| PATCH | `/api/business/goals/[id]` | partial of the same fields; `horizonId`/`roadmapId` may move a Goal but never explicitly clear it | serialized Goal |
| POST | `/api/business/goals/[id]/projects` | `{projectId}` | serialized Goal (with the link); re-linking an already-linked Project is `409` |
| DELETE | `/api/business/goals/[id]/projects/[projectId]` | — | serialized Goal (without the link) |

Isolation failures (`Roadmap does not belong to Business`, `Horizon does not
belong to Business`, `Project does not belong to Business`, a mismatched
`horizonId`/`roadmapId` pair, or a duplicate horizon `key`/`position`) return
`400`. All six mutations also require the target Business to be in the
viewer's `visibleBusinessIds` (not just `role === 'OWNER'`, which is a global
grant) — see FR-059-business-strategy-mutation.md §1.

## Entry and Business Routing (FR-044 and FR-046 implemented beta)

The entry slice selects no real login provider. `/` and `/login` remain UI stubs; in
non-production the Login form posts to an explicit local demo-session capability.

| Interface | Contract |
|---|---|
| `GET /api/viewer` | Compatibility endpoint resolved from the same trusted request session; not used by Business Routing. |
| `GET /api/scope` | Internal broad scope-management compatibility interface; entry surfaces do not request it. Production hardening remains separately gated. |
| `BusinessShell guard` | Not an API route: `/overview` and Business domain routes require an authorized `activeBusinessId`; missing selection resolves to `/businesses`, and missing viewer resolves to `/login`. |

No password, OIDC, LINE login, token, session, or new persisted auth contract is part
of FR-044. Those belong to the later identity implementation and must not be implied
by the demo Login button.

### Production-shaped boundary (FR-046 / ADR-017)

| Method | Path | Success | Failure |
|---|---|---|---|
| GET | `/api/entry` | `200 { viewer, businesses[] }`; each Business embeds only its required Tenant/Portfolio ancestry | `401 { error: "AUTH_REQUIRED" }`; `503 { error: "SESSION_UNAVAILABLE" }` |
| POST | `/api/session/demo` | non-production only: sets an HttpOnly SameSite=Lax local demo cookie and redirects `303 /businesses` | `404 { error: "NOT_FOUND" }` when disabled or in production |

Contract constraints:

- identity is resolved by a trusted server `SessionPort`; client principal, role,
  platform grant, visible IDs and domains are never inputs;
- `/businesses` uses this response alone and stops requesting `/api/viewer` plus
  `/api/scope`;
- authenticated empty scope is `200` with `businesses: []`, not `401`;
- response excludes Membership, Workspace, Project, Branch, LegalEntity, hidden
  Business and unrelated ancestry rows;
- `/api/viewer` remains compatibility-only and must use the same trusted request
  session; `/api/scope` remains outside the pre-shell routing contract;
- no concrete login provider or session persistence model is selected by FR-046.

## Project core

| Method | Path | ทำอะไร |
|---|---|---|
| GET/POST | `/api/projects` | list (filter: workspaceId, businessId, tenantId, status, q) / create; create derives `businessId` from the target Space and rejects owner/Space mismatch |
| GET/PATCH/DELETE | `/api/projects/[id]` | detail (includes direct Business owner and Space context) / update with owner/Space invariant / archive |
| GET/POST/PATCH/DELETE | `/api/projects/[id]/team` | team in business scope / add member / change role / remove business-scoped member |
| GET/POST | `/api/projects/[id]/files` | list/add ProjectFile metadata reference; optional WorkItem must belong to Project |
| DELETE | `/api/projects/[id]/files/[fileId]` | delete ProjectFile reference within its owning Project |
| GET | `/api/projects/[id]/dependencies` | project-local Dependency Map graph; includes only edges whose endpoints both belong to the opened Project |
| GET/PATCH | `/api/platform/users` | OWNER-only list/update of Membership role and domain allow-list |
| GET/POST | `/api/workstreams` | list (filter: projectId, executionMode) / create |
| PATCH/DELETE | `/api/workstreams/[id]` | update / archive |
| GET/POST | `/api/work` | list work items (filter: projectId, workstreamId, executionMode, subtype, status, q) / create |
| PATCH/DELETE | `/api/work/[id]` | update (metrics merge) / soft delete |
| POST, PATCH | `/api/containers`, `/api/containers/[id]` | create / update container |
| GET/POST, PATCH | `/api/milestones`, `/api/milestones/[id]` | list milestones+gates / create / update |
| POST, PATCH | `/api/gates`, `/api/gates/[id]` | create / update gate (evidence merge) |
| GET/POST, DELETE | `/api/dependencies`, `/api/dependencies/[id]` | list resolved edges (filter projectId) / create (cycle-checked) / delete |
| GET/POST, PATCH | `/api/repositories`, `/api/repositories/[id]` | list / register / update repo metadata |
| POST, DELETE | `/api/repositories/link`, `/api/repositories/link/[id]` | link / unlink project↔repo |
| GET | `/api/resolve?type=&code=` | human code → internal id |

## Progress / Import / Backup / Audit

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/progress/workstream/[id]` | strategy progress + evidence + warnings |
| GET | `/api/progress/project/[id]` | weighted roll-up + per-workstream results |
| GET | `/api/progress/portfolio` | portfolio/group progress reporting API; not the operational `/overview` landing (FR-041 / ADR-013) |
| POST | `/api/import/dry-run` | `{plan, workspaceId?}` → valid/errors + preview (insert/update/conflict) — read-only |
| POST | `/api/import/commit` | เหมือน dry-run แล้ว commit ใน transaction เดียว + audit |
| GET | `/api/backup/export` | full snapshot JSON |
| POST | `/api/backup/import` | `{snapshot}` = preview; `{snapshot, confirm:true}` = restore |
| GET | `/api/audit` | events (filter: entityType, entityId, limit) |

## Managed local files (FR-045 — implemented beta)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/files` | viewer-authorized FileAsset query / managed ingest by Business or Project scope |
| GET | `/api/business/files?businessId=` | selected Business plus its owned Projects, one row per asset |
| GET/POST | `/api/projects/[id]/files` | existing compatibility contract backed by the new read/write service after migration |
| GET | `/api/files/[id]/content` | authorized content stream or download; no arbitrary filesystem path input |
| POST | `/api/files/[id]/relink` | explicitly confirm a contained new relative path for a missing asset |
| POST | `/api/files/[id]/reveal` | local-runtime capability only; hosted mode returns capability-disabled |
| POST | `/api/files/reconcile` | dry-run by default; confirm applies audited missing/untracked decisions |
| POST | `/api/files/cache/rebuild` | rebuild disposable projections from SQLite/content metadata |
| GET/POST | `/api/files/mounts` | list or upsert a device-local Business mount |
| POST | `/api/files/migrate` | owner/dev dry-run or confirmed ProjectFile migration |
| DELETE | `/api/files/[id]` | soft-delete managed metadata; physical content is not silently deleted |

Storage-kind requests are Zod-validated and scope is resolved server-side. No
content endpoint accepts an absolute client-supplied path. The existing Project
Files endpoints remain available through the compatibility boundary.

## Intake surfaces (FR-017..FR-020 — shipped)

| Method | Path | ทำอะไร |
|---|---|---|
| POST | `/api/import/xlsx` | อัปโหลด workbook → envelope → dry-run รายแถว (FR-018) |
| GET | `/api/import/template` | generate Excel template จาก Zod schema (FR-018) |
| GET | `/api/docs` | OpenAPI 3 spec generated from the live Zod schemas (FR-019) |
| GET | `/api/resolve?system=&value=` | external ID → internal id via ExternalRef; 404 unmapped, 410 dangling (FR-019) |
| POST | `/api/agent/line-webhook` | Local-disabled compatibility: `{tenantId, businessId?, events[]}`. Enabled production contract: `{bindingId, destination, displayName?, events[]}` with strict rejection of caller `tenantId/businessId`; bearer + active binding resolve immutable scope before `handleAgentTurn` (FR-028/050/051) |
| GET | `/api/projects/[id]/tree` | nested project → part-projects → part-tasks → workpackages for the Structure Plan (WBS) canvas |

> Endpoint ทั้งหมดในไฟล์นี้ถูกตรวจโดย `scripts/doc-preflight.mjs` — ถ้ามี route ใหม่
> ใน `src/app/api` ที่ไม่ได้ระบุไว้ที่นี่ preflight จะรายงานเป็น staleness ทันที
