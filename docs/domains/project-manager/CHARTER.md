---
domain: project-manager
version: "0.1.0b"
status: "candidate"
modules:
  - project-manager
  - business
  - people
owns_code:
  - src/components/layouts/**
  - src/components/landing/**
  - src/context/ScopeContext.jsx
  - src/config/scope-views.js
  - src/config/domains.js
owns_models:
  - Portfolio
  - Tenant
  - LegalEntity
  - LegalEntityIdentifier
  - Business
  - Branch
  - Workspace
  - Project
  - BusinessRoadmap
  - BusinessRoadmapHorizon
  - BusinessGoal
  - ProjectGoal
  - Workstream
  - WorkContainer
  - WorkItem
  - Milestone
  - Gate
  - Dependency
  - Repository
  - ProjectRepository
  - ProjectFile
  - Team
  - TeamMembership
  - ProjectTeam
  - LocalWorkspaceMount
  - FileAsset
  - FileLink
  - Membership
  - AuditEvent
  - PlanImportReceipt
owns_routes:
  - src/app/(pm)/**
  - src/app/api/**
---

<!-- owns_routes are longest-prefix globs: src/app/api/agent/** in the agent
     charter is more specific, so agent routes resolve there, not here. -->
<!-- Annotations about the lists above belong here, outside the frontmatter: the
     generators read each list as an unbroken run of `  - Name` lines, so a YAML
     comment between two entries silently un-claims everything below it. -->

# Domain charter — project-manager

The scope chain and everything that plans work inside it: Portfolio → Tenant →
Business → Workspace → Project, plus workstreams, work items, milestones, gates,
dependencies, progress roll-up, the managed local file workspace, and the audit
trail. This is the back-office console's core.

## Boundaries

- **Every write goes through a service in `application/`** and records an
  AuditEvent — route handlers stay thin (CLAUDE.md convention).
- **Progress is recomputed from pure calculators** in `progress/` (no I/O, no
  clock); `progressCache` is advisory.
- All intake converges on the one import pipeline (`import/`) — a new surface
  adds a converter, never a second write path (BR-009, SDD-009). Its
  `PlanImportReceipt` is the trace record of a committed run, owned here.
- `Team`, `TeamMembership` and `ProjectTeam` are organisational grouping and
  grant nothing: the identity resolver never reads them and no route guard
  consults them (FR-089, BR-018, ADR-037 D1). `Membership` stays the authority
  record — grouping is kept out of it deliberately.
- Does not touch CRM's Person/Customer/Conversation/Message, identity's
  ExternalIdentity/IdentityLinkToken, or anything under `/api/agent/**`.

## Public contract (what other domains may call)

- `application/scope-service` — createPortfolio / createTenant / createBusiness
  and scope resolution; crm and agent build their test and runtime scopes
  through it, never by inserting scope rows directly.
- The import pipeline's envelope contract (`contracts/`).

## Satellite modules in this lane

Two small `src/modules/` folders are read-slices of this domain, not domains of
their own — both write **nothing**:

- `business` — the Business Strategy read model (FR-041/FR-043): serializes
  BusinessRoadmap/Goals/Projects, all owned here.
- `people` — the People Directory (FR-042): a Business-scoped view joining this
  domain's `Membership` with crm's `Person` (read-only cross-domain read, the
  pattern the architecture spec's §5.3 explicitly allows).

## Known shared-write exceptions (debt, visible on purpose)

- `AuditEvent` is appended by other domains' services through the shared
  `recordAudit` helper. Ownership means this domain defines its shape and
  retention — not that others cannot append through the helper.
