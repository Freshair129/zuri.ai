# FINAL Report — Zuri v2 Project Manager (`zuri-v2-lab`)

**Date:** 2026-08-11
**Status: PASS** — all acceptance criteria met (matrix below).
**Location:** `D:\zuri-ai\zuri-v2-lab` (standalone; current Zuri at `G:\zuri` untouched).

---

## Implemented features

1. Canonical scope hierarchy Portfolio → Tenant → Business → Workspace → Project → Workstream with topbar selectors and persisted selection; tenant = isolation (never a branch); LegalEntity + TH identifiers; Branch; local Person/Membership demo identity.
2. Full CRUD for Workspace, Project (archive = soft delete), Workstream (mode + strategy + weight), WorkContainer (hierarchical), WorkItem (weight/value/probability/metrics), Milestone, Gate (evidence, required), Dependency (self/cycle rejection, blocked evaluation), Repository + ProjectRepository (many-to-many, role/pathScope/branch).
3. Seven execution views over ONE neutral core: Sprint Board, Migration Monitor, B2B Sales Pipeline, B2C Campaign Control, Product Launch Timeline, Operations Board, Expansion Portfolio — each with add-item and inline status updates; global (`/execution/*`) and project-scoped routes.
4. Strategy-based progress engine: 7 deterministic pure calculators returning percent + evidence + warnings (+ calculatedAt), gate-capping rules, weighted project roll-up `Σ(ws%×w)/Σw`, and an "Explain" UI for every displayed percentage.
5. Plan-envelope JSON import: strict Zod schema (mirrors `contracts/plan-envelope.schema.json`), semantic reference validation, read-only dry-run with insert/update/conflict preview, single-transaction commit, AGENT_PLAN audit event. No code execution from plans.
6. JSON snapshot backup: full-domain export; import with count preview + explicit confirmation; transactional restore; audit events.
7. Immutable audit log with browser UI and entity-type filter.
8. Idempotent seed: PF-001, 4 isolated tenants/businesses, 5 workspaces, demo project with one ACTIVE workstream per mode, repository link, cross-stream gate dependency.
9. Zuri Heritage UI: exact token set, glass nav, amber-active states, responsive to 375px, empty/error/loading states, command palette (Ctrl+K), filters/search.
10. Tests: 75 Vitest unit+integration (isolated test DB) + 20 Playwright E2E — all green; `npm run build` clean.

> **Post-MVP addendum (2026-08-12).** Intake phase FR-017 (objective wizard), FR-018
> (Excel template intake) and FR-020 (adaptive shell) landed after this report.
> Current suite: **102 Vitest + 25 Playwright**, build clean. Two acceptance rows below
> changed affordance without losing capability — see the addendum notes on the
> Portfolio and Business selector rows.

## Routes verified (build + E2E + live checks)

`/overview`, `/workspaces`, `/workspaces/[id]`, `/projects`, `/projects/[id]`,
`/projects/[id]/{all-work,timeline,dependencies,milestones,repositories,import,execution/[mode]}`,
`/execution` + 7 mode routes, `/work`, `/timeline`, `/dependencies`, `/milestones`,
`/repositories`, `/audit`, `/backup`, `/settings`.
Live spot-checks: Overview (7 workstreams, 58.3% weighted roll-up), Migration Monitor (82% from 20,358/24,840 validated records).

## Schema summary

19 Prisma models on SQLite (`prisma/schema.prisma`): Portfolio, Tenant, LegalEntity, LegalEntityIdentifier, Business, Branch, Person, Membership, Workspace, Project, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency, Repository, ProjectRepository, AuditEvent. UUID PKs + unique human codes; string-persisted enums (Zod source of truth); createdAt/updatedAt/version/deletedAt conventions; JSON columns for viewConfig/metrics/metadata/evidence/audit payloads.

## Test results

| Suite | Result |
|---|---|
| Unit: ids, 7 strategies (0 items/partial/100%/bad denominator/missing metrics/gates), rollup, plan schema+semantics | 46 pass |
| Integration: scope chain + tenant/business isolation, project core (CRUD, mixed modes, deps/cycles, repos m2m, progress e2e), plan import (dry-run purity, transactional commit, conflicts), backup round trip | 29 pass |
| **Vitest total** | **75/75** |
| Playwright E2E: 10 universal-route tests, 7 execution views, evidence reveal, import rejection, mobile overflow | **20/20** |
| `npm run build` | clean |

## Acceptance-criteria matrix

| Criterion | Result | Evidence |
|---|---|---|
| npm install succeeds | PASS | install log; postinstall prisma generate |
| npm run dev boots | PASS | dev server on :3000/:3100; live page checks |
| npm run build passes | PASS | 16-route build output |
| Works offline after install | PASS | runtime = local SQLite + same-origin fetches only; no external URLs/fonts/CDNs at runtime |
| No cloud service at runtime | PASS | code audit: no Supabase/Redis/Pusher/LINE/external AI/GitHub API |
| SQLite file created locally | PASS | prisma/dev.db via db:push |
| CRUD persists across restart | PASS | file-backed SQLite; integration tests reopen client |
| Seed idempotent / resettable | PASS | double-run seed verified; npm run db:reset |
| Export snapshot works | PASS | backup.test.js + /backup UI |
| Import snapshot preview+confirm | PASS | preview-without-confirm purity test; confirm flow test |
| Portfolio selector works | PASS | topbar select (ScopeContext). **FR-020:** shown only when ≥2 portfolios exist; with one group the "ทุกธุรกิจ" switcher entry is the portfolio-level scope |
| Business selector works | PASS | **FR-020:** replaced by the identity-corner business switcher (same selection, clears descendants); hidden entirely when only one business exists |
| Workspace selector works | PASS | topbar select, business-scoped filtering. **FR-020:** hidden when the active business has ≤1 workspace |
| Project selector works | PASS | topbar select navigates to project |
| Tenant ID never used as Branch ID | PASS | branch/tenant match rule + test |
| Business carries Tenant ownership | PASS | schema + isolation test |
| Workspace has explicit scope | PASS | scopeType validation + test |
| Create/edit/archive Project | PASS | UI modals + project-core tests |
| Create/edit/archive Workstream | PASS | UI modals + tests |
| Workstream has executionMode | PASS | schema + Zod enum |
| Workstream has progressStrategy | PASS | schema + per-mode default |
| Project may mix modes | PASS | seeded 7-mode project + test |
| Repository links many-to-many | PASS | ProjectRepository + test |
| Dependencies can block work | PASS | BLOCKS/REQUIRES evaluation + test |
| Milestones and gates persist | PASS | CRUD + linkage tests |
| 7 mode views work | PASS | 7 E2E tests + live checks |
| 7 progress calculations correct | PASS | 27 strategy unit tests |
| Project weighted roll-up tested | PASS | rollup unit + integration (70% case) |
| UI explains displayed % | PASS | ProgressExplain (formula/evidence/warnings); E2E evidence-reveal test |
| JSON Schema/Zod validation | PASS | strict zPlanEnvelope + 10 unit tests |
| Rejects unknown execution modes | PASS | unit + integration test |
| Rejects malformed IDs/references | PASS | semantic validation tests |
| Dry-run shows inserts/updates/conflicts | PASS | preview UI + purity test |
| Import transactional | PASS | single $transaction; conflict-blocks-commit test |
| Audit event recorded | PASS | PLAN_IMPORTED/AGENT_PLAN test |
| Zuri Heritage tokens used | PASS | globals.css token set (exact values) |
| No purple/cyber theme | PASS | amber/warm palette only |
| Sidebar/topbar responsive | PASS | breakpoints + mobile E2E |
| Context selectors visible | PASS | topbar on every route |
| Universal views neutral vocabulary | PASS | "work item/stream/container" only |
| Mode vocabulary only in its view | PASS | vocab strings scoped to mode-bodies/ExecutionModeView |
| Empty states usable | PASS | EmptyState with guidance everywhere |
| Command palette works | PASS | E2E Ctrl+K navigation test |
| Unit tests progress engine | PASS | 31 tests |
| Integration project creation | PASS | scope+core suites |
| Integration plan import | PASS | 7 tests |
| Tenant/business isolation test | PASS | scope-and-isolation suite |
| Playwright smoke all 7 views | PASS | 7 view tests |
| Backup export/import test | PASS | round-trip test |

## Known limitations

- Boards use status dropdowns, not drag-and-drop.
- Snapshot restore replaces the whole local DB (previewed + confirmed); no merge restore.
- Client-side fetching throughout (no server-component read path yet).
- IBM Plex Sans Thai referenced with system fallback, not bundled.
- Playwright falls back to a locally present chromium build when the pinned rev-1148 download is unreachable (config-documented).
- Calendar view is folded into Timeline.

## Spec conflict flagged for owner

AGENTS.md §1 simultaneously forbids copying current Zuri's codebase and instructs "copy and develop `G:\zuri` into this new repo". All other authorities (MASTER-PROMPT scope list, ADR-001, START-HERE) mandate a fresh standalone build, so this build is standalone and `G:\zuri` was treated as read-only reference. If wholesale porting of Zuri V1 was truly intended, that is a separate (large) effort — see docs/ZURI-INTEGRATION-ASSESSMENT.md. The LINE OA agent (`D:\workspace\zuri-command-agent`) was neither merged nor rebuilt (LINE out of MVP scope); its `.env` was never read.

## Future Zuri integration map

See `zuri-v2-lab/docs/ZURI-INTEGRATION-ASSESSMENT.md` and `DB-MIGRATION-NOTES.md`:
- **Merge as Zuri v1 module:** SUITABLE — module registry/nav pattern matches; wrap ScopeContext over TenantProvider; move Prisma models to Postgres (string enums make this mechanical). Moderate cost, low risk, but Portfolio/Business stays PM-local.
- **Foundation of Zuri v2:** SUITABLE and **recommended** if Portfolio/Business/Workspace becomes the global context (the stated expectation). The repo already provides the v2 shell: scope model + isolation guards, module registry, Heritage UI shell, audit stream, offline backup, test scaffolding. Port existing modules in one at a time per ZURI-V2-HANDOFF checklist; treat tenant-semantics change as a versioned architecture migration.
