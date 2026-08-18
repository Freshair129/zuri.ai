# zuri-ai — Project View Contract Checklist

> Working checklist only. This file is not a source of truth for product
> behavior. The authoritative contract remains in the PRD/SDD, ADRs, feature
> notes, API appendix, JSON/Zod schemas, read models, route code, and tests.

- Scope: all current Project Manager and Project-local views under
  `src/app/(pm)` plus shared views under `src/modules/project-manager/views`.
- Inventory sources: `docs/ROUTES-SITEMAP.md`,
  `docs/appendices/A-api-spec.md`, `docs/TRACE.md`, and the actual route tree.
- Date opened: 2026-08-18

## Status legend

- `[x]` Evidence exists in the repository; this does not by itself prove a
  current runtime or release pass.
- `[~]` Partial or implicit contract: route/service/code shape exists, but a
  stable response/view contract is not separately machine-checked.
- `[!]` Contract or implementation exists, but documentation/status evidence
  conflicts and needs reconciliation.
- `[ ]` Contract work remains.

## Definition of a complete view contract

Every view should have one traceable contract covering:

- [ ] Canonical route, scope context, owning domain, and sibling/global versus
  project-scoped relationship.
- [ ] Authoritative data source and read model; no second copy of another
  domain's data.
- [ ] Stable request/filter shape and stable response DTO/schema.
- [ ] Loading, empty, error, unauthorized, unavailable, and truncated states.
- [ ] Mutation boundary, if the view writes; otherwise an explicit read-only
  statement.
- [ ] Requirement/feature, ADR/SDD/business rule, and security references.
- [ ] `@req`, `@spec`, and `@tested` traceability at the correct route/module.
- [ ] Unit/read-model, integration/API, and relevant Playwright evidence.
- [ ] Generated graph/TRACE/FEATURE-MAP and feature-note status agree.

## Foundation contracts

- [x] Browser access goes through `useFetch`/`api` → `/api/*`; the browser does
  not open Prisma directly (`src/modules/project-manager/components/useApi.js`).
- [x] Common API error shape is `{ error, issues? }`
  (`src/app/api/_helpers.js`, `docs/appendices/A-api-spec.md`).
- [x] Local transactional authority is Prisma → SQLite
  (`src/lib/db.js`, `prisma/schema.prisma`).
- [x] Neutral Project core is shared by Workstream, WorkContainer, WorkItem,
  Milestone, Gate, Dependency, Repository, and FileAsset views.
- [x] Plan import has a machine contract: `contracts/plan-envelope.schema.json`
  plus the Zod/semantic mirror in `src/modules/project-manager/import/plan-schema.js`.
- [x] Seven execution modes have semantic mode contracts in
  `docs/EXECUTION-MODES.md`, `src/lib/validation/enums.js`, and the PlanEnvelope
  schema.
- [~] API inventory exists in `docs/appendices/A-api-spec.md`, but the appendix
  is still Draft and does not provide a machine-checked success response schema
  for every route.
- [~] Response-schema coverage is uneven: `zEntryResponse`, import/OpenAPI
  responses, and selected read models are explicit; many Project Manager routes
  still expose ad-hoc arrays or Prisma-shaped objects.
- [~] Viewer/scope authorization is largely traced, but the current baseline
  still records unresolved authority decisions for `/api/scope` and
  `/api/backup/import` in `docs/.route-viewer-baseline.json`.

## Entry and Business Home

### `/businesses` — Business Routing

- [x] FR-044/FR-046, ADR-017, SDD-024, SEC-008 are linked.
- [x] Read source is the atomic `/api/entry` response.
- [x] `zEntryResponse` defines the success DTO and is parsed at the read-model
  boundary (`src/modules/identity/entry-read-model.js`).
- [x] Empty scope, auth failure, and session-unavailable behavior are documented
  and tested.
- [x] Unit and Playwright evidence is linked.
- [ ] Keep API appendix, feature note, route annotations, and generated views in
  sync after any entry-contract change.

### `/overview` — Business Home + Strategy

- [x] FR-035/FR-041/FR-059/FR-060 and the non-owning projection rule are linked.
- [x] Strategy read model is exposed by `/api/business/strategy`.
- [x] Business Home is derived by `buildBusinessHomeReadModel`; it owns no
  persistence and consumes owning-domain read models.
- [x] Projects, strategy, people, progress, reserved-domain, and attention
  inputs are identified in the page/read-model code.
- [!] Reconcile feature-note status versus generated/PRD status for FR-060
  before calling the contract approved.
- [ ] Define and validate one combined page DTO for the data assembled by the
  page; do not let the page silently grow another cross-domain query.
- [ ] Add/keep explicit state coverage for no Business, no Projects, no signal,
  reserved domain, and partial-domain health.

## Project resource views

### `/projects` — Project list

- [x] FR-003 and Project CRUD/archive route/service are linked.
- [x] Business/Space ownership rule is implemented in the service boundary.
- [~] List response is a service/Prisma-shaped array, not a dedicated response
  DTO/schema.
- [ ] Define the list DTO, filter semantics, ordering, archive visibility, and
  pagination/truncation behavior.
- [ ] Add response-shape tests that are independent of Prisma's incidental
  include shape.

### `/projects/new` — Objective wizard

- [x] FR-017/BR-003 defines objective-first intake and no template picker.
- [x] Wizard output converges on the PlanEnvelope dry-run → commit pipeline.
- [x] Schema, semantic validation, authorization, transaction, and audit tests
  are linked.
- [ ] Document the wizard-to-envelope field mapping as the human-input contract.

### `/projects/[projectId]` — Project detail

- [x] FR-043/ADR-014/SDD-021 define Business owner versus Space context.
- [x] Project detail reads the existing Project/Workstream/Milestone/Gate/Repo
  relationships through the Project service.
- [~] The success response is still a broad service include shape rather than a
  stable Project detail DTO.
- [ ] Define the detail DTO and explicitly separate displayed fields from
  internal persistence fields.
- [ ] Add contract tests for Business owner, Space label, archived Project, and
  shared Project states.

### `/projects/[projectId]/structure` — Structure Plan

- [x] FR-040/ADR-012/SDD-019 define the canonical WBS hierarchy.
- [x] `/api/projects/[id]/tree` is the dedicated read boundary.
- [x] WBS shape is covered by `WbsCanvas` and `wbs-structure` tests.
- [~] Route returns a nested Prisma-shaped object; no JSON/Zod response schema
  pins the tree contract.
- [ ] Define a versioned WBS DTO for Project → Workstream → WorkContainer →
  WorkItem, including empty children and deleted-item rules.
- [ ] Add loading, empty, not-found, and scope-denied route tests.

### `/projects/[projectId]/all-work` — Project All Work

- [x] FR-005 defines this as the project-scoped instance of the global All Work
  view over the neutral WorkItem model.
- [x] It consumes the shared `/api/work` contract.
- [x] The service discloses `{ items, limit, truncated }` and hydrates metrics
  and metadata.
- [~] The response shape is documented in code comments, not as a dedicated
  machine-checked view schema.
- [ ] Create one shared WorkList DTO/schema used by both `/work` and this route.
- [ ] Pin filter, sort, client-search, 500-row cap, and `truncated` behavior in
  unit/API tests.

### `/projects/[projectId]/board` — Project Board

- [x] FR-063 defines one non-persisted status column per `WORK_STATUSES` value.
- [x] Cards use the existing WorkItem mutation path.
- [!] Reconcile FR-063 feature-note status with generated status and verify the
  current implementation; the feature note records the historical six-column
  mismatch while the generated trace currently says done.
- [ ] Derive columns directly from `WORK_STATUSES` and decide the visible
  treatment of `CANCELLED`.
- [ ] Define the Board input/read DTO and all status-column states.
- [ ] Add project-scoped Board Playwright coverage, including `CANCELLED`.

### `/projects/[projectId]/execution/[mode]` — Project execution views

- [x] FR-009 covers the project-scoped half of the seven-mode family.
- [x] Mode/subtype/metric/progress semantics are defined in the shared execution
  contracts, not in seven separate data models.
- [x] View reads Workstream listing plus workstream progress.
- [~] No per-mode read DTO/schema exists; the UI consumes shared work/progress
  shapes and mode-specific rendering branches.
- [ ] Define the common ExecutionView DTO.
- [ ] Define the mode-specific evidence/display contract for all seven modes:
  `SOFTWARE_SPRINT`, `DATA_MIGRATION`, `B2B_SALES`, `B2C_CAMPAIGN`,
  `PRODUCT_LAUNCH`, `OPERATIONS`, `BUSINESS_EXPANSION`.
- [ ] Add a global/project filter-equivalence test for every mode.
- [ ] Add explicit loading, empty, invalid-mode, unavailable-progress, and
  warning-state tests.

### `/projects/[projectId]/timeline` — Project Schedule

- [x] FR-064/SDD-036 define a read-only derived month-grid over Project and
  Milestone dates.
- [x] The same `TimelineView` is reused by global and project-scoped routes.
- [!] Reconcile the feature-note status/anchor statement for FR-064 with the
  generated trace and current code.
- [~] Timeline consumes Project/Milestone response shapes directly; no dedicated
  timeline DTO/schema exists.
- [ ] Define the bar/marker DTO, date-null behavior, ordering, and viewport rules.
- [ ] Add project/global equivalence tests and no-date/no-bar tests.

### `/projects/[projectId]/dependencies` — Project Dependency Map

- [x] FR-040/ADR-012/SDD-019 define strict project containment.
- [x] Dedicated `/api/projects/[id]/dependencies` route exists.
- [x] `PROJECT_DEPENDENCY_GRAPH_VERSION = '1.0'` pins `{ version, projectId,
  nodes, edges }` and deterministic ordering.
- [x] Graph/list fallback and contained-endpoint tests exist.
- [ ] Add a Zod response schema for the versioned graph DTO.
- [ ] Keep visual graph and accessible list consuming the same DTO.

### `/projects/[projectId]/milestones` — Project Milestones & Gates

- [x] FR-006 defines weighted milestones, required gates, evidence, and status
  mutations.
- [x] Shared `/api/milestones` read boundary returns `{ milestones, gates }`.
- [~] Response shape is service-defined but not separately schema-validated.
- [ ] Define the Milestone/Gate DTO, evidence shape, ordering, and project filter.
- [ ] Add explicit empty/error/archived-project contract tests.

### `/projects/[projectId]/repositories` — Project Repository links

- [x] FR-008/BR-002 define local repository metadata and many-to-many links;
  GitHub API access is not part of the MVP contract.
- [x] Project link/unlink route and Business ownership authorization exist.
- [~] Repository and link responses are not pinned by a dedicated response DTO.
- [ ] Define Repository and ProjectRepository DTOs, including provider,
  externalRepoId, URL, branch, role, and pathScope semantics.
- [ ] Reconcile the current dirty-worktree repository changes before closing
  this contract item; do not treat code presence as completion.

### `/projects/[projectId]/team` — Project Team

- [x] FR-036/SDD-015 define Membership reuse, Business scope, tenant-wide
  read-only rows, and assignee load.
- [x] Project Team service and authorization tests exist.
- [~] The page consumes a service-shaped response without a stable response
  schema.
- [ ] Define Team DTO, manageable/read-only flags, assignee-load semantics, and
  mutation response shape.
- [ ] Add UI contract tests for tenant-wide rows and denied mutations.

### `/projects/[projectId]/files` — Project Files / File Manager

- [x] FR-037/FR-045 define compatibility ProjectFile and managed FileAsset
  boundaries.
- [x] FR-058 defines the canonical `assetDto`, `groups`, timeline ordering, and
  preview eligibility matrix.
- [x] File Manager model/UI/E2E tests are linked.
- [!] Reconcile FR-058 feature-note status (`Candidate`) with generated/trace
  status before calling the view contract final.
- [ ] Add/keep one machine-checked FileManager response schema for Business and
  Project routes.
- [ ] Keep preview decisions derived from `assetDto`; no second filesystem/path
  contract may be introduced.

### `/projects/[projectId]/import` — Plan import

- [x] FR-012/FR-065/BR-009 define validate → semantic check → dry-run →
  authorization → transactional commit → audit.
- [x] `contracts/plan-envelope.schema.json` and `zPlanEnvelope` are the shared
  human/agent/XLSX input contract.
- [x] Dry-run/commit response contracts and OpenAPI registrations exist for the
  enterprise-facing import surface.
- [x] Import scope, external-ref, status vocabulary, and transaction tests exist.
- [ ] Keep JSON Schema, Zod semantics, Excel converter, wizard output, and
  generated API docs aligned after future changes.

## Shared global views that must reuse Project contracts

- [ ] `/work` and `/projects/[projectId]/all-work` use exactly one WorkList DTO
  and differ only by server-side scope filter.
- [ ] `/execution` and `/execution/[mode]` expose the same seven-mode catalog and
  common ExecutionView DTO as the project-scoped routes.
- [ ] `/timeline` and `/projects/[projectId]/timeline` use one Timeline DTO and
  differ only by Project filter.
- [ ] `/dependencies` and the Project Dependency Map keep separate boundaries:
  global register may show cross-project edges; local graph requires both
  endpoints inside the opened Project.
- [ ] `/milestones` and `/projects/[projectId]/milestones` use one
  Milestone/Gate DTO and differ only by filter.
- [ ] `/repositories` and Project repository links use one Repository metadata
  contract; ProjectRepository remains a separate link DTO.

## Supporting Project Manager surfaces

- [~] `/people` and `/people/directory`: FR-042 and `listPeople` define the
  Business-scoped shape; add a machine-checked People DTO and state matrix.
- [~] `/profile`: FR-038 and profile service define the visible account/session
  boundary; add a response schema and identity-link state matrix.
- [~] `/platform/users`: FR-038/FR-062 define manageable/read-only membership
  rows; add a response schema and explicit empty/denied contract.
- [~] `/audit`: FR-014 defines immutable event browsing; add event payload,
  filtering, ordering, pagination, and redaction schema.
- [~] `/backup`: FR-013/FR-045 define preview/confirm behavior; add snapshot
  schema, remount/error states, and the full-restore authority decision.
- [~] `/workspaces` and `/workspaces/[workspaceId]`: FR-001 defines Space
  hierarchy; add list/detail DTOs and clearly separate schema `Workspace` from
  future top-level collaboration Workspace.
- [~] `/settings`: the scope-creation flow uses `/api/scope`; document the
  pre-Business creation authority contract before removing its baseline debt.

## Contract closure gates

- [ ] Create a single view-contract registry or generated matrix that maps every
  page route to requirement, source/read model, DTO/schema, API route, and tests.
- [ ] Add response schemas or explicit stable DTO serializers for every `[~]`
  view above; do not expose incidental Prisma `include` shapes as contracts.
- [ ] Add a uniform view-state matrix: loading, empty, error, unauthorized,
  unavailable, archived, and truncated where applicable.
- [ ] Reconcile FR-058, FR-060, FR-063, and FR-064 feature-note statuses with
  `docs/FEATURE-MAP.md`, `docs/TRACE.md`, and actual implementation evidence.
- [ ] Resolve the two remaining route-viewer decisions in
  `docs/.route-viewer-baseline.json` (`/api/scope`, `/api/backup/import`).
- [ ] Run and record `npm test`, `npm run build`, `npm run govern`, and the
  relevant Playwright suites before marking any contract complete.
- [ ] Keep this checklist as a work ledger only; update the authoritative
  feature/ADR/API/schema files first, then regenerate governance views.
