# HANDOFF — V2 business-centric shell (for Codex)

**Status:** Implemented handoff — FR-044 + N1/N2 navigation alignment complete
**Version:** 1.1.0
**Date:** 2026-08-13
**Author:** Owen + Claude (design/docs session)
**Relates to:** [ADR-008](ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md), [ADR-009](ADR-009-SELF-GOVERNANCE-LINEAGE-AND-IR-BOUNDARY.md), [SITEMAP-V2](SITEMAP-V2-DOMAIN-NAV.md), FR-002, FR-020

> This handoff is the implementation record for the approved shell boundary. FR-044
> entry routing and the N1/N2 Business Overview navigation correction are implemented;
> N4 viewer/session API design remains a separate contract slice.
> The human also has a visual companion (screen-inventory + wireframes artifact); it is
> private, so the inventory is reproduced below in text — implement from this file.

## 0. Read first (authority order)
1. `CLAUDE.md` + `AGENTS.md` — hard rules, governance, conventions (JS+Zod, enums SoT, services+audit, one envelope).
2. `ADR-008` — business-centric shell, dual **ERP⇄PM** lens, entry flow.
3. `ADR-009` — self-governance, lineage, IR boundary, PM dogfood.
4. `SITEMAP-V2` §1, §2, **§2b (journey)**, §5 — nav tiers, no-dropdowns, breadcrumb-as-switcher, URLs.

## 1. What is already built (do not rebuild)
- **Shell chrome:** `src/components/layouts/{AppShell,Topbar,Sidebar,DomainBar,Breadcrumb}.jsx`.
  L-layout: Topbar (row 1, full width) → DomainBar (row 2, full width) → Sidebar + content (row 3).
  Sidebar is an in-flow hover rail (80→256px, pushes content). Header has `relative z-50`.
- **Dual scope lens:** `src/config/scope-views.js` + `ScopeContext.viewMode` (`erp` default, `pm`).
  Topbar has an ERP·PM toggle; labels switch. Scope selection occurs before BusinessShell;
  the shell context bar is read-only and has no Business/Workspace/Project dropdowns.
- **Domains registry:** `src/config/domains.js` (7 domains; Campaigns under Growth; HR / People
  is a peer of Development).
- **Governance:** `scripts/doc-graph.mjs` (typed lineage edges) + `scripts/doc-preflight.mjs`
  (lineage guard). `scripts/self-plan.mjs` imports the repo's own roadmap into the PM
  (`PRJ-ZURI-GOV`); `npm run self:plan`.
- **Projects domain + Platform** (Settings/Audit/Backup) routes exist and work.

## 2. Scope model — read carefully (a fork depends on it)
```
Portfolio → Tenant → Business → Workspace → Project → Workstream → WorkContainer → WorkItem
```
- `Workspace.scopeType` ∈ { `BUSINESS`, `PORTFOLIO`, `TENANT` }.
  - `BUSINESS`-scoped → its projects belong to that business.
  - `PORTFOLIO`-scoped (seed: `WS-PLATFORM` "Shared Platform Engineering") → its projects are at
    the **group** level, beside the businesses, not inside one. `PRJ-ZURI-GOV` lives here.
- **The journey forks at the top** (SITEMAP §2b): a **Group** context ("ทุกธุรกิจ") for shared work,
  a **Business** context for one company. Projects has two entrances; the breadcrumb says which.
- URLs are **scope-free** (ADR-006). Business/workspace are ambient (cookie/context), never in the path.
- Campaign = **Growth** domain, never a Project type.

## 3. Roles & access (RBAC gates the journey)
Backed by the `Membership` model (staff RBAC). RBAC decides which businesses/domains a profile sees
at login (ADR-008 §D4).

| Role | Sees | Can |
|---|---|---|
| **OWNER** (เจ้าของธุรกิจ) | all businesses they own · all enabled domains | assign role + per-domain visibility to members · business/billing/module config |
| **MEMBER** (พนักงาน) | only businesses/domains the owner grants | work within scope · cannot edit permissions |
| **DEV** (platform) | everything, all tenants | debug/support — **cross-tenant, every action audited (append-only)**; a platform grant, separate from OWNER |

Implement DEV as a **platform-level** flag/role, not a per-business Membership. Never widen OWNER
into cross-tenant. Today's identity is a demo principal ("LO"); wire real auth later — build the
**gate seam** now (a single `resolveViewer()` that returns `{ principal, role, visibleBusinessIds,
visibleDomains }`), default it to OWNER-of-everything in dev, and route all visibility through it.

## 4. Screen inventory (status)

> **FR-044 / ADR-015 entry amendment (accepted):** the implementation changes
> the entry sequence to `/` Landing → `/login` demo stub → `/businesses` Business Routing
> → `/overview` guarded BusinessShell. The historical Home/Group rows below are retained
> as traceability; they must not be implemented as final-shell chrome before Business
> selection. Landing/Login use existing tokens and remain intentionally undesigned.

### FR-044 routing slice

| Screen | Route | Does | Status |
|---|---|---|---|
| Landing | `/` | one CTA to Login; no BusinessShell | implemented |
| Login stub | `/login` | one demo CTA to Business Routing; no auth | implemented |
| Business Routing | `/businesses` | viewer-visible Business selection | implemented |
| Business Overview / BusinessShell | `/overview` | mounts only after authorized Business selection | implemented |
Legend: ✅ built · ◐ partial/rebuild · ○ new · ◇ soon (lift from V1, ADR-003).

**Entry & global (historical rows retained for traceability)**
| Screen | Route | Does | |
|---|---|---|---|
| Login | `/login` | auth → RBAC | ○ |
| Home | `/` | pick/create Company → Business, or enter Group | ○ |

**Group context (ทุกธุรกิจ / Portfolio; reporting-only legacy rows)**
| Group Overview | `/overview` (no business) | consolidation roll-up + shared projects | ◐ |
| Shared/Platform projects | `/projects` | PORTFOLIO-scoped workspaces (PRJ-ZURI-GOV) | ✅ |

**Business context**
| Business Overview | `/overview` (business selected) | cross-domain home (KPIs + domain shortcuts) | ✅ |

**Projects domain** (shipped module, FR-001…020)
| Development root | `/overview` | BusinessShell root; not a Development sidebar item | ✅ |
| Workspaces | `/workspaces` (+`/[id]`) | หน่วยงาน/Space picker | ✅ |
| Projects | `/projects` (+`/new`) | project picker | ✅ |
| Project home | `/projects/{id}` | tabs: Project·Requirements·Team·Work·Risks·Resources·Files | ◐ |
| Team manager | `/projects/{id}/team` | members, roles, assignee load (from Membership) | ○ |
| File manager | `/projects/{id}/files` | documents, versions, folders, links to work items | ○ |
| Work · Structure (WBS) | `/projects/{id}/structure` | org-chart → workpackage modal | ✅ |
| Work · Board (Kanban) | `/projects/{id}/board` | 7-status columns → modal | ✅ |
| Work · Schedule (Gantt) | `/projects/{id}/timeline` | timeline + dependency lines | ◐ |
| Dependencies | `/dependencies` | dependency + lineage graph (SUPERSEDES/DERIVES_FROM) | ✅ |
| All Work · Execution · Timeline · Milestones · Repositories | `/work …` | cross-project | ✅ |

**Platform domain**
| Settings · Audit · Backup | `/settings /audit /backup` | health, append-only audit, snapshot | ✅ |
| Business & Tenant config | `/platform/business` | businesses, per-business module registry | ◐ |

**Identity & access**
| My profile | `/profile` | name, avatar, language TH/EN, LINE link, sessions | ○ |
| Users & permissions | `/platform/users` | OWNER assigns role + per-domain visibility (Membership) | ◐ |
| Identity / LINE linking | `/platform/identity` | account linking, staff/customer split (FR-022 backend done) | ○ |

**Reserved domains (◇ soon — lift per module):** Commerce (POS·Products·Inventory·Invoices·B2B) ·
Customer (CRM·Leads·Inbox·PDPA) · Growth (**Campaigns**·Ads·Automations·AI Copilot) ·
Operations (Kitchen·Runner·Courses·Attendance·Certificates·Team).

## 5. Historical build order (dependency-first; complete through N1/N2)
Each step: land a fresh FR id in `docs/PRD-SDD-v1.0.md`, annotate code `@req/@spec/@tested`, then
`npm run docs:graph && npm run docs:preflight`.

The original eight-step sequence below is retained as traceability and is complete for
the accepted FR-044 entry boundary and N1/N2 navigation alignment. Do not rebuild those
steps. The current follow-up is the N4 viewer-scoped API contract in
`docs/roadmap/PLAN-NEXT-BUSINESS-NAVIGATION-AND-VIEWER-CONTRACT.md`.

1. **RBAC gate seam** — `resolveViewer()` + context (`visibleBusinessIds`, `visibleDomains`, `role`).
   Default dev = OWNER-of-all. Everything below reads from it. *(needed by Home + dropdown removal)*
2. **Home (`/`)** — company→business picker (cards, adaptive via `deriveShell`: 1 company skips a
   step). Includes the **"ทุกธุรกิจ" → Group** entry. Sets ambient scope, routes to `/overview`.
   New route in `src/app/(pm)/` (or a dedicated route group). Selection writes to `ScopeContext`.
3. **Remove topbar scope dropdowns** — `Topbar.jsx`: delete `HeroSwitcher` + the `ScopeSelect` row.
   Keep: Zuri identity, viewed-domain chip, ERP·PM toggle, ⌘K, New Project, profile cluster.
4. **Breadcrumb-as-switcher** — `Breadcrumb.jsx`: each crumb links to its picker page (business
   crumb → `/` Home; workspace crumb → `/workspaces`; project crumb → `/projects`). Render the
   Group-vs-Business root correctly (`ทุกธุรกิจ` vs business name), labels per active lens.
5. **Business Overview + Group Overview** — split `/overview`: business selected → cross-domain
   Business Overview (KPI + domain shortcut cards); none → Group consolidation (roll-up + shared
   projects). Keep the existing group roll-up content; add the business variant.
6. **Team manager** `/projects/{id}/team` — list `Membership` in scope; add/remove, role, assignee
   load (count WorkItems by `assigneeRef`). New API route + view; no schema change.
7. **File manager** `/projects/{id}/files` — documents/attachments linked to WorkItem. **Needs a
   model** (`ProjectFile`: id, code, projectId, workItemId?, name, mime, size, url/blobRef, version,
   uploadedBy, createdAt) — add via a migration, register in Appendix B, keep external ids out of PKs.
8. **My profile** `/profile` + **Users & permissions** `/platform/users` — profile: account, language,
   LINE link, sessions. Users: OWNER-only; role dropdown (Owner/Member) + per-domain checkboxes,
   writing `Membership`. Guard with the RBAC seam (non-owner → 403 view).

## 6. Hard rules (do not break — from CLAUDE.md/AGENTS.md)
- **Never modify `G:\zuri`** (V1 live). **Never read any `.env`.** `G:\GoVibe` is read-only reference.
- **External ids are never primary keys** (internal UUID + `code` + `ExternalRef`, BR-002).
- **Enums live in `src/lib/validation/enums.js`** (single source) — never hand-copy a list. New
  `DEPENDENCY_TYPES` already include `SUPERSEDES`, `DERIVES_FROM`.
- **Every write goes through a service in `application/`** and records an audit event.
- **Every intake converges on the one envelope pipeline** (`import/plan-import-service.js`):
  validate → semantic → dry-run → single transaction → audit. New surfaces add a converter, not a
  second write path. **Plans are data — never executed** (BR-007, SEC-002).
- **Preserve UUIDs** on any migration; **one tenant is owned by one system at a time.**
- JavaScript + Zod at the boundary (no TypeScript, SDD-008). Thai in user-facing copy; English in code.

## 7. Definition of done (every change)
- `npm test` green (currently 225/225).
- `npm run build` clean.
- `npm run docs:graph` + `npm run docs:preflight` → **PASS** (no CRITICAL/WARN); Appendix D + FEATURE-MAP regenerated.
- Anything visible in the browser has been opened and checked (dev server: `npm run dev -- -p 3100`, or `run.bat`).
- New FR ids registered in `docs/PRD-SDD-v1.0.md`; code carries `@req/@spec/@tested`.

## 8. Handy commands
```bash
npm run dev -- -p 3100     # server + UI (or double-click run.bat)
npm test                   # vitest
npm run build              # production build (stop dev server first — shares .next)
npm run docs:graph         # rebuild doc-graph + Appendix D + FEATURE-MAP
npm run docs:preflight     # governance health (must PASS)
npm run self:plan          # regenerate the self-governance PlanEnvelope from doc-graph
```
