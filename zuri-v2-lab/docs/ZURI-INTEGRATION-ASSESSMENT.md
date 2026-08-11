# Zuri Integration Assessment

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Decided — A→B (ADR-002, 2026-08-12) |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-11 |

Evaluates the finished MVP against ADR-001's decision point: merge into Zuri v1
as a module, or promote as the foundation of Zuri v2.

> **Decision input (2026-08-12):** `docs/DECISION-BRIEF-AB.md` puts real numbers
> under both options (94 models / 255 `tenantId` references / 0 `businessId` in
> `G:\zuri`, and the tenant-means-two-different-things trap) plus the three
> questions that settle GATE-AB.

## Fit with current Zuri (observed patterns)

| Current Zuri pattern | zuri-v2-lab equivalent | Merge friction |
|---|---|---|
| Next.js 14 App Router | same | none |
| `src/config/modules.js` registry | same pattern (`modules.projectManager`) | none — nav entries drop in |
| TenantProvider context | ScopeContext (Portfolio→Tenant→Business→Workspace→Project) | **high** — scope is a superset of Tenant |
| Prisma 5 / Postgres | Prisma 5 / SQLite (string enums, provider-agnostic) | low (see DB-MIGRATION-NOTES) |
| Zuri Heritage CSS variables | identical token set | none |
| Zod, Vitest, Playwright, lucide | identical | none |

## Option A — merge as Zuri v1 module

Feasible if Workspace stays Project-Manager-only:
1. Mount `src/modules/project-manager` under Zuri's module folder; register nav in `modules.js`.
2. Wrap ScopeContext so `tenantId` comes from the existing TenantProvider; hide the
   Portfolio/Business selectors (default to a single implicit Portfolio/Business per tenant).
3. Point Prisma models at Postgres (namespaced tables or a separate schema).
4. Keep the plan-import and backup endpoints behind Zuri auth.

Cost: moderate. Risk: low (no changes to existing modules). Limitation: Portfolio/
Business hierarchy stays invisible to CRM/POS/etc.

## Option B — promote to Zuri v2 foundation (preferred per START-HERE)

Choose this if Portfolio → Business → Workspace should become the global context
for CRM, POS, Marketing, Inbox, Employees:
- This repo already ships the canonical scope model, isolation guards, module
  registry, Heritage shell, audit stream, and offline backup — i.e. the v2 shell.
- Follow docs/ZURI-V2-HANDOFF.md: map Employee membership → `Person/Membership`,
  map Customer/Conversation/Order ownership to `business_id`, decide Workspace
  globality, then port existing Zuri modules into `src/modules/*` one at a time.
- Tenant semantics change (Tenant = isolation umbrella over Businesses) — treat as
  a versioned architecture migration, not a refactor.

## Outcome (2026-08-12) — superseded the same day

1. Owner first chose **A → B under the DECISION-BRIEF §6 conditions**
   ([ADR-002](../../docs/ADR-002-INTEGRATION-DIRECTION.md), now **superseded**).
2. The destination then changed: **V2 replaces V1 outright** (LINE-first,
   AI-native, web demoted to back-office), which cancels option A entirely.
   Binding decision: [**ADR-003**](../../docs/ADR-003-V2-REPLACES-V1-BY-REUSE.md)
   — reuse V1's web UI except auth, lift per module at each module's cutover.
   GATE-AB is PASSED against ADR-003.

The A/B analysis below is kept because its measured basis (94 models, 255
`tenantId` references, 0 `businessId`, the two meanings of "tenant") still holds
and is what ADR-003 is built on. Only the chosen direction changed.

## Recommendation

The MVP validates the Portfolio/Tenant/Business/Workspace hierarchy and the
neutral execution model with real seeded flows and tests. **If** cross-module
business-awareness is the goal (the stated expectation), Option B is the sound
foundation: start Zuri v2 from this shell and port modules in. Option A remains a
cheap fallback that ships PM value into v1 without global changes.

Out-of-scope items to revisit at integration time: production auth, LINE OA agent
(`D:\workspace\zuri-command-agent` — keep separate; never copy its `.env`),
Supabase/Redis/Pusher, live GitHub API.
