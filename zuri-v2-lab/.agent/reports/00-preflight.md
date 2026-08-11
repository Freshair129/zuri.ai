# Preflight Report — Zuri v2 Project Manager (`zuri-v2-lab`)

**Date:** 2026-08-11
**Agent:** Claude (lead implementation agent)
**Status:** GO — no blocking contradiction; one spec conflict documented and resolved below.

---

## 1. Understood architecture

- **Standalone offline-first app** `zuri-v2-lab/` (created at `D:\zuri-ai\zuri-v2-lab`), never touching current Zuri (`G:\zuri`, verified present, treated read-only reference).
- **Stack pipeline:** Next.js 14 App Router → Server Actions / route handlers → domain services → repository interfaces → Prisma 5 → local SQLite.
- **Canonical scope hierarchy:** Portfolio → Tenant → Business → Workspace → Project → Workstream. Tenant = isolation boundary, never a branch. External IDs (tax ID, GitHub repo id, LINE id) are never PKs; internal UUIDs + human codes (`PF-001`, `WST-DATA-CUSTOMER`, …).
- **Neutral execution core:** every Workstream has an `executionMode` (7 canonical modes) and `progressStrategy` (7 strategies). All seven execution views read/write the same neutral `WorkContainer` / `WorkItem` model — no per-mode mini-apps.
- **Progress engine:** strategy-based per workstream, returns `{percent, evidence, warnings, calculatedAt}`; project roll-up = `Σ(ws progress × weight) / Σ(weight)`. Never `tasks_done / tasks_total` universally.
- **Plan import:** external `PlanEnvelope` JSON → Zod validation → semantic reference validation → dry-run preview (inserts/updates/conflicts) → transactional commit → AuditEvent. No code execution from plans.
- **Backup:** explicit snapshot export/import with preview + confirmation; never silent overwrite.
- **Audit:** immutable `AuditEvent` stream for meaningful state changes.
- **UI:** Zuri Heritage tokens (Amber Citrus `#E8820C` family, glass nav `rgba(31,41,55,.98)`, IBM Plex Sans Thai/Manrope, lucide-react). Universal views use neutral vocabulary; mode vocabulary only inside its execution view. Command palette, filters/search, responsive, empty/error states.
- **Module boundary:** all PM-specific code in `src/modules/project-manager/` with `domain / application / infrastructure / components / views / progress / import` sub-layers. App shell depends only on exported PM routes/interfaces.

## 2. Chosen exact dependency versions

Aligned with current Zuri compatibility notes (Next 14.2.x, React 18.3.x, Prisma 5.22, Tailwind 3.4):

| Package | Version | Reason |
|---|---|---|
| next | 14.2.35 | latest 14.2.x App Router patch line |
| react / react-dom | 18.3.1 | current Zuri parity |
| tailwindcss | 3.4.17 | Tailwind 3 line |
| prisma / @prisma/client | 5.22.0 | matches current Zuri exactly |
| zod | 3.23.8 | stable v3, JSON-schema-friendly |
| date-fns | 3.6.0 | v3 stable |
| lucide-react | 0.474.0 | recent, React-18-compatible |
| vitest | 2.1.9 | stable v2 |
| @playwright/test | 1.49.1 | stable |
| autoprefixer / postcss | 10.4.20 / 8.4.49 | Tailwind 3 peers |

Language: **JavaScript (.js/.jsx)** — mandated by the MASTER-PROMPT repository tree (`layout.jsx`, `db.js`, `seed.js`). "No TypeScript blocking errors" (AGENTS.md §14) is satisfied trivially; ESLint via `next lint` config. No new state-management library — React context (`ScopeContext`) + server components + URL state only.

Persisted enums are plain strings + Zod enums in `src/lib/validation/enums.js` (Postgres-migratable, per master prompt).

## 3. Target directory tree

```text
zuri-v2-lab/
├── AGENTS.md                     (build rules copy for future agents)
├── package.json
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── vitest.config.js
├── playwright.config.js
├── .env                          (DATABASE_URL="file:./prisma/dev.db")
├── prisma/
│   ├── schema.prisma             (from docs/schema.local.prisma + Person/Membership)
│   └── seed.js                   (idempotent; seeds 4 tenants + 7-mode demo project)
├── src/
│   ├── app/
│   │   ├── layout.jsx            (shell: sidebar, topbar, ScopeProvider, palette)
│   │   ├── globals.css           (Zuri Heritage tokens)
│   │   ├── page.jsx              (redirect → /overview)
│   │   ├── api/                  (route handlers: scope, projects, workstreams, work,
│   │   │                          milestones, gates, dependencies, repositories,
│   │   │                          import, backup, audit, seed-reset)
│   │   └── (pm)/                 (route group with PM navigation layout)
│   │       ├── overview/ workspaces/ projects/[projectId]/... execution/[mode]/
│   │       ├── repositories/ audit/ backup/ settings/
│   ├── components/
│   │   ├── layouts/              (Sidebar, Topbar, StatusBar, CommandPalette)
│   │   └── ui/                   (Card, Pill, ProgressBar, Table, EmptyState, Modal…)
│   ├── config/modules.js         (module registry, PM as first module)
│   ├── context/ScopeContext.jsx  (portfolio/tenant/business/workspace/project scope)
│   ├── lib/
│   │   ├── db.js                 (Prisma singleton)
│   │   ├── ids.js                (uuid + human-code generator w/ collision retry)
│   │   └── validation/           (zod enums + entity schemas)
│   └── modules/project-manager/
│       ├── domain/               (entities, invariants, dependency cycle check)
│       ├── application/          (ProjectService, WorkstreamService, WorkItemService,
│       │                          DependencyService, ProgressService, PlanImportService,
│       │                          BackupService, AuditService, ScopeService)
│       ├── infrastructure/       (prisma repository adapters behind ports)
│       ├── progress/             (7 strategy calculators + rollup, pure functions)
│       ├── import/               (plan envelope zod schema, dry-run differ, committer)
│       ├── components/           (PM-specific widgets: WorkItemCard, GateList…)
│       └── views/                (7 execution views + universal views)
├── contracts/                    (copied plan-envelope.schema.json + sample-plan.json)
├── tests/
│   ├── unit/                     (ids, progress strategies, rollup, dependency, import)
│   ├── integration/              (scope chain, project CRUD, isolation, import, backup)
│   └── e2e/                      (Playwright smoke: all 7 views + universal routes)
├── docs/                         (README-user, architecture notes, migration notes)
└── .agent/reports/               (PHASE-00..07, FINAL)
```

## 4. Implementation risks

1. **Scale vs. wall-clock** — 16 entities, 7 views, 7 calculators, import/backup, 3 test layers. Mitigation: shared neutral components so each execution view is a configuration of common primitives + one mode-specific panel.
2. **SQLite + Prisma on Windows** — file locking during parallel Vitest runs. Mitigation: separate test DB file per suite via `DATABASE_URL` env in test setup; serial integration tests.
3. **Playwright on first run** needs browser download (network). Allowed at install-time (offline rule applies at *runtime* only).
4. **Human-code collision** — enforced unique in DB; generator retries with suffix.
5. **Dependency cycle detection** — implement DFS check in DependencyService before insert; test-covered.
6. **Dry-run purity** — import differ must never write; enforce by running diff phase entirely on read models and committing in one `prisma.$transaction`.
7. **Next.js server actions + SQLite writes** — keep all writes in route handlers/services (single node process locally, low risk).

## 5. Conflicts found in specs

| # | Conflict | Resolution |
|---|---|---|
| 1 | **AGENTS.md §1 self-contradiction:** "Do not … copy its whole codebase" vs. "The existing `G:\zuri` … you must have to copy and develop it to this new repo, and make sure you don't break any of its functionality." | Every other authority (MASTER-PROMPT "standalone local build", "What not to implement" list bans LINE/Supabase/CRM/POS; ADR-001 "compatibility target, not a codebase to mutate"; START-HERE "current Zuri codebase is a compatibility reference only") mandates a fresh standalone build. Copying the whole V1 app would drag in every banned integration. **Resolution: build standalone fresh; `G:\zuri` remains read-only reference.** The stray sentence is treated as a legacy note about the eventual v2 direction, not an MVP instruction. Flagged for the owner in FINAL.md. |
| 2 | `D:\workspace\zuri-command-agent` (LINE OA agent, has `.env`) — "your decision about merge it or build new one." | LINE is on the MASTER-PROMPT do-not-implement list. **Decision: neither merge nor rebuild in MVP.** Recorded in the future integration map. Its `.env` is never read or copied (secrets). |
| 3 | MASTER-PROMPT tree omits `prisma/` models for Person/Membership while DOMAIN-MODEL requires them ("MVP may seed one local owner Person"). | Add `Person` + `Membership` models (small), seed one local owner. |
| 4 | Master prompt tree shows `src/app/(pm)/` group while ROUTES-SITEMAP lists top-level routes (`/overview`, `/projects/...`). | Compatible: the `(pm)` route group renders those exact URL paths (route groups don't affect URLs). |
| 5 | schema.local.prisma has `Project.type` required but plan-envelope makes `project.type` optional. | Give `type` a default (`"GENERAL"`) at service level. |

No blocking contradiction → **continuing without confirmation**, per MASTER-PROMPT.

## 6. Plan for Phase 00–07

- **Phase 00 — Bootstrap:** manual scaffold (no interactive create-next-app): package.json with exact versions, Next/Tailwind/PostCSS configs, Heritage `globals.css`, Prisma schema + SQLite connect, module boundary folders, Vitest smoke test, Playwright config, `.agent/reports/PHASE-00.md`. Gate: dev boots, build passes, smoke test green.
- **Phase 01 — Scope model:** Portfolio/Tenant/LegalEntity(+Identifier)/Business/Branch/Workspace/Person/Membership services + API routes; ScopeContext + topbar selectors; seed 4 isolated tenants/businesses (from `contracts/seed-data.json`); tenant/business isolation tests.
- **Phase 02 — Project core:** Project, Workstream, WorkContainer, WorkItem, Milestone, Gate, Dependency (cycle check, no self-dep), Repository + ProjectRepository (many-to-many), AuditEvent on all mutations; CRUD APIs + validation.
- **Phase 03 — Universal UI:** Overview, All Work, Table, Timeline, Dependencies, Milestones & Gates (+ Calendar-style timeline), filters/search, command palette (Ctrl+K), neutral vocabulary.
- **Phase 04 — Seven execution views:** Sprint Board, Migration Monitor, B2B Pipeline, B2C Campaign Control, Launch Timeline, Operations Board, Expansion Portfolio — all over neutral core; seed one working workstream per mode.
- **Phase 05 — Progress engine:** 7 pure calculators + weighted roll-up, evidence/warnings output, "explain this %" UI, deterministic unit tests (0 items / partial / 100% / bad denominator / missing metrics / blocked gates).
- **Phase 06 — Import + backup:** PlanEnvelope Zod schema mirroring the JSON Schema, semantic validation (unknown mode, dangling refs, duplicate codes), dry-run preview UI, transactional commit + audit; snapshot export/import with preview + confirm; round-trip test.
- **Phase 07 — Hardening:** full build + unit + integration + Playwright smoke over all routes, responsive/empty/error states, keyboard focus basics, seed/reset command, user README, integration assessment docs, acceptance-criteria matrix → `.agent/reports/FINAL.md`.

Environment verified: Node v24.16.0, npm 11.13.0, Windows 10. `G:\zuri` and `D:\workspace\zuri-command-agent` exist (untouched). `D:\zuri-ai\zuri-v2-lab` does not yet exist — will be created in Phase 00.
