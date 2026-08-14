# Acceptance Criteria

MVP is complete only when all boxes pass. The baseline rows below were truth-synced
from `.agent/reports/FINAL.md` and the later 71-file/375-test, 33-pass Playwright,
production-build and documentation gates merged in PR #1 (`fb5906a`).

## Runtime

- [x] `npm install` succeeds
- [x] `npm run dev` boots locally
- [x] `npm run build` passes
- [x] application works with network disconnected after dependencies are installed
- [x] no cloud service is required at runtime

## Persistence

- [x] SQLite file is created locally
- [x] CRUD persists across app restart
- [x] seed command is idempotent or safely resettable
- [x] export snapshot works
- [x] import snapshot has preview and confirmation

## Scope

- [x] Portfolio/Organization ancestry routing works before BusinessShell
- [x] Business selection works on `/businesses`
- [x] Workspace/Space resource navigation works inside Development
- [x] Project resource navigation works inside Development
- [x] Tenant ID is never used as Branch ID
- [x] Business records carry Tenant ownership
- [x] Workspace belongs to explicit scope

## Project

- [x] create/edit/archive Project
- [x] create/edit/archive Workstream
- [x] Workstream has executionMode
- [x] Workstream has progressStrategy
- [x] project may mix execution modes
- [x] repository links are many-to-many
- [x] dependencies can block work
- [x] milestones and gates persist

## Seven modes

- [x] Software Sprint view works
- [x] Data Migration view works
- [x] B2B Sales Pipeline works
- [x] B2C Campaign view works
- [x] Product Launch view works
- [x] Operations view works
- [x] Business Expansion view works

## Progress

- [x] software progress calculates deterministically
- [x] migration progress derives from validation evidence
- [x] B2B weighted pipeline calculates correctly
- [x] B2C KPI score calculates correctly
- [x] launch readiness calculates correctly
- [x] operations score calculates correctly
- [x] expansion readiness calculates correctly
- [x] project weighted roll-up is tested
- [x] UI can explain where a displayed percentage came from

## Agent import

- [x] JSON Schema/Zod validation
- [x] rejects unknown execution modes
- [x] rejects malformed IDs/references
- [x] dry-run displays inserts/updates/conflicts
- [x] import is transactional
- [x] audit event recorded

## UI

- [x] Zuri Heritage tokens used
- [x] no purple/cyber theme
- [x] sidebar/topbar responsive
- [x] Business context is visible in the read-only Workspace > Organization > Business bar; Business selection occurs before BusinessShell and no shell dropdown is required.
- [x] universal views do not use software-only vocabulary
- [x] mode-specific vocabulary shown only inside correct view
- [x] empty states are usable
- [x] command palette works

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
- [x] Project owner/Space invariant: Business projects persist direct `businessId` matching their Business Space; explicit portfolio/tenant shared projects remain null-owner and are not attributed to a Business.
- [x] Project detail context shows Business as owner and schema Workspace as secondary `Space` metadata.
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
- [x] A selected Business can return to `/businesses` only by clicking the Organization
  value in the top `Workspace > Organization > Business` context bar; the Business
  value is read-only, and no separate action, breadcrumb link, or shell dropdown is introduced.
- [x] BusinessShell breadcrumb navigation is local-only: Home and Workspace return
  to `/overview` and never exit to `/` or `/businesses`.

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

## FR-046 — Production viewer session and entry contract (implemented beta)

- [x] OWNER/MEMBER Business visibility is derived from persisted Membership scope.
- [x] DEV requires a trusted server-held platform grant; Membership cannot promote DEV.
- [x] Empty grants return `200` with no Businesses or unrelated ancestry.
- [x] Missing, expired or revoked session returns `401 AUTH_REQUIRED` before a scope query.
- [x] Forged client identity, role and platform headers cannot affect authorization.
- [x] Session-adapter failure returns non-disclosing `503 SESSION_UNAVAILABLE`.
- [x] `/businesses` requests only `/api/entry`; entry surfaces do not prefetch broad `/api/scope`.
- [x] `/api/entry` returns only the authorized Business and minimum Tenant/Portfolio ancestry.
- [x] Protected compatibility routes resolve trusted request identity and re-authorize resources.
- [x] The explicit local demo cookie is HttpOnly/SameSite and cannot activate in production.
- [x] Playwright creates and seeds an isolated `prisma/e2e.db`; it does not depend on developer `.env` or `dev.db` state.
- [x] The clean-worktree browser suite completes explicitly: 34 passed, 4 intentionally skipped.

Exit gate: unit/contract/integration/browser suites, production build, docs graph,
preflight/check and diff check pass; provider selection remains a separate decision.

## Tests

- [x] unit tests for progress engine
- [x] integration test for project creation
- [x] integration test for plan import
- [x] tenant/business isolation test
- [x] Playwright smoke test for all 7 views
- [x] backup export/import test

## FR-045 — Managed local file workspace (implemented; beta)

- [x] SQLite is the sole authority for FileAsset identity, ownership, links, state, version and audit.
- [x] Business File Manager aggregates Business-owned and owned-Project files without copying content or leaking another Business.
- [x] Project Files preserves FR-037 compatibility while serving only the opened Project.
- [x] Managed ingest is staged, validated/hashed, audited and atomically promoted with recoverable failure states.
- [x] Absolute/traversal and symlink/junction/reparse escape paths are denied.
- [x] External move/delete yields `MISSING`; relink requires explicit operator input and never guesses.
- [x] `.zuri/cache` can be deleted and rebuilt to the same canonical DTO.
- [x] Remount to a second absolute root preserves ids, links and relative paths.
- [x] Hosted mode cannot invoke OS reveal; authorized local capability remains contained to the mount.
- [x] Backup preview exposes missing content/mount mapping and binary inclusion is explicit.
- [x] ProjectFile dry-run/commit migration has no silent drops and rollback rehearsal passes.
- [x] SQLite and generated Postgres metadata schemas preserve the same semantics.

Exit gate: ADR-016, FR-045 and ZV2-CR-001 are approved; all checks above are
checked; implementation/tests carry truthful `@req FR-045`, `@spec SDD-023,
SEC-007` and `@tested` edges; full tests/build/docs gates pass; no mock or user file
is deleted without a separately reviewed exact path/hash manifest.

## FR-051 — Production Tenant/Business isolation hardening (beta)

- [x] enabled LINE requests resolve Tenant and Business only from an active server-owned channel binding;
- [x] caller-supplied Tenant/Business scope is rejected before agent execution;
- [x] the production reader is limited to a scope-bound read role and fixed `zuri_core` SQL;
- [x] Supabase secret/service-role keys are forbidden in the Phase 1 LINE runtime;
- [x] local migration SQL uses private schema, forced RLS, composite ancestry and least-privilege grants;
- [x] approved SmartGift rows map to reserved internal Tenant/Business UUIDs without changing source provenance;
- [x] remote project inventory and advisor evidence are recorded;
- [ ] physical backup/PITR policy and rollback rehearsal are approved;
- [ ] migration plus positive/negative isolation probes pass on the target project;
- [ ] 74-row reconciliation and one kill-switch-protected canary pass before traffic enablement.

Repository-local exit gate may pass with the final three remote boxes open because the binding remains inactive and production LINE traffic remains disabled. The feature is not production-enabled until every remote box is checked.

## FR-053 / FR-054 — Phase 1 activation evidence (beta)

- [x] deterministic Golden evaluator, runtime isolation probe and mutation-free canary preflight exist;
- [x] focused local contract suites pass with fake/injected ports plus dedicated-loopback PostgreSQL 17;
- [ ] all Golden `ANSWER` cases map to the approved production artifact and owner-approved questions;
- [ ] a real approved provider passes 20/20 with zero unsupported numeric claims;
- [ ] the corrected probe passes through the dedicated unprivileged production login;
- [ ] one exact destination, provider/model, binding hashes and fresh evidence hashes are approved;
- [ ] a controlled binding installer and redacted post-LINE receipt artifact are reviewed;
- [ ] one signed canary records `ACCEPTED_BY_LINE` separately from display/read unknown.

Until every unchecked item passes, binding activation and production LINE traffic remain blocked.

## FR-055 — Controlled LINE activation and receipt (local beta)

- [x] activation and rollback inputs are strict, versioned, exact-scope and secret-free;
- [x] the command defaults to dry-run and requires both contract APPLY plus `--apply`;
- [x] destination, bearer, pepper and operator database URL are environment-only;
- [x] a dedicated login/role plus forced RLS and column grants restrict the exact binding;
- [x] DB-wall-clock CAS atomically activates one row and appends one event;
- [x] duplicate correlation, stale window, wrong scope/version/status and insert failure perform zero durable mutation;
- [x] rollback disables routing first and preserves hashes/imported data;
- [x] the strict `zuri-cli` adapter hash-pins exact bytes and never infers display/read;
- [x] composed PostgreSQL 17 tests pass through the real operator login/role/RLS path;
- [ ] one owner-approved production migration/activation/signed canary records a live truthful receipt.

Repository-local exit passes with the final external box open. Production mutation, provider traffic
and LINE remain blocked by the A1/A2/recovery/destination/provider/operator gates.
