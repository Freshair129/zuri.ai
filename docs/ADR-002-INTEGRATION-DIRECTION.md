# ADR-002 — Ship Project Manager as a Zuri v1 Module, Promote to v2 on Trigger

**Status:** Accepted
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Supersedes:** the open decision point in [ADR-001](ADR-001-STANDALONE-ZURI-V2.md) §"Integration decision point"
**Evidence:** `zuri-v2-lab/docs/DECISION-BRIEF-AB.md`, `zuri-v2-lab/docs/ZURI-INTEGRATION-ASSESSMENT.md`

## Context

ADR-001 left the integration direction open until after the MVP and dogfooding.
Both are now done: `zuri-v2-lab` ships the scope model, seven execution modes, the
progress engine, four intake surfaces and the adaptive shell, with 129 Vitest +
28 Playwright tests green.

Measured facts that shaped the decision (read-only inspection of `G:\zuri`):

- 94 Prisma models, **255 `tenantId` references, 0 `businessId`** — the current
  schema has nowhere to write the word "group".
- `Tenant` in Zuri v1 means **one shop** (slug, LINE OA, plan, branding, owner
  employee). `Tenant` in the Project Manager means an **isolation umbrella** over
  several Businesses. Same word, different meaning.
- `Employee` is tenant-scoped and holds its own password hash, so an owner with
  two shops has two logins and two disconnected customer sets today.
- 209 API route handlers, 66 repositories, ~300 test files, live customers, LINE OA
  bound per tenant.
- Dependency versions are identical across both repos (Next 14.2.35, React 18.3.1,
  Prisma 5.22, Zod 3.23.8), so the cost is entirely in the scope model.

## Decision

**A → B: integrate the Project Manager into Zuri v1 as a module now, and promote
this repo's scope model to the Zuri v2 foundation when the trigger fires — under
three binding conditions that keep B affordable.**

### Binding conditions (from DECISION-BRIEF-AB §6)

1. **Canonical vocabulary is adopted immediately.** Portfolio / Tenant (= isolation
   umbrella) / Business / Workspace as defined in `zuri-v2-lab`. New code and docs
   stop using "tenant" to mean "a shop".
2. **Every new table in Zuri v1 carries a business dimension** (at minimum a
   nullable column that can be backfilled). Without this the 255-reference debt
   grows every week and B becomes unaffordable by attrition.
3. **The scope adapter is thin and lives in exactly one file** — mapping
   `v1.Tenant → PM.Business` (with an implicit 1:1 Portfolio/Tenant wrapper), so
   promoting to B is a deletion, not an unpicking.

### Promotion trigger

Move to B when **either** happens:

- the first group customer needs CRM, reporting or identity shared across more than
  one business, **or**
- we open a second business under one account ourselves.

## Consequences

Accepted now:

- Zuri v1 gains project execution without touching its 94 models, its auth, or
  production data. Risk stays low and delivery stays fast.
- FR-020's business switcher will not appear in v1 (1 tenant = 1 business there).
  The adaptive shell keeps working in single-business mode — no dead UI, but the
  multi-business half of it is investment held in reserve until B.
- "Businesses in a group share CRM" remains unanswerable in v1. That is a known,
  accepted limitation of A, not an oversight.
- The scope adapter is throwaway work by design.
- The Project Manager's work items must be positioned clearly against v1's existing
  `Task` model (CRM follow-ups) so users are not presented with two "task" systems.

Deferred to B:

- Re-scoping tenant-owned data to businesses, `Employee` → `Person`/`Membership`,
  and the data migration (domain-level export → schema migration → import, never a
  file copy — see `DB-MIGRATION-NOTES.md`).

Out of scope in both directions until integration time: production auth for the
enterprise API (token per tenant, rate limit, idempotency key), the LINE OA agent at
`D:\workspace\zuri-command-agent` (stays separate; its `.env` is never read),
Supabase/Redis/Pusher, live GitHub API.

## Review

Revisit this ADR when the promotion trigger fires, or if condition 2 is breached
more than once — a breach means the cost of B is silently rising.
