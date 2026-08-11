# P9 — Coverage Gaps (the seventh scan)

Scope: the six areas the cross-area audit (`parity-audit.md`) found claimed by nobody —
SaaS billing/subscription, `api/tasks` + `Task` model, `(dashboard)/overview`, `api/mcp`,
`auth/mobile-login`, the 9 unclaimed `integrations/*` routes, and `settings/*` +
`(dashboard)/settings/mobile/*`. All findings below are independently verified against
`G:\zuri` source (read-only); where I confirm or correct a `parity-audit.md` claim I say so.

---

## 1. Area tables

### 1.1 SaaS billing / subscription

| | |
|---|---|
| **API routes** | 2: `api/webhooks/billing/route.js` (PSP webhook, no auth session — HMAC-signed), `api/settings/billing/route.js` (GET, session-authed) |
| **Pages** | `(dashboard)/settings/mobile/billing/page.jsx` (mobile, read-only display, see §1.7) — desktop billing UI not found under `(dashboard)/settings` in this pass, "cannot tell from code" whether a desktop billing tab exists beyond the API |
| **Prisma models** | `Subscription`, `BillingEvent`, `PaymentMethod` (all `schema.prisma:122-256`, tagged "FC-11b / ADR-084 / FEAT-026"); `Tenant.plan` is the pre-existing denormalised cache these mirror |
| **Workers touched** | none — webhook is request-driven, not polled |
| **Evidence of real use** | `src/lib/repositories/billingRepo.js` + `.test.js`, `src/lib/billing/plans.js` + `.test.js`, webhook has `.test.js`. Provider fields (`Subscription.provider`, `providerCustomerId`) are all nullable/unwired — no PSP (Stripe/Omise/2C2P) is actually integrated yet; the webhook accepts either signature shape defensively. No evidence of a live PSP account or a mint/upgrade-plan endpoint (the mobile "Upgrade Plan" button has no handler — see §1.7) |
| **Verdict** | **later** |
| **Cutover risk** | **H** |
| **Why** | Real side-effect owner (writes `Tenant.plan`, `Subscription`, `BillingEvent`) but currently a scaffold with no PSP wired — the actual plan-flip logic (`resolvePlan`) is a substring match on `priceId`, fragile. Treat as must-design-before-cutover (it is one of the six flip owners, see §2) but not must-build-now since nothing production-real depends on it yet. Confirms `parity-audit.md` §5.E's inclusion of the billing PSP webhook as a cutover flip point. |

### 1.2 Tasks

| | |
|---|---|
| **API routes** | 2: `api/tasks/route.js` (GET list, POST create), `api/tasks/[id]/route.js` (GET, PATCH, DELETE) |
| **Pages** | `(dashboard)/tasks/page.jsx` |
| **Prisma models** | `Task` (`schema.prisma:1615`) — `customerId`, `assigneeId`, `createdById`, `type` (default `FOLLOW_UP`), `taskType` (`SINGLE|RANGE|PROJECT`), `priority` (`L0`…`L5`), `milestones Json`, `notionId` |
| **Workers touched** | **none.** `(dashboard)/tasks/CLAUDE.md` claims "Due date notification ผ่าน LINE Push … ใช้ QStash cron" — grepped every file under `api/workers/**`, no worker touches `Task`/`taskRepo`. This claim in the module doc is **stale/aspirational**, not implemented |
| **Evidence of real use** | Created from two real call sites: (1) staff via `POST /api/tasks`, `(dashboard)/tasks/page.jsx`; (2) **AI automation** — `src/lib/services/actionExecutor.js` case `CREATE_TASK` (line ~140) creates a `Task` tied to `customer.id` as an automation action, e.g. "follow up on quote {{quoteNo}}". Re-exported as a first-class module at `src/modules/core/tasks/index.js`. Has integration test `tests/integration/modules/tasks-page.test.jsx` and is fetched by `PresentationDemoBridge.jsx` |
| **Verdict** | **must-have** (as CRM follow-up tracking — see §4) |
| **Cutover risk** | **M** |
| **Why** | Real, actively-created-by-automation data (not dead code), but not a project-management concept — see §4. RBAC gap: **no `'tasks'` domain exists in the permission matrix** (`ADR-068`); comment at `api/tasks/route.js:34` says gating on it 403'd every role including OWNER, so all three routes fall back to "authenticated-only" — any employee of any role can read/write/delete any tenant's task once authenticated. Worth a decision before migrating: replicate the open-access behavior or tighten it. |

### 1.3 `(dashboard)/overview`

| | |
|---|---|
| **API routes** | none directly — `overviewActions.js` are Server Actions (`fetchOverviewStats`, `fetchMetricsSnapshot`), not `api/*` routes |
| **Pages** | `page.jsx`, `OverviewPageClient.jsx`, `actions/page.jsx`, `overviewActions.js` (+`.test.js`), `SmartGiftMetricsSection.jsx` (+`.test.jsx`) |
| **Prisma models owned** | none — read-only aggregation over existing models (orders, customers, etc. via `fetchOverviewStats`) |
| **Workers touched** | none |
| **Evidence of real use** | **This is the post-login landing page.** `src/middleware.js:31` returns `/overview` as the default home path, and `middleware.js:307-314` does device-based post-auth routing keyed off `pathname === '/overview'`. `overviewActions.js` is 150 lines, purely read (`fetchOverviewStats`, `fetchMetricsSnapshot` — the latter comment-tagged "CR-010 — SmartGift BI section"), has a test file. No writes found in either action |
| **Verdict** | **must-have** |
| **Cutover risk** | **M** |
| **Why** | ADR-003 §D2 names "any overview/report whose mental model is 'one shop'" as a lift exception (i.e., reuse as-is) — this is exactly that page, and it is the first thing every user sees after login, so a broken or missing V2 landing page is a day-one visible regression for every migrated tenant. Purely read-only, so risk is about UX parity/timing, not data-safety. |

### 1.4 `api/mcp`

| | |
|---|---|
| **API routes** | 1: `api/mcp/route.js` — `GET` (manifest, **no auth**), `POST` (JSON-RPC-shaped `initialize` / `tools/list` / `tools/call`, `withAuth(domain:'customers', action:'R')`) |
| **Pages** | none |
| **Prisma models** | none directly touched — the four declared tools (`list_customers`, `get_customer`, `list_conversations`, `list_orders`) target `Customer`, `Conversation`, `Order` but every `tools/call` branch is a **stub**: each `case` returns a hardcoded empty result (`JSON.stringify([])` or `null`) with a `// TODO: Import ... and call ...` comment. **No repository is actually called anywhere in this file.** |
| **Workers touched** | none |
| **Evidence of real use** | No test file found for `api/mcp`. No other file in the repo imports or calls into this route. It is dead/unfinished code, not a live integration surface, despite the module doc-comment describing it as "Exposes structured tools that AI agents can call to interact with CRM data" |
| **Verdict** | **drop** (as currently implemented) — or **rebuild** if MCP-based agent access to CRM data is a real V2 requirement |
| **Cutover risk** | **L** (nothing to migrate — it does not work today) |
| **Why** | Contradicts the premise that this is "an MCP server reportedly exposing CRM tools to AI agents" doing anything today — it exposes a *manifest* of tools and answers `tools/list`, but every actual `tools/call` is a no-op stub. The only live behavior is: an unauthenticated caller can `GET /api/mcp` and learn the tool schema (minor information disclosure — tool names/shapes, no data); an authenticated caller (cookie or mobile Bearer JWT) can `POST` and get back empty arrays. See §3 for the auth mechanism, which is real even though the payload behind it is not. |

### 1.5 `auth/mobile-login`

| | |
|---|---|
| **API routes** | 3 in this cluster: `auth/mobile-login/route.js` (issue), `auth/mobile-logout/route.js` (revoke, has `.test.js`), `auth/change-password` (out of named scope but shares the session-revocation mechanism) |
| **Pages** | none (native-client-facing) |
| **Prisma models** | `ActiveSession` (session registry, keyed by `jti`), `Employee` (`lastLoginAt`, `lastLoginIp`, `deviceId` updated on login) |
| **Workers touched** | none |
| **Evidence of real use** | `session-manager.js` (`registerSession`/`validateSession`/`revokeSession`) is shared with the web NextAuth path — not a parallel throwaway implementation. Suspicious-login LINE alert (`alertSuspiciousLogin`) fires on IP/device change |
| **Verdict** | **must-have** |
| **Cutover risk** | **H** |
| **Why** | Second, independent auth path that mints its own 30-day bearer JWT — see §3 for the full authentication analysis. `parity-audit.md`'s claim that these tokens are "unrevocable" is **only half right** after checking `src/lib/auth.js:190-211**: current-generation tokens (with a `jti`) **are** individually revocable via the same `validateSession`/`ActiveSession` path as web sessions (mobile-logout, password change, tenant soft-delete all revoke them). Only **legacy tokens minted before this `jti` wiring** (no `jti` claim) fall back to a weaker check — soft-delete-only, good for up to 30 days regardless of logout. This is a meaningful, quotable correction to the audit — see §3. |

### 1.6 `integrations/*` not covered before

| | |
|---|---|
| **API routes** | **15 found**, not 16 (see discrepancy note below): `accounting/{route,export,reconciliation,retry,sync-logs,sync-status,tax-mapping}` (7), `flowaccount/{connect,disconnect,callback}` (3), `express/{connect,test}` (2), `peak/connect` (1), `sage/{connect,callback}` (2) |
| **Pages** | `(dashboard)/settings/mobile/integrations/page.jsx` (mobile) — calls `/api/tenant/integrations`, a route **outside** this directory entirely (not reviewed here — out of named scope) |
| **Prisma models** | `IntegrationConfig` (provider-keyed, `tenantId_provider` unique) — shared by all five providers |
| **Workers touched** | `workers/accounting-sync`, `workers/accounting-reconciliation`, `workers/sync-accounting`, `workers/sync-express` (named-provider workers exist for accounting/express specifically) |
| **Evidence of real use** | `accounting/route.test.js` exists; the others (`express`, `peak`, `sage`) have no test files found. `peak/connect` has an inline comment ("FC-01") noting a *previous* hardcoded validation URL was wrong and has been disabled pending a real `PEAK_API_URL` — i.e. Peak validation is currently a no-op unless that env var is set |
| **Verdict** | **later** for `express`/`peak`/`sage` (unproven, thin), **must-have** for `accounting`/`flowaccount` core sync/export (has tests, has a matching worker) |
| **Cutover risk** | **M** |
| **Why — and the framing correction** | **Every one of the 15 routes is `domain: 'accounting'` RBAC-gated and is a connector to an accounting-software product** (FlowAccount, Peak, Sage, and "Express" — `src/lib/accounting/ExpressAdapter.js`'s `generateXImportFile`/`sendToAccountant` confirm Express is also an accounting-export integration, not a shipping/logistics one). **There are no integration routes in this directory that fall outside "FlowAccount/accounting."** The task framing ("cover the ones that are not FlowAccount/accounting") does not hold against the code — flagged explicitly per instructions rather than guessed around. |

### 1.7 `settings/*` and `(dashboard)/settings/mobile/*`

| | |
|---|---|
| **API routes** | 7 under `api/settings/**`: `billing` (§1.1), `export`, `notifications`, `ownership`, `ownership/verify`, `profile`, `workspace` |
| **Pages** | 8 under `(dashboard)/settings/mobile/**`: `page.jsx` (index), `billing`, `danger`, `general`, `integrations`, `notifications`, `team`, `workspace`, plus `_components/MobileSettingsHeader.jsx` |
| **Prisma models** | none new — `Tenant` (`deletedAt`, brand/currency/vat fields), `Employee` (profile/notification-pref fields), `OwnershipTransferRequest` (ADR-077) |
| **Workers touched** | none |
| **Evidence of real use** | `settings/workspace` (soft-delete), `settings/ownership`+`/verify` (OTP-gated OWNER-role transfer) are fully wired, audited (`auditAction`/`logSystemEventTx`), and tested by design (transactional, typed-confirmation UX). Mobile pages are a **mixed bag** — see risk note |
| **Verdict** | **must-have** for `ownership`, `workspace` (delete), `export`; **later/drop** for the mobile Danger Zone and Billing pages as currently built (dead UI, see below) |
| **Cutover risk** | **H** for `ownership`/`workspace`; **L** for the dead mobile UI (nothing to migrate — it doesn't do anything today) |
| **Why** | Two genuine side-effect owners live here (§2). Separately, and worth flagging loudly: **`(dashboard)/settings/mobile/danger/page.jsx` (the mobile Danger Zone — Export + Delete Workspace) has zero `onClick` handlers on either button** — `grep -n "onClick"` returns nothing in that file. The buttons render, the delete button is even wired to a `disabled` state driven by typed-confirmation text matching the tenant name, but neither button does anything. Likewise `(dashboard)/settings/mobile/billing/page.jsx` has **zero `fetch()` calls** — "Upgrade Plan" is an inert button, "Payment Method" and "Billing History" sections are hardcoded empty-state copy, never calling `GET /api/settings/billing`. This means the real workspace-delete and billing-view logic is **desktop-only today** (`/settings` full page, referenced by both mobile pages' "จัดการ...แบบเต็มบน Desktop" links) — the team-invite UI mentioned in the task brief (§1.7 continued below) is, by contrast, fully wired. |
| **Team-invite UI (named in task brief)** | `(dashboard)/settings/mobile/team/page.jsx` — real, calls `GET/POST/DELETE /api/team/invite[/​{token}]`. That API is under `src/app/api/team/**`, **outside** `src/app/api/settings/**`, so it is technically outside this area's API-route line item, but the *page* is squarely in scope and is a genuine side-effect owner (§2) — grants tenant access via emailed invite link. |

---

## 2. Side-effect owners (send money, messages, or grant access)

Per-tenant flip: **yes** for all of these — every one reads `tenantId` from the session/key/webhook payload and scopes all writes to it; none loop across tenants.

| Owner | What it does | Per-tenant flip? |
|---|---|---|
| `api/webhooks/billing` | Writes `Tenant.plan`, `Subscription`, `BillingEvent` on PSP callback | Yes — keyed by `data.tenantId`/`data.metadata.tenantId` in the payload |
| `TenantApiKey` (`export/events`, and `import/snapshots` per the model comment) | Machine auth grants read/write access to a tenant's outbound/inbound data feed | Yes — `withApiKey` resolves tenant **from the key hash only**, never from the request; per-tenant issuance/revocation (`revokeApiKeyByPrefix`) |
| `auth/mobile-login` | Issues a 30-day bearer JWT granting full API access as that employee | Yes, but **imperfectly** — see §3; legacy (no-`jti`) tokens are not individually revocable, only globally via workspace soft-delete |
| `settings/ownership` + `/verify` | Grants OWNER role to another employee; sends OTP email; force-logs-out both parties via Pusher | Yes — entirely tenant-scoped, atomic transaction |
| `settings/workspace` (DELETE via POST) | Soft-deletes the tenant (`Tenant.deletedAt`), revokes **every** active session tenant-wide | Yes — `revokeTenantSessions(tenantId)` |
| `api/team/invite` (UI lives in scope at `settings/mobile/team`) | Grants tenant access via emailed invite token; creates `Invitation` row | Yes — tenant-scoped throughout |

**This is six.** `parity-audit.md` §5.E already names three of these (billing webhook, `TenantApiKey`, mobile-login JWTs) as additions to ADR-003 D8's flip list. **This pass adds three more that the cutover checklist should also carry: `settings/ownership`, `settings/workspace` (soft-delete + tenant-wide session revoke), and `team/invite`.** All three are OWNER/ADM-gated access-granting or access-revoking actions that, like the other three, must move atomically with a tenant's cutover — flipping a tenant to V2 mid-ownership-transfer or mid-invite would leave a live OTP/invite token honored by the wrong system.

---

## 3. Machine authentication

**`api/mcp`** — `POST` is `withAuth(handler, { domain: 'customers', action: 'R' })`, i.e. it accepts the **same two credentials as any other API route**: a NextAuth session cookie, or (per `getBearerSession`, see below) a mobile Bearer JWT. `GET` (manifest) has **no auth at all** — confirmed by reading the file: `GET` has no `withAuth` wrapper, just a comment `// TODO: Optionally require authentication for tool discovery`. Token lifetime/revocability for the `POST` path is identical to whichever credential the caller used (session or mobile JWT, below) — there is no MCP-specific credential.

**`auth/mobile-login`** — issues:
```js
const token = await new SignJWT({
  sub: employee.id, employeeId: employee.employeeId, tenantId: employee.tenantId,
  email: employee.email, role: employee.role, roles: employee.roles,
  name: `${employee.firstName} ${employee.lastName}`, plan: tenant?.plan ?? 'STARTER',
})
  .setProtectedHeader({ alg: 'HS256' })
  .setJti(jti)
  .setIssuedAt()
  .setExpirationTime(TOKEN_TTL)   // TOKEN_TTL = '30d'
  .sign(JWT_SECRET)               // JWT_SECRET = NEXTAUTH_SECRET (shared with web sessions)
```
- **Lifetime:** 30 days, HS256, `NEXTAUTH_SECRET`-signed — the **same secret** web NextAuth sessions use.
- **Revocable:** yes, for current-generation tokens. Verification in `src/lib/auth.js:190-200`:
  ```js
  if (isBearer && session.user.sessionId) {
    // FC-13: mobile tokens carrying a jti are tracked in ActiveSession ...
    const isValid = await validateSession(session.user.id, session.user.sessionId)
    if (!isValid) { return 401 SESSION_REVOKED }
  }
  ```
  `mobile-login` registers the `jti` as an `ActiveSession` row (`registerSession`), and `mobile-logout` deletes it (`revokeSession`). Password change and the 10-concurrent-session cap also evict rows here. **Legacy tokens without a `jti`** (minted before this wiring) fall back to a weaker branch (`src/lib/auth.js:201-211`) that only checks tenant soft-delete — those are effectively unrevocable for up to 30 days.
- **Tenant-scoped:** yes — `tenantId` is a JWT claim, read by `withAuth`'s `getBearerSession`, and `runTenantScoped` opens the same `AsyncLocalStorage` guard used for web sessions.
- **Fallback-secret risk (worth flagging):** both `mobile-login/route.js:6` and `auth.js:115` fall back to the literal string `'dev-secret-change-in-prod'` if `NEXTAUTH_SECRET` is unset. Not evaluated further per the "never read `.env`" rule — flagging as an open question (§6) rather than checking the deployed value.

**`TenantApiKey` (`export/events`, machine auth for CR-008's outbound feed)** — `src/lib/apiKeyAuth.js`:
```js
export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex')
}
...
const keyHash = hashApiKey(rawKey)
const apiKey = await findKeyByHash(keyHash)
if (!apiKey || apiKey.revokedAt) return errorResponse(401, 'Unknown or revoked API key')
if (scope && !(apiKey.scopes ?? []).includes(scope)) return errorResponse(403, ...)
```
- **Lifetime:** no `expiresAt` field on `TenantApiKey` (`schema.prisma:189-203`) — keys **do not expire**, they are revocable-only (`revokedAt`).
- **Revocable:** yes — `revokeApiKeyByPrefix(tenantId, prefix)` sets `revokedAt`; checked on every request.
- **Tenant-scoped:** yes, and by design cannot be overridden by the request — the code comment states "tenant FROM THE KEY ONLY (a tenantId in the request is never read here". The tenant is a property of the key hash lookup itself.
- **Minting:** no HTTP mint endpoint exists — `createApiKey` is called only from `scripts/onboard/tenant-api-key.mjs`, an operator script. This means key issuance is out-of-band (not through this API surface), which limits blast radius but also means there is no self-serve rotation path today.

---

## 4. V1 `Task` vs V2 work item

**Different concept — both should exist, no migration.**

- V1 `Task`: `customerId` FK (CRM-anchored), `type` defaults to `FOLLOW_UP`, `assigneeId` is an `Employee` FK, created both by staff and by the AI automation engine (`actionExecutor.js` `CREATE_TASK` case, e.g. "ตามใบเสนอราคา {{quoteNo}}" — follow up on a quote). Its `PROJECT` `taskType` + `milestones Json` variant is documented (`(dashboard)/tasks/CLAUDE.md`) as `brief | review | meeting | submit | other` milestones — a lightweight checklist, not a structured project.
- V2 `WorkItem` (`zuri-v2-lab/prisma/schema.prisma`): belongs to a `workstreamId`/`containerId` (project-structure-anchored, **no `customerId`**), carries `weight`, `numericValue`, `probability`, `metricDataJson` for the progress roll-up calculators the V2 PM module is built around. `assigneeRef` is a free string, not an FK.
- These are genuinely different domain objects: V1 `Task` is "a CRM follow-up reminder, occasionally with a checklist," anchored to a *customer*; V2 `WorkItem` is "a unit of project work," anchored to a *workstream/container*, with no customer relationship at all.
- **Evidence this is a live, used concept (not dead code):** real call sites from both a human path (`(dashboard)/tasks/page.jsx`, `POST /api/tasks`) and an automated one (`actionExecutor.js`), an integration test, and a dedicated module export (`src/modules/core/tasks/index.js`).

**Verdict: coexist.** V1 `Task` should migrate as CRM data (follow-ups tied to customers) alongside the rest of the CRM domain, not be merged into or replaced by V2's Project Manager work items. The "PROJECT" `taskType` + `milestones` overlap is real but shallow (a JSON checklist vs. a full roll-up-progress module) — see open questions.

---

## 5. Found — no scan would have covered this

- **`(dashboard)/settings/mobile/danger/page.jsx` is dead UI.** Zero `onClick` handlers on the Export and Delete Workspace buttons — confirmed by direct grep, not inference. Worth flagging beyond this pass's scope note in §1.7 because a migration plan built from "the mobile app can delete a workspace" (a reasonable inference from the page existing) would be planning for a capability that does not exist in the code today.
- **`api/dev/{seed,debug-pos}` and `api/uat/feedback`** — three routes under directories a domain-focused scan would skip past by name alone (`dev`, `uat` don't map to any product area). `dev/seed` is guarded (`NODE_ENV === 'production'` → 403) but still ships in the production bundle; worth a one-line note for whoever owns the security-debt backlog, not fixed here per the "read only" constraint on `G:\zuri`.
- **`src/lib/accounting/ExpressAdapter.js`** — confirms "Express" (an integrations provider name that reads ambiguously — could be logistics) is in fact another accounting-software connector (`generateXImportFile`, `sendToAccountant`), closing the loop on §1.6's framing correction.

---

## 6. Open questions for the owner

1. **Billing PSP identity.** `Subscription.provider` is nullable and no PSP is wired (§1.1). Is Stripe/Omise/2C2P selection already decided elsewhere, or does V2 billing start from zero? Changes whether §1.1 is "later" or "must-design-now."
2. **Legacy (no-`jti`) mobile JWTs.** How many, if any, unrevocable pre-FC-13 tokens are still live in production? Cannot be determined from code — this is a database-state question. Changes cutover risk on §1.5 from "revocable, minor edge case" to "an active unrevocable-access problem" if the count is non-zero.
3. **`NEXTAUTH_SECRET` fallback.** Both mobile-login and its verifier fall back to a hardcoded dev string if the env var is unset. Is this env var confirmed set in every deployed environment? (Not checked here — `.env` reading is prohibited by the task's constraints, and even confirming *presence* of the var would require reading deployment config, not just code.)
4. **`api/mcp`'s intended scope.** Given every `tools/call` branch is a stub, is MCP-based agent access to CRM data still a V2 requirement? If yes, verdict is "rebuild"; if the feature was abandoned mid-build, verdict is "drop." Changes §1.4's verdict directly.
5. **V1 `Task`'s `PROJECT` taskType / `milestones` overlap with V2 PM.** Is there any intent to let V1 Tasks with `taskType: PROJECT` become V2 `WorkItem`s in some tenants (e.g., schools running lightweight internal projects through Tasks today), or is the overlap coincidental and both stay fully separate forever? Affects whether §4's "coexist" verdict needs a one-time reconciliation pass for that subset.

---

## Writer Report — P9 Coverage gaps
**Status**: DONE
**Areas covered**: SaaS billing/subscription, Tasks (API + model + module), `(dashboard)/overview`, `api/mcp`, `auth/mobile-login` (+ mobile-logout), all 15 `integrations/*` routes, all 7 `settings/*` API routes, all 8 `(dashboard)/settings/mobile/*` pages
**Verdict counts**: must-have 5 (tasks, overview, mobile-login, settings/ownership+workspace+export, accounting/flowaccount core) · later 3 (billing/subscription, express/peak/sage integrations, mobile billing+danger UI) · drop 1 (api/mcp as currently implemented) · rebuild 0 (conditional — see open question 4)
**New side-effect owners found**: `settings/ownership` (+`/verify`), `settings/workspace` (soft-delete + tenant-wide session revoke), `team/invite` (UI confirmed live at `settings/mobile/team`) — three beyond the audit's existing billing-webhook/TenantApiKey/mobile-JWT trio, bringing the cutover-checklist total to six as this pass's own count, not the same six the audit named
**V1 Task verdict**: different concept from V2 WorkItem (customer-anchored CRM follow-up vs. workstream-anchored project unit) — coexist, migrate as CRM data, no merge
**Still uncovered after this pass**: `api/tenant/integrations` (called by the mobile integrations settings page but not itself under `settings/**` or `integrations/**` — falls between named areas), `auth/change-password` (touched only incidentally here), the five unclaimed `ai/*` routes and `api/metrics/snapshot`/`api/analytics/sales-kpi`/`api/daily-brief/[date]`/`api/push/subscribe`/`api/pusher/auth` that `parity-audit.md` §Gap-5 also flagged as unowned and which remain outside this task's named scope
