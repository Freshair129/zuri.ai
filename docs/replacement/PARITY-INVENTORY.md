# Parity Inventory — what must exist in V2 before a tenant can cut over

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Complete (first pass) — verdicts are recommendations; the owner confirms |
| **Method** | 6 parallel read-only area scans + 1 cross-area audit + 1 coverage-gap pass (`TASK-V2-PARITY`) |
| **Source** | `G:\zuri` @ `0b6d3c3` — read only, never modified |
| **Evidence** | `docs/.rwang-tasks/parity-{commerce,customer,growth,operations,platform,workers,gaps,audit}.md` |
| **Last Updated** | 2026-08-12 |

## 1. What V1 actually is

**A culinary-school SaaS**, not a generic restaurant/shop platform: recipes tied to
courses, QR class attendance, credential ladders (`BASIC_30H` / `PRO_111H` /
`MASTER_201H`), with POS, CRM and LINE inbox around it. The registered tenant
codename in `id_standards.yaml` is `TVS` = The V School.

This correction matters: courses, enrollment and certificates are **core**, not
peripheral, so they are must-have at cutover.

| Measure | Value |
|---|---|
| Prisma models | 94 · 255 `tenantId` refs · 0 `businessId` |
| API routes | 209 (workers 25 · pos 19 · integrations 15 · ai 14 · marketing 12 · customers 11 · …) |
| Dashboard pages | 68 (71 of 74 files `'use client'`) |
| Background workers | 25, all on Upstash QStash |
| Velocity | ~213 commits / 90 days |

## 2. Verdicts by area

| Area | must-have | later | drop | rebuild | Notes |
|---|---|---|---|---|---|
| Commerce | 9 | 7 | 1 | 0 | Extra sub-areas found: `pos/delivery`, `pos/mobile`, a `quotes` backend with no UI |
| Customer | 4 | 1 | 1 | 0 | Deepest PII surface; consent lives here |
| Growth | 10 | 3 | 0 | 0 | Existing AI surface — see §5 |
| Operations | 10 | 0 | 1 | 0 | Culinary school core; `/runner` tablet display |
| Platform | 5 | 2 | 0 | 3 | Auth/identity + LINE webhooks are **rebuild**, not lift |
| Gaps pass | 2 | 3 | 0 | 0 | billing (scaffold), tasks, overview, mcp, mobile-login, settings |

**No wrong "drop" survived the audit.** The dangerous candidate (loyalty/V-Points)
resolved correctly: `walletPoints` has no writer anywhere. One area had read an ADR's
Thai prose as if it described shipped code.

### Confirmed drops

| What | Why |
|---|---|
| `modules/industry/culinary/kitchen/food-erp/*` | Unwired and broken — its own tests are `describe.skip`'d with a comment admitting it; references SQL tables absent from `schema.prisma`. **Must not be used as a design reference.** |
| Loyalty / V-Points | `walletBalance`/`walletPoints` fields + a tier calculator, no consuming routes, no writer. (`crm/[id]/page.jsx:440` renders a nonexistent `customer?.vPoints`, so the 360 page shows 0 VP unconditionally.) |
| `(dashboard)/settings/mobile/danger` | Zero `onClick` handlers — the mobile delete/export UI is dead |
| `(dashboard)/settings/mobile/billing` | Zero fetch calls — decorative |

### Rebuild, do not lift

| What | Why |
|---|---|
| Auth / identity / session | `Employee` is `@@unique([email, tenantId])` with its own `passwordHash`; `team/join` creates a new employee + password per tenant. Nothing links one human across tenants. |
| LINE webhooks (`line-bot`, `line-monitor`) | No per-tenant routing; one hardcodes `DEFAULT_TENANT_ID` |
| Tenant config write path | `PATCH /api/tenant/{config,integrations}` gate on a permission domain that does not exist → 403 for every role today |

## 3. Can a tenant be cut over? — Not every tenant, not yet

Blockers, worst first:

1. **`line-bot` / `line-monitor` have no per-tenant switch at all.**
2. **`webhook-processor` resolves the tenant with `IntegrationConfig.findFirst`** and no
   payload binding — it already misattributes Instagram/WhatsApp messages across
   tenants **in V1 today**. A live defect, not just a migration obstacle.
3. **`Tenant.isActive` cannot be the ownership switch** — it is already the predicate
   for four workers' tenant loops; flipping it would silently stop audit purges and
   certificate issuance.
4. **Seven workers loop over all active tenants** in one invocation (`audit-cleanup`,
   `automation-engine` cron mode, `cert-nightly`, `extract-styles`, `quote-aging`,
   `sync-accounting`, `sync-hourly`). Cheapest to fix — in V2.

Blockers 1–2 would require changing V1, which is forbidden. Therefore:

> **Pilot tenant selection criterion: the first tenants cut over must use none of
> `line-bot`, `line-monitor`, Instagram or WhatsApp.**

### The atomic flip list — nine owners

ADR-003 §D8 originally named three. The scans found nine:

| # | Owner | Per-tenant flippable? |
|---|---|---|
| 1 | LINE OA webhook (`/api/webhooks/line` only — the tenant-routed one) | yes, via `destination → lineOaId` |
| 2 | Background workers | **not today** — 7 loop over all tenants |
| 3 | Data writes | yes |
| 4 | Billing PSP webhook (`api/webhooks/billing`) | yes — but no PSP is actually wired; scaffold |
| 5 | Issued `TenantApiKey`s | yes |
| 6 | `auth/mobile-login` JWTs (30-day) | yes — revocable via `jti` + `ActiveSession`; **legacy pre-FC-13 tokens without `jti`** fall back to a weaker check |
| 7 | `settings/ownership` (+verify) | yes |
| 8 | `settings/workspace` (soft-delete) | yes |
| 9 | `team/invite` | yes |

## 4. Migration-order hazards

- **Stock deduction is the load-bearing cross-module wire**:
  `src/lib/services/stockDeduction.js::deductForOrder` runs FEFO deduction inside the
  same transaction as order create/pay, idempotent via `Order.stockDeductedAt`. POS,
  kitchen and inventory move together or not at all.
- **Three workers perform the same accounting export** (`accounting-sync`,
  `sync-accounting`, `sync-express`) with no shared dedupe — a duplicate-send risk
  inside V1 alone.
- **`DailyBrief` is keyed by date only, not tenant** — tenants collide today.
- **Customer identity resolution** is `@@unique([tenantId, phonePrimary | lineId |
  facebookId])`, so sharing a customer between two businesses in one group requires a
  constraint redesign, per-business consent, and 1:1 profile/insight relations.

## 5. The existing AI surface (matters for V2's design rule)

V1 does **not** consistently follow "AI never writes directly". Four shapes exist:

| Shape | Where | Verdict |
|---|---|---|
| ✅ Stage → human confirm → commit | `api/ai/confirm` + `AIPendingEntry` | **The pattern V2 should standardise on** |
| ⚠️ Write then flag | `api/ai/sales-closer` creates an `Order` with `requiresApproval: true` | Approval is after the write |
| 🔴 Write and auto-send | `lib/ai/agentMode.js` saves the reply, then auto-delivers to the customer if the tenant opted in and confidence ≥ 0.6 | No per-message human step |
| 🔴 Silent write | batch `ConversationAnalysis` from daily-brief | No gate |

Provider: Google Gemini (`@google/generative-ai`), env var name `GEMINI_API_KEY`.

`api/mcp` is **not** a live CRM exposure: `withAuth` is real, but every `tools/call`
branch is an unimplemented stub returning empty results. Its `GET` manifest has no auth.

## 6. Consent and PII (feeds SEC-004 / SEC-005)

- Consent = **four columns on `Customer`** (`consentAt`, `consentSource`,
  `consentVersion`, `optOut`), gated by `canMarketTo()` in `src/lib/consent.js`.
  Granularity is **per customer per tenant — not per channel**.
- **The only path that writes consent is `POST /api/liff/consent`** — the LIFF surface.
  (An earlier scan reported LIFF as absent and marked it *drop*; that was wrong and is
  corrected. LIFF is **must-have**: 6 API routes, 4 pages under
  `(liff)/liff/[tenantSlug]/`.)
- `campaign-broadcast` checks consent before sending and holds a Redis idempotency
  lock. The automation engine can fire `SEND_LINE_MESSAGE` with only a cooldown and an
  hourly rate limit.

## 7. V1 defects found in passing

Reported, **not fixed** — `G:\zuri` is never modified. These are V1's to triage.

| Severity | Defect |
|---|---|
| 🔴 | `webhook-processor` misattributes Instagram/WhatsApp messages across tenants |
| 🔴 | Session revocation disabled — `// TEMPORARY BYPASS` in the session path |
| 🔴 | `line-bot` replies through one shared global LINE token for all tenants |
| 🔴 | Login is non-deterministic for a person at two tenants: `auth-config.js:61` calls `findByEmail` without a tenantId; `employeeRepo.js:18` falls back to an unordered `findFirst` |
| 🟠 | `extract-styles` treats the presence of an `upstash-signature` header as authentication |
| 🟠 | `campaign-broadcast` has no atomic claim on pending sends — concurrent runs double-send |
| 🟠 | `Task` has no RBAC domain: no role restriction on read/write/delete (scope of the exposure needs confirming) |
| 🟠 | 10 commerce routes bypass the repository layer (on the frozen ESLint direct-Prisma list); the tenant guard does not cover workers or webhooks |
| 🟡 | `PATCH /api/tenant/{config,integrations}` unreachable — 403 for every role |
| 🟡 | `DailyBrief` keyed by date only — tenant collisions |
| 🟡 | Schedules for 12 of 13 cron workers exist only in the QStash console, not in the repo; the one registered schedule's time disagrees with the worker's own comment |

## 8. V1 documentation that must not be trusted

Now living in `docs/v1-inherited/` (ADR-005). Reported independently by three scans:

- `docs/product/module-manifests/{pos,kitchen,procurement,enrollment}.yaml` — all
  `status: scaffold`, describing models, routes and pages that **do not exist**.
- `crm/CLAUDE.md` and `inbox/CLAUDE.md` reference a `CustomerIdentity` model absent
  from the schema.
- Tasks' `CLAUDE.md` claims a LINE due-date reminder worker that does not exist.

Per-directory `CLAUDE.md` files and the code itself were used instead. **This is the
ADR-005 risk materialising on day one: the inherited corpus is evidence of what V1
*says*, not of what V1 *does*.**

## 9. Corrections made during this scan

| Claim | Reality | Caught by |
|---|---|---|
| "No LIFF surface exists in V1" (verdict *drop*) | 6 routes, 4 pages, and the only consent writer | controller |
| "5 LIFF pages across two paths" | 4 pages under one path; the sibling dirs are empty | audit |
| "`Employee.email` is globally unique" | `@@unique([email, tenantId])` | audit |
| "72 models scanned" | 94 — two "no such model" claims followed from the undercount and were both false | audit |
| "mobile JWTs are unrevocable" | Revocable via `jti` + `ActiveSession`; only legacy pre-FC-13 tokens are weak | gaps pass |
| "16 integrations routes, some non-accounting" | 15, all accounting connectors | gaps pass |

`parity-platform.md` carried four verified errors. Its **conclusions** about auth and
LINE were corroborated independently, but every factual claim in that file must be
re-verified before use.

## 10. Owner decisions this unblocks

1. **Pilot tenant** — must not use `line-bot`, `line-monitor`, Instagram or WhatsApp.
2. **Pilot module** — candidates with no money, no LINE and no cross-module wires:
   `tasks` (self-contained, though it needs an RBAC domain first) or
   `(dashboard)/overview` (read-only).
3. **Is `line-monitor` still in real use?** If not, it stops being a blocker.
4. **Does `Tenant.plan` gate anything today?** Billing is a scaffold; if the plan field
   is decorative, billing drops out of the must-have set.
5. **Are there real staff working across two tenants?** That is what makes the login
   non-determinism (§7) a live incident rather than a latent bug.
