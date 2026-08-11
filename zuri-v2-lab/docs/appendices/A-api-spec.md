# Appendix A — API Specification

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-11 |

ทุก endpoint เป็น local route handler (ไม่มี auth ใน MVP — local demo identity)
Error shape: `{ error, issues? }` — 400 validation/domain, 404 not found, 500 อื่น ๆ

## Scope

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/scope` | รายการ portfolio/tenant/business/workspace/project ทั้งหมด |
| POST | `/api/scope` | สร้าง scope entity: `{entity: portfolio\|tenant\|business\|workspace\|legalEntity\|branch, data}` |
| PATCH/DELETE | `/api/workspaces/[id]` | แก้ไข / archive workspace |

## Project core

| Method | Path | ทำอะไร |
|---|---|---|
| GET/POST | `/api/projects` | list (filter: workspaceId, businessId, tenantId, status, q) / create |
| GET/PATCH/DELETE | `/api/projects/[id]` | detail (รวม workstreams+milestones+gates+repos) / update / archive |
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
| POST | `/api/import/dry-run` | `{plan, workspaceId?}` → valid/errors + preview (insert/update/conflict) — read-only |
| POST | `/api/import/commit` | เหมือน dry-run แล้ว commit ใน transaction เดียว + audit |
| GET | `/api/backup/export` | full snapshot JSON |
| POST | `/api/backup/import` | `{snapshot}` = preview; `{snapshot, confirm:true}` = restore |
| GET | `/api/audit` | events (filter: entityType, entityId, limit) |

## Planned (FR-017..019)

- `POST /api/import/xlsx` — อัปโหลด workbook → envelope → dry-run รายแถว
- `GET /api/import/template` — generate Excel template จาก Zod schema
- `GET /api/docs` — OpenAPI 3 spec (zod-to-openapi)
- `GET /api/resolve?system=&value=` — external ID → internal id (ExternalRef)
