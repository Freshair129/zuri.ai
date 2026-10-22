---
domain: project-manager
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
  - TaxRegistrationBranch
  - Business
  - Branch
  - Employment
  - Workspace
  - Project
  - BusinessRoadmap
  - BusinessRoadmapHorizon
  - BusinessGoal
  - ProjectGoal
  - BusinessKeyResult
  - BusinessKeyResultCheckIn
  - BusinessKpi
  - BusinessKpiObservation
  - BusinessLeadMeasure
  - BusinessLeadMeasureValue
  - BusinessWeeklyCommitment
  - BusinessWigSession
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
  - AuditEvent
  - PlanImportReceipt
  - ProjectExecutionRun
  - ProjectExecutionStep
  - ProjectApprovalRequest
  - GovernanceSnapshot
  - ProjectFeature
  - FeatureContribution
  - FeatureWorkLink
  - RequirementBinding
  - ProjectFeatureMutationReceipt
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

> For LLM readers: [llms.txt](../../../llms.txt) is the repository index, and
> The optional one-file corpus can be built locally with `npm run docs:llms`;
> its `llms-full.txt` output is generated and not committed.

The scope chain and everything that plans work inside it: Portfolio → Tenant →
Business → Workspace → Project, plus workstreams, work items, milestones, gates,
dependencies, progress roll-up, the managed local file workspace, and the audit
trail. This is the back-office console's core.

## Boundaries

- [FR-286](../../requirements/FR-286.md) owns the standard Business bootstrap:
  a version-pinned catalog snapshot and one default Business Space (schema
  `Workspace`) are created atomically through the existing FR-074 paths.
  [The v1 contract](../../change-requests/business-provisioning/STANDARD-BUSINESS-TEMPLATE-V1.md)
  defines same-Business helper no-op, immutable history and safe backup recovery.
  Catalog definitions confer no rights; Identity retains Membership/RoleBinding
  authority, and the five FR-285 agent roles remain a separate configuration.
- **Every write goes through a service in `application/`** and records an
  AuditEvent — route handlers stay thin (CLAUDE.md convention).
- **Progress is recomputed from pure calculators** in `progress/` (no I/O, no
  clock); `progressCache` is advisory.
- All intake converges on the one import lane (`import/`) — a new surface adds a
  converter/orchestrator, never a second write path (BR-009, SDD-009). A
  `PlanEnvelope` remains the canonical per-Project import unit and its
  `PlanImportReceipt` remains the trace record of a committed Project import.
  [ADR-049](../../decisions/ADR-049-EXECUTION-PLAN-BUNDLE-IMPORT-ORCHESTRATION.md)
  adds `ExecutionPlanBundle` only as a programme-level transport/orchestration
  package above that boundary: it may coordinate Roadmap/Horizon/Goal services
  and N existing PlanEnvelope imports, but it may not bypass or fork the
  PlanEnvelope writer.
- [ADR-102](../../decisions/ADR-102-PM-EXECUTION-TRACE-AND-REPLAY.md) makes
  `ProjectExecutionRun` and `ProjectExecutionStep` the PM-owned trace and
  replay ledger. `PlanImportReceipt` remains the compatibility receipt; it is
  not the step/attempt authority. AgentTraceEvent and PipelineRun remain
  outside this domain.
- `ExecutionPlanBundle` is **not a persistence model** and is not a synonym for
  `WorkContainer`. `container` keeps its existing Workstream-local meaning.
- FR-252 adds Project-local Feature authority and explicit Domain, WorkItem and
  requirement relationships. GovernanceSnapshot and mutation receipts retain
  immutable evidence; Domain-view FR-251 never infers Feature rows. Identity
  owns the session-bound CSRF dependency. The six-table schema passes local
  isolated verification; repository, recovery and production gates remain open.
- `Team`, `TeamMembership` and `ProjectTeam` are organisational grouping and
  grant nothing: the identity resolver never reads them and no route guard
  consults them (FR-089, BR-018, ADR-037 D1). `Membership` — owned by the identity charter since ADR-077 D8, and written
  only from that lane — stays the authority
  record — grouping is kept out of it deliberately.
- `Employment` is an HR assignment record — who works here, with what title,
  from when to when — and answers a different question from `Membership`'s
  access grant (FR-193, BR-034, ADR-078 D1). Same discipline as Team: the
  identity resolver never reads it, and `people-service.js` reads it for the
  roster while deriving "has system access" FROM `Membership`, never the
  reverse.
- `TaxRegistrationBranch` holds a `LegalEntity`'s own VAT branch registrations
  (ประมวลรัษฎากร ม.86, ภ.พ.20); a `Branch` is an operating site that may
  optionally point at one (FR-194, ADR-078 D2). `LegalEntity` sits under
  `Tenant`, not `Portfolio` (ADR-078 D1) — a Business may only reference a
  LegalEntity in its own Tenant.
- Does not touch CRM's Person/Customer/Conversation/Message, identity's
  ExternalIdentity/IdentityLinkToken, or anything under `/api/agent/**`.

## Public contract (what other domains may call)

- `application/scope-service` — createPortfolio / createTenant / createBusiness
  and scope resolution; crm and agent build their test and runtime scopes
  through it, never by inserting scope rows directly.
- `application/branch-reference-reader` — `readBranchFact` /
  `listBusinessBranchFacts`: the narrow, internal (non-viewer) read port core's
  `scm-core.v1` façade (`inventory/application/scm-core-facade.js`, ADR-111 D5)
  calls for the SCM service's `branch` / `branches` facts, instead of reading
  `Branch` itself (the same standard as crm's `scm-reference-reader`). Given the
  Tenant of a Business the caller has already authorized, it answers only
  `{id, code, name, tenantId, businessId, status}` for one Branch, or, for one
  Business, every Branch (any status, ordered by code, bounded by the caller's
  `limit`) as `{id, code, name, address|null, kind, status, tenantId,
  businessId}` — never a tax branch code or any other column — and `null` / `[]`
  for a missing id, malformed input or another Tenant's row. Visibility of the
  Branch's home Business stays with the caller. Read-only by construction; no
  `owns_models` change.
- Per-Project intake contract: `contracts/plan-envelope.schema.json`.
- Programme-level package contract:
  `contracts/execution-plan-bundle.schema.json`, governed by ADR-049 and
  `EXECUTION-PLAN-BUNDLE.md`. Bundle-local symbols are resolved to authorized
  canonical IDs before any nested PlanEnvelope is committed; the symbols
  themselves grant no authority.

## Satellite modules in this lane

Two small `src/modules/` folders are read-slices of this domain, not domains of
their own — both write **nothing**:

- `business` — the Business Strategy read model (FR-041/FR-043): serializes
  BusinessRoadmap/Goals/Projects and projects the FR-269 KPI scorecard; all
  source models are owned here.
- `people` — the People Directory (FR-042): a Business-scoped view joining this
  domain's `Membership` with crm's `Person` (read-only cross-domain read, the
  pattern the architecture spec's §5.3 explicitly allows).

## Delivered in Phase 1 (FEAT-002, ADR-101 D6)

[ADR-101](../../decisions/ADR-101-BUSINESS-GOALS-BECOME-OKR-SMART-BSC-4DX.md)
extends `BusinessGoal` into an OKR Objective, tagged to one Balanced Scorecard
`perspective` (nullable — every existing goal, and the FR-108 bundle importer's
`zGoal`, carry none) and optionally marked `isWig` (boolean, default false; at
most two per Business, enforced in the service — BR-043, still unenforced until
its Phase 3 writer exists). `BusinessKeyResult` (+ append-only
`BusinessKeyResultCheckIn`), both now in `owns_models` above, are its first
child model family: a measurable child of `BusinessGoal` whose weekly check-ins
roll `BusinessGoal.progress` up through a pure calculator (SDD-107, FR-268),
and once a goal holds one, a manual `progress` patch is refused (BR-044).

## Delivered in Phase 2 (FEAT-002, FR-269)

`BusinessKpi` and append-only `BusinessKpiObservation` are Business-scoped,
not Goal-scoped, ongoing health metrics in one of the four fixed Balanced
Scorecard perspectives. The Business Home scorecard derives current status
from the latest manual OWNER observation and keeps it separate from the FR-060
composite. Configuration/archive and observation writes are OWNER-only and
audited; observation age does not imply staleness, and the system introduces
no provider polling or credential access. See the bounded [FR-269 contract](features/FR-269-business-scorecard-kpis.md).

## FR-270 4DX weekly execution — implementation (FEAT-002, ADR-101 D6 Phase 3)

Phase 3 merged via PR #647 to `main` as
`8a2fd4984a868923291c68c0169b16a8f0716768` on 2026-10-12. The implementation
was based on admitted `main` `4144430bcdc69e92dfe8365a73226ad6259955fa` and
developed on `codex/feat002/fr270-4dx-weekly-execution`. It declares
`BusinessKeyResult.isLagMeasure` and adds Business-scoped
`BusinessLeadMeasure` with append-only `BusinessLeadMeasureValue`,
`BusinessWeeklyCommitment`, and `BusinessWigSession` models, migration files,
seven OWNER-only write routes, the additive Strategy DTO, the Overview card,
persisted overdue-session attention, and backup recovery coverage. All new
writers live in `project-manager/application/` alongside the existing
`business-strategy-mutation-service.js`; the business read-slice remains
read-only.

Focused integration/unit checks passed 57/57, and OpenAPI route coverage
passed 19/19 after registering the seven new routes.
Exact-head hosted governance, build, four test shards, and specialized checks
passed; E2E and desktop hosted jobs were skipped by workflow. Local
production-mode Playwright passed 210 tests with four repository-skipped
superseded smoke cases. The migrations are authored but not applied;
deployment, provider activation, and live-Business acceptance remain separate
gates under ADR-057. See the
[FR-270 implementation contract](features/FR-270-4dx-weekly-execution.md).

## Known shared-write exceptions (debt, visible on purpose)

- `AuditEvent` is appended by other domains' services through the shared
  `recordAudit` helper. Ownership means this domain defines its shape and
  retention — not that others cannot append through the helper.
