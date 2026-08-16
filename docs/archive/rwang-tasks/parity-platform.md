# Parity Inventory — PLATFORM (V1 `G:\zuri`)

Read-only inventory. `auth`, `tenant`, `settings`, `admin`, `integrations`, `webhooks`,
`liff` (+ onboarding, billing/plan, API keys, audit). All paths relative to `G:\zuri`
unless stated otherwise.

## 0. Headline facts

- ~~**No LIFF surface exists in V1.**~~ **← CORRECTED BY CONTROLLER, 2026-08-12. This
  finding is wrong.** V1 has a full LIFF surface, verified directly:
  **4 pages**, all under one path: `src/app/(liff)/liff/[tenantSlug]/{page,consent,courses,orders}` (the sibling `(liff)/[tenantSlug]/{courses,orders}` directories are empty — the controller's first correction said '5 pages across two paths' and was itself wrong; verified 2026-08-12),
  and six API routes at `src/app/api/liff/{auth,consent,courses,enrollment,orders/me,payment/[id]/slip}`.
  The P2 Customer scan independently found that `POST /api/liff/consent` is **the only
  place PDPA consent is actually written** in the whole system. Treat the `liff` rows
  below as void; LIFF is **must-have**, not "drop". Everything else in this report was
  spot-checked against the P1/P2 scans and stands. Original (incorrect) text follows:
  Exhaustive grep for `liff` (case-insensitive) across
  `src/**/*.{js,jsx,ts}` returns zero hits. No `(liff)` route group, no LIFF SDK import,
  no `NEXT_PUBLIC_LIFF_ID`-style env var. Whatever V2's LIFF intake surface is, it is new
  build, not lift.
- **Employee is single-tenant by construction, including at the DB constraint level.**
  `Employee.email` is `@unique` **globally** (`prisma/schema.prisma:56`), not
  `@@unique([tenantId, email])`. One email can be an active employee of exactly one
  tenant system-wide today. This is the exact constraint the Person+Membership rebuild
  must lift.
- **Two API endpoints are permanently broken by an RBAC domain typo.** `PATCH /api/tenant/config`
  and `PATCH /api/tenant/integrations` both call `withAuth(handler, { domain: 'tenant', action: 'W' })`,
  but `'tenant'` is not a key in `permissionMatrix` (`src/lib/permissionMatrix.js:29-38` — domains
  are `dashboard, customers, inbox, marketing, kitchen, orders, employees, accounting, audit,
  system, team, ownership, enrollments`). `can(roles, 'tenant', 'F')` reads
  `permissionMatrix[role]?.['tenant']` → always `undefined` → always `403`, for every role
  including OWNER/DEV. **Tenant branding config and tenant integration-credential writes are
  unreachable via normal RBAC in the current build.** Confirm before assuming any V1 behavior
  here is "working" — it is not currently exercisable.
- **Session revocation/pinning is implemented but disabled.** `validateSession()` in
  `src/lib/session-manager.js` and its call sites in `src/lib/auth.js` (`requireAuth`,
  `withAuth`) are commented out with `// TEMPORARY BYPASS (ZDEV-TSK-20260412-018)`. A revoked
  or session-limit-evicted `ActiveSession` row has **no effect** — the JWT keeps working until
  it expires on its own. This is a live security gap, not a style note.
- **Middleware fails open on error**, and was mid-incident as of the last edit: `src/middleware.js`
  header comment reads "v5.0.0: Restored Auth Gate + Page RBAC + Safety Net … Closes: INC-20260412-004",
  and `src/middleware.js.bak` (the pre-incident version, still committed) shows the auth gate /
  RBAC logic was structured differently before. The live file wraps everything in
  `try { … } catch (err) { … return NextResponse.next() }` — any unhandled middleware error
  **lets the request through unauthenticated** rather than blocking it.

---

## 1. Sub-area tables

### auth (NextAuth credentials + session)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| auth | 2: `api/auth/[...nextauth]/route.js`, its `auth-config.js` (not a route, config module) | `(auth)/login`, `(auth)/register`, `(auth)/onboarding` | `Employee`, `ActiveSession` | none directly; `session-manager.js` writes `ActiveSession` from the NextAuth `jwt` callback | `src/lib/auth.test.js`, `src/middleware.test.js`, `src/hooks/useSession.test.js` exist and exercise this path | **rebuild** | H | This is exactly the piece ADR-003 says gets replaced (Employee→Person+Membership, tenant-scoped→cross-business). Nothing here should be lifted as-is; the RBAC domain model (`permissionMatrix.js`) and page-ACL shape in middleware are worth carrying as reference, not the identity model. |

### tenant (resolution, branding/config, per-tenant integration credentials)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| tenant | 3: `api/tenant/config` (GET public, PATCH broken — see §0), `api/tenant/integrations` (PATCH broken — see §0), `api/tenants` (list, unauth-shape unknown, see file) | `(dashboard)/tenants/page.jsx` (65 lines), `admin/tenants/page.jsx` (198 lines) | `Tenant` | none | `resolveTenantBySlug` cached via Redis, read on every page load through `TenantContext.jsx` — this is real, high-traffic code | **must-have** (resolution + config schema) / **rebuild** (write path, since it's broken and RBAC domain needs fixing anyway) | H | `Tenant.config` (Json) carries branding/vatRate/currency/timezone — V2 must carry this schema forward even though the write endpoint needs a real fix, not a lift. |

### settings (ownership transfer)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| settings/ownership | 2: `api/settings/ownership` (GET/POST/DELETE), `api/settings/ownership/verify` | `(dashboard)/settings/page.jsx` (956 lines — large, likely the general settings hub, not ownership-specific) | `OwnershipTransferRequest`, `SystemAuditLog` | none | OTP-based transfer flow (`bcrypt` hash, email OTP via `sendOwnershipOtpEmail`), audited via `logSystemEventTx` — well-built (ADR-077/ZUR-20/FEAT21) | **must-have** | M | Sound design (OTP + audit) worth carrying conceptually into Person/Membership "who owns this business" transfer; the Employee-role check (`role: 'ADM'`) needs remapping to Membership roles. |

### admin (impersonation, tenant admin, usage, backfills)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| admin | 5: `api/admin/impersonate`, `api/admin/tenants/[id]`, `api/admin/usage`, `api/admin/backfill-owners`, `api/admin/backfill-ingredient-tenants` | `admin/layout.jsx`, `admin/page.jsx`, `admin/tenants/page.jsx`, `admin/usage/page.jsx` | reads `Tenant`, writes Redis audit list (`admin:audit:impersonate`) not a Prisma table | none | Impersonation issues a Redis-backed short-lived token + structured `console.log` audit + Redis list; middleware explicitly whitelists `/api/admin/*` as "secret-protected internally" — **meaning admin routes bypass the normal auth gate in middleware and rely on each route's own check** | **must-have** (impersonation + tenant admin) / **later** (backfill scripts, one-off migration tooling) | H | Impersonation audit trail lives only in Redis (`lpush` capped at 100 entries, no DB table) — not durable, not queryable, no retention policy. If V2 needs compliance-grade impersonation audit this must move to a real audit table. Also note middleware's blanket `pathname.startsWith('/api/admin/')` public passthrough (`src/middleware.js:108`) means every admin route is individually responsible for its own auth — `withAuth` is used consistently in the ones read, but this is worth re-verifying for the two not read (`backfill-*`). |

### integrations (FlowAccount OAuth, generic accounting sync)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| integrations/accounting | 7: `api/integrations/accounting` (+`.test.js`), `.../accounting/export`, `.../accounting/sync-logs`, `.../flowaccount/connect`, `.../flowaccount/callback`, `.../flowaccount/disconnect` | `(dashboard)/integrations/page.jsx` (244 lines) | `IntegrationConfig`, `IntegrationSyncLog`, `IntegrationDocumentRef` | `api/workers/sync-accounting/route.js`, `api/workers/sync-hourly/route.js` | Full OAuth2-PKCE flow with Redis-backed CSRF `state` bound to `tenantId`, has a route-level test file — real feature | **must-have** | M | Token encryption uses a **second, separate** key (`ACCOUNTING_ENCRYPTION_KEY`, AES-256-GCM, `src/lib/crypto.js`) distinct from the one used for LINE/FB tokens (`TOKEN_ENCRYPTION_KEY`, `src/lib/crypto/tokenEncryption.js`). Two crypto modules doing the same job with different keys — a lift blocker if V2 wants one key-management story. |

### webhooks / LINE / Facebook

See §3 (LINE integration map) for full detail — summarized here.

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| webhooks | 4: `api/webhooks/line`, `api/webhooks/line-bot`, `api/webhooks/line-monitor`, `api/webhooks/facebook` | none (webhook-only) | writes `Conversation`, `Message`, `Customer` via repos | none directly, but feeds `api/workers/crm-enrich`, `sync-messages` | `src/tests/integration/inbox-webhook.test.js` exists | **rebuild** (consolidate 3 LINE endpoints into 1 tenant-routed one) | **H** | Three separate LINE webhook handlers with three different, inconsistent tenant-resolution/secret strategies (§3). This is the single highest-risk item in the whole platform area. |

### team (invite / join — adjacent, FEAT21)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| team | 3: `api/team/invite`, `api/team/invite/[token]`, `api/team/join` | `join/page.jsx` (179 lines, public) | `InvitationToken` | none | RBAC-checked (`can(roles,'team',...)`), audited (`SystemAuditLog`), public join page explicitly whitelisted in middleware | **must-have** | M | Clean invite→OTP-free join flow; role is Employee.role today, needs Membership-role remapping. Good reference implementation for V2's Person onboarding. |

### permissions (matrix exposure)

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| permissions | 1: `api/permissions` (GET) | none | none (returns static `permissionMatrix` object) | none | `permissionMatrix.test.js` | **later** | L | Simple read of a static object; the matrix *shape* (domain × 6 roles) is the real asset, not the endpoint. |

### liff

| Sub-area | API routes | Pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Risk | Why |
|---|---|---|---|---|---|---|---|---|
| liff | **6** (`auth`, `consent`, `courses`, `enrollment`, `orders/me`, `payment/[id]/slip`) | **4** (`(liff)/liff/[tenantSlug]/{page,consent,courses,orders}`) | — | — | **VOID ROW — see the correction in §0.** Customer-facing, tenant-slug routed, and the only consent write path in the system | **must-have** (corrected) | **H** | Corrected by controller: the original 'absent' finding was false. Re-scan needed before this area is planned. |

---

## 2. Auth & session map

**Login → session:**
1. `POST /api/auth/[...nextauth]` (NextAuth `CredentialsProvider`), config in
   `src/app/api/auth/[...nextauth]/auth-config.js`.
2. `authorize()` looks up `Employee` by email (`findByEmail`, `src/lib/repositories/employeeRepo.js`),
   compares `bcrypt.compare(password, employee.passwordHash)`. One dev/mock backdoor:
   `isMockMode && email === 'admin@vschool.io' && password === 'admin'` bypasses bcrypt entirely
   — gated on `isMockMode` from `src/lib/mockMode.js`, worth confirming that flag can never be
   true in production before assuming it's inert.
3. On success, `jwt` callback stamps `token.{employeeId, role, roles, tenantId, tenantSlug, isActive}`
   and calls `registerSession()` (`src/lib/session-manager.js`) which writes an `ActiveSession` row
   keyed by `sessionId = token.jti`, enforces `MAX_CONCURRENT_SESSIONS = 10` by evicting the oldest,
   and fires a LINE DM security alert (`sendLineText`) to the employee's own `lineUserId` if IP/device
   changed — this reuses the tenant's own `lineChannelToken`, an interesting existing pattern of
   "system talks to a user over LINE using the tenant's own channel."
4. **Session lives in the JWT** (`session: { strategy: 'jwt' }`), not server-side lookups per request.
   The `ActiveSession` DB table exists purely as a side audit/eviction structure; nothing in the hot
   path re-validates against it (see §0 — `validateSession` is bypassed).
5. `session` callback copies `token.*` onto `session.user.*`, including `tenantId`, `role`, `roles`.

**Permission resolution:** `src/lib/permissionMatrix.js` — a static object, 6 tenant roles
(`OWNER, MANAGER, SALES, KITCHEN, FINANCE, STAFF`) + 1 hidden internal role (`DEV`), each mapped
to one of `F/A/R/N` per domain (`dashboard, customers, inbox, marketing, kitchen, orders,
employees, accounting, audit, system, team, ownership, enrollments`). `can(roles, domain, action)`
is the single check function, called from:
- `withAuth()` HOC (`src/lib/auth.js`) — wraps almost every API route handler.
- `src/middleware.js` — an **independently inlined copy** of the same matrix (not imported, to
  keep Edge runtime bundle-safe) plus a `PAGE_ACL` array for coarse page-prefix gating. Two copies
  of the same table, hand-kept in sync — a drift risk already visible: `middleware.js`'s copy is
  missing the `team` and `ownership` domains that `src/lib/permissionMatrix.js` has (compare
  `src/middleware.js:14-22` vs `src/lib/permissionMatrix.js:29-38`). Pages under those domains
  (there are none currently gated by `team`/`ownership` in `PAGE_ACL`) are unaffected today, but
  the two tables **are not the same data** — a real drift, cite as-is.
- A legacy 12→6 role remap (`normalizeRole` in `auth.js`, duplicated as `LEGACY_MAP`/`normalizeRoles`
  in `middleware.js`) — ADR-068, third copy of mapping logic.

**"One employee, one tenant" assumptions — every one of these needs to change for Person+Membership:**
- `prisma/schema.prisma:56` — `Employee.email String @unique` (global unique, not tenant-scoped).
- `prisma/schema.prisma:52` — `Employee.tenantId` is a single scalar FK, not a join table.
- `auth-config.js:36-46` — the NextAuth `user` object carries exactly one `tenantId`/`tenantSlug`;
  the JWT and session shape structurally cannot hold multiple tenant memberships.
- `src/middleware.js:146` (`slug !== 'vschool' && token.tenantSlug !== slug`) — subdomain routing
  assumes a session is pinned to exactly one tenant subdomain; a session presented on any other
  tenant's subdomain gets redirected, not offered a switcher.
- `src/lib/tenantContext.ts` / `src/lib/db.ts` — the AsyncLocalStorage tenant context holds one
  `tenantId` per async execution scope; there is no concept of "act as tenant B for this one call
  while your session is tenant A."
- `src/app/api/settings/ownership/route.js:51` — ownership-transfer recipient lookup is
  `prisma.employee.findFirst({ where: { id, tenantId, role: 'ADM' } })` — presumes the recipient is
  already an `Employee` of that same tenant.

---

## 3. LINE integration map

**Three independent LINE webhook endpoints, three different tenant-isolation postures:**

| Endpoint | Signature secret | Tenant resolution | Token used to reply | Isolation level |
|---|---|---|---|---|
| `POST /api/webhooks/line` (`src/app/api/webhooks/line/route.js`) | Per-tenant `tenant.lineChannelSecret` (decrypted via `getTenantTokens`), **falls back to `process.env.LINE_CHANNEL_SECRET`** if no tenant match | `destination` field in the LINE payload → `getTenantByLineOaId(destination)` (`tenantRepo.js:98`, `WHERE lineOaId = destination AND isActive = true`) — this is the real multi-tenant path, labeled ADR-056/M5 in comments | not used to reply directly in this handler (inbound logging only) | **Tenant-isolated** — correct model |
| `POST /api/webhooks/line-bot` (`src/app/api/webhooks/line-bot/route.js`) | **Single global** `process.env.LINE_BOT_CHANNEL_SECRET` | Resolves tenant by `destination` too (for data association: which tenant's `Conversation`/`Customer` row to write), but... | ...replies using **one global** `process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN` for every tenant, with a code comment saying so explicitly: `// Use central for now, migrate to tenant.lineChannelToken later` (`line-bot/route.js:51`) | **Partially isolated** — inbound data is tenant-scoped, but every tenant's AI-assistant replies go out over one shared LINE OA. Two tenants sharing this integration would each see the other's bot identity. |
| `POST /api/webhooks/line-monitor` (`src/app/api/webhooks/line-monitor/route.js`) | **Single global** `process.env.LINE_ASSISTANT_CHANNEL_SECRET` | **None** — hardcoded to `DEFAULT_TENANT_ID` for every event, with the comment `// Default tenant for monitoring until dynamic mapping is implemented` (`line-monitor/route.js:47-48`) | **single global** `process.env.LINE_ASSISTANT_CHANNEL_ACCESS_TOKEN` | **Not tenant-isolated at all** — every group/room talking to this LINE OA writes into `DEFAULT_TENANT_ID`'s data regardless of which real tenant it should belong to. |

**Env var names present (values never read):**
`LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (referenced in `tenantRepo.js:81-82` as
fallback), `LINE_BOT_CHANNEL_SECRET`, `LINE_BOT_CHANNEL_ACCESS_TOKEN`,
`LINE_ASSISTANT_CHANNEL_SECRET`, `LINE_ASSISTANT_CHANNEL_ACCESS_TOKEN`, `DEFAULT_TENANT_ID`,
`FACEBOOK_VERIFY_TOKEN`, `TOKEN_ENCRYPTION_KEY` (encrypts `Tenant.lineChannelToken` /
`lineChannelSecret` / `fbPageToken` at rest, AES-256-GCM, `src/lib/crypto/tokenEncryption.js`).

**Per-tenant LINE config storage:** `Tenant.lineOaId`, `Tenant.lineChannelToken` (encrypted),
`Tenant.lineChannelSecret` (encrypted) — `prisma/schema.prisma:20,23-24`. Written via
`PATCH /api/tenant/integrations` (currently unreachable — see §0 bug) or directly via
`updateTenantIntegrations()` in `tenantRepo.js:144`.

**LIFF:** ~~none~~ — **incorrect, see the correction in §0.** Six API routes and five pages exist, tenant-routed by `[tenantSlug]`. The LINE flip checklist below is therefore **incomplete**: LIFF entry points must be added to it before any cutover.

**What has to flip atomically to move one tenant's LINE traffic to another system (ADR-003 §D8):**
1. **The LINE OA webhook URL registration itself**, at LINE's platform (outside this codebase) —
   whichever system's `/api/webhooks/line`-equivalent is registered as the tenant's webhook receives
   100% of that tenant's traffic; there is no dual-delivery.
2. **`Tenant.lineOaId` → tenant lookup must resolve in exactly one system at a time.** Since
   `getTenantByLineOaId` filters on `isActive: true` (`tenantRepo.js:101`), flipping ownership could
   be done by flipping `isActive` in the *old* system the instant the webhook URL is repointed — but
   only if `line-bot` and `line-monitor` are also cut over in the same instant, since they don't
   share the resolution path with `/api/webhooks/line`.
3. **`lineChannelSecret`/`lineChannelToken` must be readable by whichever system currently owns the
   tenant** — these are encrypted with `TOKEN_ENCRYPTION_KEY`; the new system needs either the same
   key material (to decrypt V1's stored value) or a fresh reissue/rotation of the LINE channel
   credentials at hand-off.
4. **The `line-bot` and `line-monitor` webhooks must be re-pointed or disabled together with the
   main one** — because they aren't tenant-routed the same way, "moving tenant X" is not a clean
   per-tenant operation today; `line-monitor` in particular has no tenant concept to move at all
   (everything lands on `DEFAULT_TENANT_ID`).
5. **Any customer-facing conversation state** (`Conversation.agentMode`, in-flight `Message` rows)
   is tenant-scoped in the DB already, so historical data doesn't need to move — only the live
   webhook registration + credentials + which system's `DEFAULT_TENANT_ID`/routing table is active.

**Open question for the owner:** is `line-monitor` (Feature A5.3, "designated LINE groups" for
automated order/report entry) still in active use by any tenant, or is it dead code riding on
`DEFAULT_TENANT_ID`? Its verdict (drop vs. rebuild) depends entirely on that answer — I found no
UI entry point wiring a tenant to it, only the hardcoded default.

---

## 4. Tenant config surface

Stored on `Tenant` (`prisma/schema.prisma:16-43`):
- **Branding/locale**: `Tenant.config` — a single `Json` blob, comment says it carries
  `vatRate, currency, timezone, brandColor, logoUrl` (FEAT01 MT-P4). No fixed schema at the DB
  level; shape is enforced only in application code (`shapeTenantConfig`/`updateTenantConfig` in
  `tenantRepo.js`, not fully read in this pass — worth a follow-up read before V2 schema design).
- **Plan**: `Tenant.plan String @default("STARTER")` — a bare string, no `Plan` model, no
  feature-flag table found anywhere in the 72 models scanned. Feature gating by plan, if it
  exists, is not visible in the schema — likely done ad hoc in application code or not done at all.
- **Integrations**: `lineOaId`, `lineChannelToken` (enc), `lineChannelSecret` (enc), `fbPageId`,
  `fbPageToken` (enc) live directly on `Tenant`; accounting integrations live in the separate
  `IntegrationConfig` table (multi-provider: `flowaccount | express | peak | sage`, only
  FlowAccount OAuth is actually wired up in code read this pass).
- **Ownership**: `Tenant.ownerEmployeeId` — single scalar pointer to the current owning `Employee`.
- **API keys**: none found scoped to tenants (no `ApiKey` model in the 72-model list). If V1 SMBs
  can issue their own API keys, I found no evidence of it.

V2 must carry forward at minimum: the config JSON's actual keys (needs the read `shapeTenantConfig`
does to enumerate them precisely), `plan` as a string enum, and the LINE/FB/accounting credential
set — all under the new identity model rather than as scalars on a single-tenant-owner row.

---

## 5. Multi-tenancy enforcement

**Mechanism, cited precisely — two overlapping layers, neither alone sufficient, one advisory:**

1. **Explicit per-query filtering (primary, discipline-based):** every repository function takes
   `tenantId` as its first parameter and includes it in `where` (documented as mandatory in
   `src/lib/repositories/CLAUDE.md:19-25`, "ทุก query ต้องมี `where: { tenantId }` เสมอ"). This is
   the actual enforcement in the overwhelming majority of code paths — confirmed in
   `customerRepo.js` (`baseWhere(tenantId) = { tenantId, deletedAt: null }`, used throughout) and
   `employeeRepo.js`.
2. **Prisma `$extends` middleware as a safety net (secondary, conditional):** `src/lib/db.ts:40-77`
   installs a global Prisma extension that auto-injects `where.tenantId` / `data.tenantId` on every
   model **except** `Tenant, MarketPrice, AuditLog, ActiveSession` — but **only if**
   `getTenantContext().getStore()?.tenantId` is set, i.e. only inside a
   `withTenantContext(tenantId, fn)` call. `withTenantContext` is invoked from: `withAuth()`
   (`auth.js:100`, so all routes wrapped in `withAuth`), and manually inside the LINE/Facebook
   webhook processors (`withTenantContext` calls in `webhooks/line-bot/route.js:61`,
   `webhooks/facebook/route.js:74`). **It is not invoked** for: `api/webhooks/line/route.js`'s
   `processWebhook` (no `withTenantContext` wrapper — relies solely on manual `tenantId` params),
   `api/webhooks/line-monitor/route.js` (same), and any route not built on `withAuth` (several
   integration routes read this pass, e.g. `api/integrations/accounting/route.js`, call
   `getServerSession` directly instead of `withAuth`, so they never enter tenant context — they
   rely entirely on layer 1).

**Verdict: enforcement is inconsistent, and this is a security finding, not a style note.**
The Prisma-level safety net only fires for code paths that happen to call `withTenantContext` —
which is most, but demonstrably not all, `withAuth`-wrapped or explicitly-wrapped routes. Routes
that call `getServerSession` directly and skip `withAuth`/`withTenantContext` (found in
`api/integrations/accounting/route.js`, `api/integrations/flowaccount/connect/route.js`) get
**zero** automatic protection — a bug in their manual `where: { tenantId: session.user.tenantId }`
filtering (or its omission) would not be caught by any safety net. There is a real test file
asserting the safety net's behavior (`src/tests/security/tenant-leak.test.js`), which is good
practice, but it only exercises the `withTenantContext`-wrapped path, not the routes that bypass it.

---

## 6. Lift blockers and open questions

**Lift blockers (confirmed by reading code, not assumed):**
1. `PATCH /api/tenant/config` and `PATCH /api/tenant/integrations` are unreachable — `domain: 'tenant'`
   is not a key in `permissionMatrix`. Fix or redesign before treating either as a working reference.
2. Three LINE webhook handlers, three tenant-resolution strategies, two of them not properly
   tenant-isolated for outbound replies (§3). Cannot lift-and-shift; must be consolidated as part
   of the LINE ownership-flip design, not after.
3. Two independent AES key schemes for encrypted secrets at rest (`ACCOUNTING_ENCRYPTION_KEY` for
   `IntegrationConfig` OAuth tokens vs. `TOKEN_ENCRYPTION_KEY` for `Tenant.lineChannelToken` /
   `lineChannelSecret` / `fbPageToken`) — decide in V2 whether both keys need to be provisioned at
   cutover or whether to consolidate.
4. Session revocation is coded but disabled (`TEMPORARY BYPASS`, §0) — decide whether V2 inherits
   the bypass (bad) or the fix needs to land before/at cutover.
5. `middleware.js` vs `permissionMatrix.js` carry two hand-maintained copies of the same RBAC table,
   already drifted on domain coverage (`team`, `ownership` missing from the middleware copy).
6. Impersonation audit trail is Redis-only, capped at 100 entries, no durable table — insufficient
   for compliance if V2 needs a durable admin-action audit log (V2's own `application/` services +
   audit event pattern per CLAUDE.md should supersede this, not copy it).

**Open questions for the owner (each changes a verdict above):**
1. Is `api/webhooks/line-monitor` (LINE group auto-order/report entry, Feature A5.3) actually used
   by any live tenant today? Its verdict is must-have vs. drop depending entirely on this — no UI
   or tenant-config wiring was found pointing a real tenant at it.
2. Is the `isMockMode` admin-password bypass in `auth-config.js:26` (`admin@vschool.io` / `admin`)
   guaranteed unreachable in the production deployment, or does `isMockMode` key off an env var
   that could be accidentally true in prod? Changes whether this is a "later, mock-only, ignore"
   or a "must-fix before V2 identity cutover" item.
3. What does `Tenant.plan` actually gate today, if anything? No `Plan`/feature-flag model exists in
   the schema; if plan-gating exists it's implicit in application code not surfaced in this pass —
   worth a targeted follow-up read of `shapeTenantConfig`/billing-adjacent code before V2 designs
   its plan/feature-flag model.
4. Does any tenant currently have two or more of the three LINE integrations (`line`, `line-bot`,
   `line-monitor`) simultaneously wired to the same LINE OA? If so the flip checklist in §3 needs
   to become "flip N things atomically" per tenant, not "flip one."

---

## Writer Report — P5 Platform
**Status**: DONE_WITH_CONCERNS
**Output file**: docs/.rwang-tasks/parity-platform.md
**Sub-areas covered**: auth, tenant, settings/ownership, admin, integrations (FlowAccount/accounting), webhooks (LINE ×3 + Facebook), team (invite/join, adjacent), permissions, liff (**wrongly reported absent — corrected by controller**)
**Verdict counts**: must-have 5 (tenant resolution+config schema, settings/ownership, admin impersonation+tenant admin, integrations/accounting, team invite/join) · later 2 (admin backfill scripts, permissions endpoint) · drop 1 (liff — nothing exists to lift) · rebuild 3 (auth/session/identity, tenant config+integrations write path, webhooks/LINE consolidation)
**LINE flip checklist**: (1) repoint the LINE OA webhook URL itself at LINE's platform to the new system — no dual delivery exists; (2) flip `Tenant.isActive`/`lineOaId` resolution ownership the same instant, since `getTenantByLineOaId` filters on `isActive: true`; (3) hand off or rotate `lineChannelSecret`/`lineChannelToken` (`TOKEN_ENCRYPTION_KEY`-encrypted) so the new owner can decrypt or has fresh LINE-issued credentials; (4) cut over `line-bot` and `line-monitor` webhooks in the same operation — they don't share `line`'s per-tenant resolution and one (`line-monitor`) has no tenant routing at all today; (5) confirm no other tenant is still resolving through the old system's `DEFAULT_TENANT_ID` fallback post-flip.
**Multi-tenancy enforcement**: Two-layer but inconsistent — explicit `where: { tenantId }` in every repository call (the real mechanism) plus a Prisma `$extends` safety net that only activates inside `withTenantContext`, which several routes (those calling `getServerSession` directly instead of `withAuth`) never enter — treat as a security finding, not a style note.
**Concerns**: (1) session revocation is implemented but disabled in the live auth path (`TEMPORARY BYPASS`); (2) two tenant-config write endpoints are unreachable due to an RBAC domain key typo (`'tenant'` not in `permissionMatrix`); (3) middleware fails open on unhandled errors; (4) middleware's inlined permission matrix has already drifted from the canonical one; (5) LINE integration has three inconsistently-isolated webhook handlers, the highest-risk item in this whole area.
