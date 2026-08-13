# Acceptance Criteria

MVP is complete only when all boxes pass.

## Runtime

- [ ] `npm install` succeeds
- [ ] `npm run dev` boots locally
- [ ] `npm run build` passes
- [ ] application works with network disconnected after dependencies are installed
- [ ] no cloud service is required at runtime

## Persistence

- [ ] SQLite file is created locally
- [ ] CRUD persists across app restart
- [ ] seed command is idempotent or safely resettable
- [ ] export snapshot works
- [ ] import snapshot has preview and confirmation

## Scope

- [ ] Portfolio selector works
- [ ] Business selector works
- [ ] Workspace selector works
- [ ] Project selector works
- [ ] Tenant ID is never used as Branch ID
- [ ] Business records carry Tenant ownership
- [ ] Workspace belongs to explicit scope

## Project

- [ ] create/edit/archive Project
- [ ] create/edit/archive Workstream
- [ ] Workstream has executionMode
- [ ] Workstream has progressStrategy
- [ ] project may mix execution modes
- [ ] repository links are many-to-many
- [ ] dependencies can block work
- [ ] milestones and gates persist

## Seven modes

- [ ] Software Sprint view works
- [ ] Data Migration view works
- [ ] B2B Sales Pipeline works
- [ ] B2C Campaign view works
- [ ] Product Launch view works
- [ ] Operations view works
- [ ] Business Expansion view works

## Progress

- [ ] software progress calculates deterministically
- [ ] migration progress derives from validation evidence
- [ ] B2B weighted pipeline calculates correctly
- [ ] B2C KPI score calculates correctly
- [ ] launch readiness calculates correctly
- [ ] operations score calculates correctly
- [ ] expansion readiness calculates correctly
- [ ] project weighted roll-up is tested
- [ ] UI can explain where a displayed percentage came from

## Agent import

- [ ] JSON Schema/Zod validation
- [ ] rejects unknown execution modes
- [ ] rejects malformed IDs/references
- [ ] dry-run displays inserts/updates/conflicts
- [ ] import is transactional
- [ ] audit event recorded

## UI

- [ ] Zuri Heritage tokens used
- [ ] no purple/cyber theme
- [ ] sidebar/topbar responsive
- [x] Business context is visible in the read-only Workspace > Organization > Business bar; Business selection occurs before BusinessShell and no shell dropdown is required.
- [ ] universal views do not use software-only vocabulary
- [ ] mode-specific vocabulary shown only inside correct view
- [ ] empty states are usable
- [ ] command palette works

## FR-040 — Project Work views (implemented; G5 passed)

- [x] `Project > Work > Structure Plan` renders the Project → Workstream → WorkContainer → WorkItem tree from the canonical project tree API.
- [x] `Project > Work > Dependency Map` renders a labelled node and directed edge for every dependency whose two endpoints belong to the opened Project.
- [x] A Project-local Dependency Map excludes cross-project edges; those remain visible only in Development > Dependencies.
- [x] Empty, loading, error, keyboard focus, reduced-motion, and narrow viewport states remain usable.
- [x] No Prisma model, migration, UUID, or Tenant/Business isolation rule changes for this display-only feature.

- [x] Full repository test gate: `npm test` passes with 60 test files and 321 tests.
- [x] FR-040 Playwright proof (2/2), production build, and documentation gates pass.

## FR-041/042 — Business-first Strategy and HR / People

- [x] `/overview` is always Business-scoped; no portfolio/group business-card grid is rendered.
- [x] A missing Business selection renders a Business-required Home action.
- [x] Selected Business project KPIs/list exclude other Business workspaces and do not silently attribute portfolio-shared projects.
- [ ] Project owner/Space invariant: Business projects persist direct `businessId` matching their Business Space; explicit portfolio/tenant shared projects remain null-owner and are not attributed to a Business.
- [ ] Project detail context shows Business as owner and schema Workspace as secondary `Space` metadata.
- [x] Business Strategy renders Roadmap plus exactly two or three ordered goal horizons.
- [x] `HR / People` is a peer top-level domain with a Business-scoped People Directory.
- [x] People Directory is isolated by viewer-visible Business IDs; Project Team remains Project-local.
- [x] Targeted Playwright proof, full unit/integration suite, build, docs graph, and docs preflight pass.

Exit gate: all FR-041/042 checks above are checked, generated traceability contains
FR-041/042 and SDD-020, and no known regression exists in Development project routes.

## FR-044 — Minimal entry and Business Routing (implemented)

- [x] `/` is a minimal Landing page with one CTA to `/login`; no final BusinessShell chrome renders.
- [x] `/login` is a demo Login stub with one CTA to `/businesses`; no credentials, auth provider, token, or session is implemented.
- [x] `/businesses` is a Business Routing page that shows only viewer-visible Businesses and uses Portfolio/Organization only as ancestry labels.
- [x] Selecting a Business persists the existing scope and enters `/overview`, where BusinessShell mounts only after authorization.
- [x] `/overview` and Business domain routes redirect to `/businesses` when Business is missing and never show an in-shell Business picker.
- [x] A single visible Business still passes through `/businesses` in this proof slice.
- [x] Existing Zuri design tokens are reused; no token or landing visual redesign is included.
- [x] A selected Business can return to `/businesses` from the BusinessShell via the
  `Change Business` action and Business breadcrumb; no shell dropdown is introduced.

Exit gate: FR-044, ADR-015, and SDD-022 are approved; route-state tests, browser
journey proof, build, full tests, and docs graph/preflight/check all pass. ✅

## N1/N2 — Business Overview root and Development navigation

- [x] `/overview` is represented exactly once as the BusinessShell root.
- [x] Development sidebar contains only Projects, All Work, Execution, Timeline,
  Dependencies, Milestones & Gates, and Repositories.
- [x] DomainBar and the Development sidebar header link to `/overview` as the root.
- [x] Command palette does not expose Overview as a Development route.
- [x] Project, People, and Platform routes retain their existing ownership and URLs.

Exit gate: generated graph has zero dangling edges, docs preflight has zero critical or
warning findings, and unit/E2E/build gates pass.

## Tests

- [ ] unit tests for progress engine
- [ ] integration test for project creation
- [ ] integration test for plan import
- [ ] tenant/business isolation test
- [ ] Playwright smoke test for all 7 views
- [ ] backup export/import test
