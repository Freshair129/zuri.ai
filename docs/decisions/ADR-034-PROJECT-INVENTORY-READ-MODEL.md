---
version: "0.1.0b"
created_at: "2026-08-18T13:45:00+07:00,ATHER"
last_update: "2026-08-18T13:45:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "Project Inventory MVP read model, route and authorization boundary"
---

# ADR-034 — Project Inventory read model boundary

**Status:** Accepted for MVP implementation

**Relates to:** FR-077, FEAT-005, FR-003, FR-040, FR-043, FR-072, ADR-012,
ADR-014, ADR-016, ADR-017, SDD-045

## Context

An opened Project needs one operational read surface spanning identity, work,
milestones, gates, dependencies, files, repositories, team, progress and recent
activity. Existing routes intentionally have different contracts and some legacy
GET paths return service-shaped data. Replacing those contracts would break
compatibility consumers and would make Project List a relation graph.

Several source models also have different scope properties: Business ownership is
direct on Project, Membership is Tenant/Business-scoped, FileAsset carries
Tenant/Business ownership, Repository has no independent scope, and Dependency
and AuditEvent are polymorphic records.

## Decision

### D1 — Add one outer, stable DTO

Add `GET /api/projects/[id]/inventory` and return one `PROJECT_INVENTORY` DTO
version `1.0`. The DTO has independently bounded section envelopes but does not
expose Prisma relation objects.

### D2 — Keep source ownership with existing models

No new Inventory aggregate or Prisma model is introduced. The application read
service composes existing repository/service data and pure progress calculators.
Inventory is read-only and never performs mutation, network sync or external API
calls.

### D3 — Authorize before composition

The route resolves a trusted viewer. A direct Business owner is readable when
the Business is visible to the viewer. An ownerless Project is readable only when
its Tenant/Portfolio Space can be justified from the viewer's visible Business
scope. A failure is fail-closed and does not reveal Project existence.

### D4 — Preserve existing boundaries

`GET /api/projects` and `view=overview|timeline|workspace` remain unchanged.
The existing Project detail page remains the default. Inventory is an additive
Project-local route and tab.

### D5 — Contain polymorphic sections

Dependency edges are included only when both endpoints are in the opened Project.
Audit activity is restricted to the Project entity closure and redacted to
action/entity/time. Repository rows are reached only through ProjectRepository.
Files are metadata references only; no binary content or absolute roots are
returned.

## Consequences

The Project page can offer one consistent operational snapshot without creating
seven execution-specific applications. Full details and mutations continue to
live in their existing pages and contracts. The initial implementation loads a
bounded read snapshot from local SQLite; cursor pagination and independently
scalable section endpoints remain future work.

## Rollback boundary

Rollback removes the Inventory route, tab, read service, UI page, tests and
feature documentation. Existing Project/List/compatibility routes and database
records remain unchanged; no database migration rollback is required.
