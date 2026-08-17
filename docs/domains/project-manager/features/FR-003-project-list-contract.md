---
domain: project-manager
feature: FR-003
module: project-manager
source: v2-native
---

# FR-003 — Project list response contract

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-18 |
| **Relates to** | FR-043, ADR-014, BR-001, BR-004, SDD-021, SEC-001, SEC-008 |

`GET /api/projects` is the read boundary for the `/projects` page. It returns a
small, machine-checked projection rather than a Prisma relation graph. The
Project's direct `businessId` remains the owner; `workspace` is secondary Space
context. Milestones, gates, tenant internals, deletion metadata, and version
counters are not part of this list contract.

`view=list` is the default. Existing relation-rich consumers request an explicit
compatibility view: `overview` for Business Home, `timeline` for the global
Schedule, and `workspace` for Space detail. They preserve the legacy array until
each projection gets its own stable DTO; none is part of the `/projects` list
response contract.

## Response

```text
{
  items: ProjectListItem[],
  limit: number,
  truncated: boolean
}
```

Each `ProjectListItem` contains `id`, `code`, `name`, `description`, `type`,
`status`, `businessId`, `workspaceId`, `workspace { code, name, scopeType }`,
ISO `startAt`/`targetAt` values, and `workstreamCount` for non-deleted
Workstreams.

## Request semantics

- `workspaceId`, `businessId`, `tenantId`, `status`, and `q` are optional filters;
  supplied filters compose with `AND`.
- `businessId` filters the direct Project owner. An ownerless shared Project is
  not attributed to a Business filter.
- `tenantId` filters through the owning Space.
- `q` is a trimmed substring search over Project `name` or `code`.
- `view` is `list` by default. `overview`, `timeline`, and `workspace` are
  explicit relation-rich compatibility modes for existing consumers and are
  not used by the `/projects` page.
- Active list reads use `deletedAt IS NULL`; archived Projects are not returned,
  including when `status=ARCHIVED` is requested.
- Results are ordered by `updatedAt DESC`, then `id DESC` for deterministic ties.
- The effective hard limit is 500. The service reads one extra row to set
  `truncated` without counting the full table. The limit is disclosed in every
  successful response.

The existing PATCH and DELETE mutation boundaries are unchanged. This document
pins the response/read behavior only; it does not resolve the separate viewer
authority decision for direct `GET /api/projects` calls.

## Acceptance criteria

- **AC-003.1:** The route returns `{ items, limit, truncated }` and every item
  passes the Project list Zod schema.
- **AC-003.2:** Filters, owner/Space semantics, archive exclusion, and ordering
  are covered against the SQLite authority.
- **AC-003.3:** The response does not expose the old milestone/gate relation
  graph or internal deletion/version fields.
- **AC-003.4:** The `/projects` page consumes `items`, renders an empty state for
  an empty list, and discloses a truncated window.
- **AC-003.5:** Existing project creation, update, archive, and detail routes
  remain behaviorally unchanged.

## Exit gate

The feature is complete only when focused unit/integration/UI tests, the full
test suite, build, `docs:graph`, `docs:preflight`, `docs:check`, and
`git diff --check` are green.
