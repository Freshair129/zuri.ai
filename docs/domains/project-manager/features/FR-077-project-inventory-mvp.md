---
domain: project-manager
feature: FR-077
module: project-manager
source: v2-native
version: "0.1.0b"
created_at: "2026-08-18T00:00:00+07:00,ATHER"
last_update: "2026-08-18T06:06:42+07:00,ATHER"
status: "candidate"
---

# FR-077 — Project Inventory MVP

| Field | Value |
|---|---|
| Feature | FEAT-005 — Project Inventory |
| Status | Implemented beta |
| Endpoint | `GET /api/projects/[id]/inventory` |
| UI | `/projects/[projectId]/inventory` |
| Relates to | FR-003, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-014, FR-036, FR-037, FR-040, FR-043, FR-045, FR-058, FR-072, SDD-045, ADR-034 |

## Contract

Project Inventory is a read-only, versioned projection for one opened Project. It
is deliberately separate from the Project List response `{ items, limit,
truncated }` and never sends a raw Prisma relation graph to the browser.

The response is `PROJECT_INVENTORY` schema version `1.0` and contains bounded
sections for:

- Project identity, direct Business owner and Space context
- Workstreams, Work Containers and Work Items
- Milestones and Gates
- Project-contained Dependencies
- Legacy ProjectFiles and managed FileAssets as metadata only
- ProjectRepository links
- visible Team/Membership rows
- strategy-based progress and evidence
- redacted recent AuditEvent activity

Every repeated section exposes `status`, `items`, `page`, `limit`, `truncated`,
`nextPage` and `reasonCode`. Raw `metricDataJson`, `metadataJson`, audit
`payloadJson`, filesystem roots and binary content are excluded.

## Authorization and isolation

The route resolves a trusted request viewer before loading child records.
Business-owned Projects use `seesBusiness(viewer, project.businessId)` for read
authority. Ownerless Projects are readable only when their `TENANT` or
`PORTFOLIO` Space is inside an explicit visible Business scope; this does not
grant mutation authority. Unknown or unauthorized Projects return the same 404
as a fabricated Project id.

All child reads are anchored to the authorized Project. The dependency section
contains only edges whose two endpoints are inside the Project. Repository rows
are reached only through `ProjectRepository`. Managed files must match the
authorized Project Business and Tenant.

## Compatibility boundary

The implementation does not change `GET /api/projects`, `view=overview`,
`view=timeline`, `view=workspace`, the existing Project detail response, or any
mutation route. The UI entry is an additive Project tab; the existing Project
page remains the default entry point.

## Acceptance criteria

- Authorized Business members can read the complete Project Inventory DTO.
- Cross-Business, cross-Tenant and cross-Project child rows are absent.
- Empty, partial/truncated, unavailable, error and unauthorized states are
  distinguishable.
- Progress is calculated from pure strategy calculators and does not update
  `progressCache` during a GET.
- Legacy and managed files are merged without duplicate ids or content copies.
- Unit, SQLite integration and E2E tests cover the contract and boundaries.
