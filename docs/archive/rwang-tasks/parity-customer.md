# Parity Inventory — CUSTOMER (P2)

Scope: `crm`, `customers`, `conversations`, `inbox`, `notifications`, plus adjacent
`leads`, `segments`, `loyalty`, `consent`. Source: `G:\zuri` (read-only scan,
2026-08-12). No files under `G:\zuri` were modified.

---

## 1. Sub-area tables

### 1.1 CRM / Customers core

| Field | Detail |
|---|---|
| API routes | 15 total. `src/app/api/customers/route.js` (list, create), `[id]/route.js` (get/update/delete), `[id]/activity`, `[id]/enrich`, `[id]/erase`, `[id]/merge`, `[id]/profile`, `[id]/stage`, `[id]/tags`, `[id]/timeline`, `import/route.js`; plus `src/app/api/crm/customers/route.js`, `crm/insights/[customerId]/route.js`, `crm/patterns/route.js` |
| Dashboard pages | `(dashboard)/crm/page.jsx` (dashboard), `crm/[id]/page.jsx` (360 view), `crm/customers/page.jsx` (list) |
| Prisma models owned | `Customer`, `CustomerStageHistory`, `CustomerActivity`, `CustomerProfile`, `CustomerInsight`, `TenantCRMPattern` |
| Workers touched | `workers/crm-enrich` (Gemini insight scoring, real — reads `conversationRepo.getCustomerMessages`, writes `customerInsightRepo`), `workers/crm-pattern` (tenant-level pattern aggregation into `TenantCRMPattern`), `workers/customer-import` (bulk import, batches of 50, dedup by E.164), `workers/auto-tag` (writes `ConversationAnalysis`, feeds CRM stage/tag signals) |
| Evidence of real use | `src/lib/repositories/customerRepo.js` (644 lines, 17 exported functions: list/get/create/update/soft-delete/transitionStage/addTag/removeTag/getTimeline/upsertByFacebookId/upsertByLineId/mergeCustomers/getKpiStats/getDailyCustomerStats). Tests: `customerRepo.test.js` (15 cases), `[id]/route.test.js` (6), `[id]/stage/route.test.js` (10), `[id]/profile/route.test.js` (19), `tests/integration/customer-merge.test.js` (11), `tests/integration/modules/crm-page.test.jsx` (5). Wired into main nav (`src/config/modules.js` → `crm` module, 4 sub-features). Module has its own `CLAUDE.md` agent-context doc citing `docs/product/specs/FEAT05-CRM.md` and ADR-068 (role permission matrix). |
| **Verdict** | **must-have** |
| Cutover risk | **H** |
| Why | Deepest PII surface in the app, has right-to-erasure/merge transactional logic that must not regress, and its identity uniqueness (`[tenantId, phonePrimary]`, `[tenantId, lineId]`, `[tenantId, facebookId]`) is exactly the "Tenant = one shop" coupling V2's Portfolio→Tenant→Business→Workspace model has to reconcile with. |

### 1.2 CRM — Leads / Segments (views, not models)

| Field | Detail |
|---|---|
| API routes | None dedicated — both pages call `GET /api/customers` with `stage`/`channel`/`tags` query params. |
| Dashboard pages | `(dashboard)/crm/leads/page.jsx`, `(dashboard)/crm/segments/page.jsx` |
| Prisma models owned | None (derived views over `Customer.lifecycleStage`, `Customer.tags`, `Customer.lineId`/`facebookId`) |
| Workers touched | None directly |
| Evidence of real use | Wired into nav (`config/modules.js`: "Leads", "Segments" sub-features under `crm`). "Leads" filters by semantic stage `role` (`entry`/`active`/`quoted`) resolved from a per-tenant pipeline preset (`src/lib/pipelineStages.js`, CR-005) — no dedicated Lead model, so "leads" is purely a lifecycle-stage filter on Customer. |
| **Verdict** | **must-have** (as UI filters — no separate backend to lift) |
| Cutover risk | **L** |
| Why | Zero data model to migrate; risk is entirely in the pipeline-stage preset config (`Tenant.config.pipeline`) resolving correctly against V2's tenant model. |

### 1.3 Inbox / Conversations

| Field | Detail |
|---|---|
| API routes | 3: `conversations/route.js` (list), `conversations/[id]/route.js` (get), `conversations/[id]/reply/route.js` (send). Inbound is via `api/webhooks/facebook`, `api/webhooks/line`, `api/webhooks/line-bot`, `api/webhooks/line-monitor`, `api/webhooks/[platform]`. |
| Dashboard pages | `(dashboard)/inbox/page.jsx`, `inbox/[channel]/page.jsx`, `inbox/mobile/page.jsx` |
| Prisma models owned | `Conversation`, `Message`, `ConversationAnalysis`, `ConversationLog` |
| Workers touched | `workers/auto-tag` (PDAD intent tagging → `ConversationAnalysis`, real, reads last 10 messages), `workers/send-message`, `workers/sync-messages` (**stub — body is all `// TODO` comments, returns `{success:true}` without doing anything**), `workers/webhook-processor` |
| Evidence of real use | 3-panel layout is a hard module rule (`inbox/CLAUDE.md`: "ห้ามเปลี่ยนโครงสร้าง" — don't change the structure). `components/inbox/*` (9 files: ConversationList, ChatView, ChatPOS, ProfileTab + test, RightPanel + test, CustomerCard, ReplyBox, AgentModeToggle, ActivityTab). Realtime via Pusher `new-message` channel (explicit "no poll" rule). Wired into main nav with a dedicated `mobilePath`. `tests/integration/modules/inbox-page.test.jsx` (5 cases), `webhooks/facebook/route.test.js`, `webhooks/line/route.test.js`. |
| **Verdict** | **must-have** |
| Cutover risk | **H** |
| Why | Primary customer-contact surface (LINE/FB), holds message content (PII), NFR1 requires <200ms webhook response — any backend swap must preserve async processing or inbound webhooks will start failing/retrying against Meta/LINE. `sync-messages` worker being an unimplemented stub is itself a gap to carry forward or resolve, not silently drop. |

### 1.4 Notifications

| Field | Detail |
|---|---|
| API routes | 4: `notifications/route.js` (list), `notifications/count/route.js`, `notifications/read/route.js`; all under `notificationRepo`. |
| Dashboard pages | `(dashboard)/notifications/page.jsx`; also surfaced via `components/notifications/NotificationBell.jsx` (not a separate nav module — no `notifications` entry in `src/config/modules.js`). |
| Prisma models owned | `Notification` |
| Workers touched | None directly; written by `src/lib/services/actionExecutor.js` (`NOTIFY_STAFF` automation action) and `workers/daily-brief/notify`. |
| Evidence of real use | `notifications/route.test.js`, `notifications/count/route.test.js` exist. Route comment explicitly documents it's "the caller's own in-app notification inbox (rows written by automation — see NOTIFY_STAFF)" — i.e. staff-facing, not a customer-facing feature. `data.customerId` is embedded per-notification (see PII inventory). |
| **Verdict** | **later** |
| Cutover risk | **L** |
| Why | Small, self-contained, staff-facing only (scoped by `userId`+`tenantId`), no external contract beyond the 4 routes; not on the critical path but must move with `automation-engine`/`actionExecutor` since it's a write target from those. |

### 1.5 Consent (PDPA — CR-003)

| Field | Detail |
|---|---|
| API routes | 1 dashboard-adjacent: `api/customers/[id]/erase/route.js`; 1 LIFF: `api/liff/consent/route.js`. No listing/management UI page — consent is fields on `Customer`, not a separate resource. |
| Dashboard pages | None dedicated. Erase is presumably triggered from the CRM 360 page (`crm/[id]`) though no dedicated "consent" UI page exists in `(dashboard)`. |
| Prisma models owned | No dedicated model — 4 columns on `Customer` (`consentAt`, `consentSource`, `consentVersion`, `optOut`) + `ExportEvent` (append-only audit ledger, `type: 'consent.updated' \| 'customer.erased'`). |
| Workers touched | None; `campaign-broadcast` and `quote-aging` workers read `canMarketTo()` (`src/lib/consent.js`) as a gate before sending. |
| Evidence of real use | `src/lib/consent.js` (CR-003, `CONSENT_VERSION = '2026-08-v1'`), `src/lib/repositories/consentRepo.js` (172 lines, transactional erase), `consentRepo.test.js` (12 cases), `erase/route.test.js` (7 cases). Gate is enforced in `actionExecutor.js` for `SEND_LINE_MESSAGE`/`SEND_FB_MESSAGE` automation actions. |
| **Verdict** | **must-have** |
| Cutover risk | **H** |
| Why | This *is* the PDPA compliance mechanism — see §3 for exact granularity. Any V2 surface that sends outbound marketing must re-implement the same `canMarketTo()` gate or the tenant is legally exposed. |

### 1.6 Loyalty

| Field | Detail |
|---|---|
| API routes | None. |
| Dashboard pages | None. |
| Prisma models owned | None — `Customer.walletBalance` (Decimal) and `Customer.walletPoints` (Int) exist as fields, and `src/lib/customerTier.js` derives a membership tier, but there is no loyalty program, redemption, or points-ledger model/route. |
| Workers touched | None. |
| Evidence of real use | "cannot tell from code" beyond the two wallet fields and a tier calculator — no consuming UI or write path found for `walletBalance`/`walletPoints` in the areas scanned. |
| **Verdict** | **drop** (nothing to lift — flag for owner confirmation, see §6) |
| Cutover risk | **L** |
| Why | No feature surface exists; the two fields may be dead columns or may be written from a module outside this scan's boundary (e.g. `pos`/`invoices`) — worth a quick owner check before declaring dead. |

---

## 2. PII inventory

**`Customer`** (`prisma/schema.prisma:343`, table `customers`) — the primary PII record:
- `name` — display name
- `email`
- `phonePrimary`, `phoneSecondary`
- `lineId` — LINE user id (also a re-contact channel, not just an identifier)
- `facebookId`, `facebookName`
- `tags` (String[]) — free text, can contain notes-like content
- `intelligence` (Json?) — unstructured, AI-derived
- `walletBalance`, `walletPoints` — financial-adjacent
- `consentAt`, `consentSource`, `consentVersion`, `optOut` — consent metadata (see §3)

**`CustomerProfile`** (line 463, table `customer_profiles`) — inferred/stated demographic PII:
`gender`, `ageRange`, `hasChildren`, `occupation`, `educationLevel`, `location`,
`cookingLevel`, `motivation[]`, `budgetSignal`, `companyName`, `industry`,
`occasionPref[]`. Comment at line 477 notes `companyName`/`industry`/`occasionPref`
are "human-stated only, never written by AI enrichment" (CR-006) — the rest can be
AI-inferred (`inferenceCount`, `lastInferredAt`).

**`CustomerInsight`** (line 489, table `customer_insights`) — AI-derived behavioral PII:
`interests[]`, `objections[]`, `commStyle`, `keyFacts[]`, `summary` (free text),
`contactPref`, `manualOverride` (Json).

**`CustomerActivity`** (line 439) — `payload` (Json) "may embed name/tag/note text
from past timeline entries" (per `consentRepo.js:100` comment) — this is why erase
scrubs it (`payload: {}`) rather than leaving it.

**`Message`** (line 564, table `messages`) — `content` (Text) is raw message body
(highest-sensitivity field: full conversational content with the customer),
`attachments` (Json).

**`Conversation`** (line 528) — `participantId` (the FB PSID / LINE UID actually
used to message the customer — a *second* copy of the contact channel beyond
`Customer.lineId`/`facebookId`; erase must clear both, and `consentRepo.js:135-141`
does).

**`ConversationLog`** (line 2264) — `content` (Text), used for AI/human turn history.

**`ConversationAnalysis`** (line 1656) — `summary` (Text), `tags[]` — AI-generated,
derived from message content, so it inherits the same sensitivity.

**`Notification`** (line 1766) — `body` (Text) can embed customer PII by
construction: `actionExecutor.js:114` writes
`` `Workflow triggered for customer ${customer.name ?? customer.id}` `` into
`Notification.body`, and `data: { customerId }` into the Json column. This is a
staff-facing table but it is not PII-free.

**`ExportEvent`** (line 175) is explicitly the *opposite* — its repo comment
(`consentRepo.js:11-13`) states payloads carry "ids/timestamps/version strings
ONLY — never name/phone/email (PII local_only rule, CR-003 AC4)". This is a
deliberate design boundary worth preserving in V2: it's the one table designed to
be safely exportable/shareable without a PII review.

---

## 3. Consent handling

Consent is **not** a separate model — it is 4 columns directly on `Customer`
(`prisma/schema.prisma:366-369`):

```
consentAt      DateTime? // CR-003: PDPA marketing consent timestamp
consentSource  String?   // liff | manual | import
consentVersion String?
optOut         Boolean   @default(false)
```

**Granularity: per customer, per tenant. Not per channel, not per campaign type.**
One `consentAt`/`optOut` pair covers *all* marketing sends to that customer within
that tenant — there is no separate consent flag for LINE vs Facebook, or for
"promotional" vs "transactional" marketing beyond the code-level distinction that
service messages inside an open conversation are exempt (`consent.js:12-15`
comment: "Service messages ... are NOT subject to this gate, only outbound
marketing").

The gate function, quoted in full because it's the entire compliance boundary
(`src/lib/consent.js:17-19`):

```js
export function canMarketTo(customer) {
  return Boolean(customer?.consentAt) && !customer?.optOut && !customer?.deletedAt
}
```

Recording happens in exactly one place today: `POST /api/liff/consent`
(`src/app/api/liff/consent/route.js`), which resolves the customer by
`(tenantId, lineId)` from the LIFF session and calls
`consentRepo.recordConsent({ tenantId, customerId, source: 'liff', version })`.
`consentSource` also accepts `manual` and `import` per the schema comment, but no
route in this scan's boundary writes those values — "cannot tell from code" where
`manual`/`import` consent gets recorded (possibly in the customer create/import
paths without an explicit consent step, or possibly not implemented at all — see
open question in §6).

Consent version is a single global string (`CONSENT_VERSION = '2026-08-v1'` in
`consent.js:10`), not tenant-specific, with the explicit design note: "existing
consented customers keep their old-version consent, they are not silently
upgraded" — i.e. no auto re-consent flow exists.

Enforcement points found: `actionExecutor.js` (`SEND_LINE_MESSAGE`,
`SEND_FB_MESSAGE` automation actions), and referenced by
`workers/campaign-broadcast` and `workers/quote-aging` (both import `consent`
utilities per the earlier grep — not read line-by-line in this pass, flagged for
confirmation if exact call sites matter).

---

## 4. Tenant-coupling

`Customer.tenantId` is a required FK to `Tenant` with three tenant-scoped
uniqueness constraints (`schema.prisma:401-403`):

```
@@unique([tenantId, phonePrimary])
@@unique([tenantId, lineId])
@@unique([tenantId, facebookId])
```

This means identity resolution — "is this LINE user already a known customer?" —
is scoped to a single `Tenant` row, and in V1 `Tenant` **is** the shop
(`Tenant` model at `schema.prisma:16` carries `lineOaId`, `fbPageId`,
`fbPageToken`, `lineChannelToken` directly — one shop's LINE OA channel per
tenant row). `Customer.tenant` is a required (non-nullable) single relation
(`schema.prisma:380`), and `upsertByLineId`/`upsertByFacebookId` in
`customerRepo.js` resolve within that single-tenant scope.

**What would have to change for two businesses in one group to share a customer
without sharing everything** (per CLAUDE.md's Portfolio → Tenant(isolation) →
Business → Workspace model):

1. The three `@@unique([tenantId, X])` constraints assume one LINE/FB identity =
   one tenant. Sharing a customer across two `Business` rows under one
   `Tenant`(isolation) would need either (a) the unique constraint to move up a
   level (to `Tenant`/Portfolio) while `Business`-scoped views filter down, or
   (b) an explicit customer-to-business linking table distinct from the identity
   table — V1 has neither.
2. `consentAt`/`optOut` is a single pair per `Customer` row. If "share a customer"
   means one physical person interacting with two businesses in the group, a
   single consent flag can't represent "opted in to Business A's marketing, opted
   out of Business B's" — the PDPA gate would need to become per-(customer,
   business) rather than per-customer, which is a schema change, not a read-path
   change.
3. `CustomerProfile`/`CustomerInsight` are 1:1 with `Customer` (`@unique` on
   `customerId`) — a shared customer would need per-business insight rows, or an
   explicit decision that insight is deliberately shared across businesses in the
   group (a product decision, not just a migration mechanic).
4. `mergedInto`/`mergedFrom` (ADR-033 dedup) is a same-tenant self-relation
   (`Customer?` on `Customer`) — cross-tenant/cross-business merge is not
   supported by this relation shape today.
5. Erase (`consentRepo.eraseCustomer`) scopes every write by `tenantId` — a
   shared-customer erase would need to decide whether erasure is
   per-business-relationship or applies to the whole shared identity at once
   (this is a PDPA policy question, not purely technical).

---

## 5. Lift blockers

What breaks if these pages are served by a different backend with the same
endpoint contract:

1. **`withAuth` role enforcement gap** — `src/app/api/customers/[id]/erase/route.js`
   passes `{ domain: 'customers', action: 'F', roles: ALLOWED_ROLES }` to
   `withAuth`, but the route's own comment states: *"withAuth's `roles` option is
   not wired up in `src/lib/auth.js` (it destructures `domain`/`action`/`maskPii`/
   `minPlan`/`crossTenant` only) — enforcing here directly rather than relying on
   a call-site option that would silently do nothing."* A same-contract
   reimplementation that trusts the `roles` option (because it's present in the
   call signature) rather than reading this comment would silently drop
   OWNER/MANAGER-only enforcement on erase. This exact landmine needs to be
   called out to whoever re-implements auth wiring in V2.
2. **`sync-messages` worker is an unimplemented stub** — every branch is a
   `// TODO` comment; it returns `{success: true}` without touching FB/LINE or the
   DB. If V2 assumes this worker is doing something (because the route exists and
   "succeeds"), inbound sync will silently no-op. Not a lift risk so much as a
   "don't assume route existence means feature existence" trap.
3. **Webhook latency contract (NFR1)** — `inbox/CLAUDE.md`: "Webhook ต้อง respond
   200 ภายใน < 200ms — process async เท่านั้น" (must respond <200ms, process
   async only). A backend swap that processes inbound webhooks synchronously
   before responding will start missing Meta/LINE retry SLAs and cause duplicate
   webhook redelivery.
4. **Realtime channel naming** — Pusher channel pattern `tenant-${tenantId}`,
   event names `new-message` (inbox) and `hot-lead` (crm-enrich). A different
   backend must either preserve these channel/event names or the existing
   frontend (`ChatView.jsx`, subscribing components) breaks with no server error
   — it just silently stops updating live.
5. **PII masking is a per-route flag, not a schema-level guarantee** —
   `GET /api/customers` passes `{ maskPii: true }` to `withAuth`; nothing in the
   Prisma schema itself prevents a different route/service from returning raw
   PII. A reimplementation must locate and replicate every `maskPii` call site
   individually — grep is `grep -rn "maskPii" src/app/api`.
6. **Consent version is a hardcoded constant, not tenant data**
   (`CONSENT_VERSION = '2026-08-v1'` in `src/lib/consent.js`). A different
   backend must ship and update this constant in lockstep with the LIFF consent
   page copy, or consent-version comparisons silently drift.
7. **Erasure is transactional across 4+ tables with an extended 60s timeout**
   (`consentRepo.js:167`, `{ timeout: 60_000, maxWait: 10_000 }`) specifically
   because `eraseMessages: true` can touch every message across every
   conversation for a customer. A same-contract backend with a shorter default
   transaction timeout will fail large erasures that currently succeed.
8. **No dedicated consent-management UI page** — consent write path exists
   (`/api/liff/consent`) but there's no dashboard page found in this scan to view/
   audit a customer's consent state beyond whatever the CRM 360 page
   (`crm/[id]/page.jsx`) surfaces inline. Confirm the 360 page's consent
   affordance is captured before assuming "no consent UI to lift."
9. **Module CLAUDE.md docs describe a `CustomerIdentity` model that does not
   exist in the current schema** (`app/(dashboard)/crm/CLAUDE.md:9`: "CustomerIdentity
   — FB PSID / LINE UID ต่อ customer (many-to-one)"). The current schema instead
   stores `lineId`/`facebookId` directly as columns on `Customer` — a flat,
   1:1-per-platform model, not the many-to-one identity table the doc describes.
   This is documentation drift, not a code bug, but anyone using that CLAUDE.md
   as a lift spec will build the wrong shape.

---

## 6. Open questions for the owner

1. **Loyalty**: `Customer.walletBalance`/`walletPoints` and `src/lib/customerTier.js`
   exist with no consuming route/page found in this scan's boundary (`crm`,
   `customers`, `conversations`, `inbox`, `notifications`). Is there a loyalty
   feature living in `pos`/`invoices`/`payments` that writes these fields, or are
   they dead columns? Changes the verdict from **drop** to **must-have** if a
   live feature depends on them.
2. **Consent sources `manual`/`import`**: the schema comment allows
   `consentSource: 'manual' | 'import'` but only `'liff'` has a writer in this
   scan. Is manual/import consent recording implemented elsewhere, or is the
   LIFF flow the only way PDPA consent is actually captured today? If it's the
   only path, every customer created via `POST /api/customers` or
   `workers/customer-import` has `consentAt: null` by construction — i.e. cannot
   be marketed to until they separately go through LIFF. Worth confirming this is
   intended, since it affects whether "later" verdicts on adjacent workers
   (campaign-broadcast) need consent-path review too.
3. **Cross-business customer sharing** (§4): is sharing a customer across
   businesses in one group actually a near-term requirement, or a
   theoretical future capability? This changes how urgently the `@@unique`
   constraint redesign and per-business-consent question need answering before
   the CRM module is lifted, versus being deferred to a later phase.
4. **Notifications**: confirmed staff-facing only in this scan (scoped by
   `userId`+`tenantId`, written by automation). If V2 intends notifications to
   ever go customer-facing (e.g. push to the customer's LINE), that's a
   different trust boundary than what exists today — worth confirming out of
   scope for this lift.

---

## Writer Report — P2 Customer
**Status**: DONE
**Output file**: docs/.rwang-tasks/parity-customer.md
**Sub-areas covered**: CRM/Customers core, Leads (view), Segments (view), Inbox/Conversations, Notifications, Consent (PDPA/CR-003), Loyalty
**Verdict counts**: must-have 4 · later 1 · drop 1 · rebuild 0
**PII models found**: Customer, CustomerProfile, CustomerInsight, CustomerActivity, Message, Conversation (participantId), ConversationLog, ConversationAnalysis, Notification (body/data)
**Concerns**: (1) `withAuth` roles option is a documented no-op that the erase route works around locally — a reimplementation trusting the option name over the code comment would silently drop OWNER/MANAGER-only enforcement; (2) `sync-messages` worker is an unimplemented stub masquerading as a working route; (3) consent is single-flag-per-customer with no per-channel or per-business granularity, which directly blocks any "share a customer across businesses" design without a schema change; (4) `crm/CLAUDE.md` and `inbox/CLAUDE.md` describe some structure (`CustomerIdentity` model) that has drifted from the actual schema — do not use those files as an authoritative lift spec without cross-checking against `prisma/schema.prisma`; (5) loyalty verdict is low-confidence pending owner confirmation (open question 1).
