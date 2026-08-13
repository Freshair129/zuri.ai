# Appendix A — API Specification

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-13 |

ทุก endpoint เป็น local route handler (ไม่มี auth ใน MVP — local demo identity)
Error shape: `{ error, issues? }` — 400 validation/domain, 404 not found, 500 อื่น ๆ

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

## Entry and Business Routing (FR-044 — planned)

The entry slice intentionally adds **no login/auth endpoint**. `/` and `/login` are
UI-only stubs; the Login button is a local demo transition to `/businesses` and must
not be treated as credential validation or session issuance.

| Interface | Contract |
|---|---|
| `GET /api/viewer` | Resolve the current viewer seam before Business Routing: `principal`, `role`, `visibleBusinessIds`, `visibleDomains`, and `isPlatform`. |
| `GET /api/scope` | Supply Portfolio/Tenant/Business labels and ids used to render routing ancestry. The selectable operating node is Business. Production authorization must filter this response server-side or introduce a viewer-scoped entry response before real auth is enabled. |
| `BusinessShell guard` | Not an API route: `/overview` and Business domain routes require an authorized `activeBusinessId`; missing selection resolves to `/businesses`, and missing viewer resolves to `/login`. |

No password, OIDC, LINE login, token, session, or new persisted auth contract is part
of FR-044. Those belong to the later identity implementation and must not be implied
by the demo Login button.

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

## Intake surfaces (FR-017..FR-020 — shipped)

| Method | Path | ทำอะไร |
|---|---|---|
| POST | `/api/import/xlsx` | อัปโหลด workbook → envelope → dry-run รายแถว (FR-018) |
| GET | `/api/import/template` | generate Excel template จาก Zod schema (FR-018) |
| GET | `/api/docs` | OpenAPI 3 spec generated from the live Zod schemas (FR-019) |
| GET | `/api/resolve?system=&value=` | external ID → internal id via ExternalRef; 404 unmapped, 410 dangling (FR-019) |
| POST | `/api/agent/line-webhook` | `{tenantId, businessId?, events[]}` — zuri-cli forwards LINE events → `handleAgentTurn` per text message (Gate E); tenant-scoped, 400 without tenantId (FR-028) |
| GET | `/api/projects/[id]/tree` | nested project → part-projects → part-tasks → workpackages for the Structure Plan (WBS) canvas |

> Endpoint ทั้งหมดในไฟล์นี้ถูกตรวจโดย `scripts/doc-preflight.mjs` — ถ้ามี route ใหม่
> ใน `src/app/api` ที่ไม่ได้ระบุไว้ที่นี่ preflight จะรายงานเป็น staleness ทันที
