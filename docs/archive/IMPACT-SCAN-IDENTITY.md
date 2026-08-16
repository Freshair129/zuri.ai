# Impact Scan — Identity (ExternalIdentity / Principal), P2.5

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Complete — this is the gate before P3 Identity touches the Zuri slice |
| **Method** | 2 parallel read-only scans (data+repo, LINE+auth) + synthesis, over `G:\zuri` @ current HEAD, corroborating `PARITY-INVENTORY.md` |
| **Change scanned** | Add `ExternalIdentity`; `lineUserId` stops being the customer's primary id; resolve `lineUserId → ExternalIdentity → Customer(principalId)`. Staff auth kept separate. |
| **Owner rule applied** | MUST-UPDATE / REVIEW / TEST-ONLY / NO-IMPACT; nothing under `G:\zuri` was modified |

## 1. The change, minimal first shape (CUSTOMER + LINE only; defer EMPLOYEE, FACEBOOK, GOOGLE)

```prisma
model ExternalIdentity {
  id             String    @id @default(uuid())
  tenantId       String
  principalType  String    // 'CUSTOMER' for now (app-enforced enum)
  principalId    String    // = Customer.id — app-enforced, NOT a Prisma FK (polymorphic)
  provider       String    // 'LINE'
  providerSubject String   // the lineUserId (BR-002: an attribute, never a PK)
  verifiedAt     DateTime?
  linkedAt       DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())
  tenant         Tenant    @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, provider, providerSubject])   // moved off Customer; preserves idempotent first-contact
  @@index([tenantId])
  @@index([principalType, principalId])
  @@map("external_identities")
}
```

`principalId` is polymorphic → integrity is **app-enforced, like the `withAuth` roles
no-op landmine**, not a schema FK. `Customer.id` is preserved as `principalId` so LINE
bindings, `conversation.customerId`, and printed docs keep resolving (UUID rule).

## 2. Classification

### MUST UPDATE — feature breaks if not changed

| # | Target | Why |
|---|---|---|
| E1 | **`prisma/schema.prisma`** | add `ExternalIdentity`; the three `Customer` tenant-scoped uniques (`@@unique([tenantId, phonePrimary\|lineId\|facebookId])`, lines 401-403) are exactly what **moves**; `Customer.lineId/facebookId/phonePrimary` become legacy/derived (keep during migration). Confirmed canonical: lineId/facebookId have **composite unique only**, no standalone `@unique`. |
| E2 | **`Customer`** | today it *is* the identity; becomes `principalId = Customer.id` |
| E3 | **`Conversation`** | `customerId` FK + `participantId` (a 2nd raw handle copy, line 533) both change; resolution flips to `lineUserId → ExternalIdentity → Customer` |
| F1 | **NEW `src/lib/identity/resolveLineCustomer.js`** | the **single shared resolver** all sites call — see §3 |
| F2 | `repositories/conversationRepo.js` | `upsertLineCustomer:173` is THE primary first-contact create point; also latent bug: `upsertFacebookCustomer:157` uses `where:{facebookId}` — an invalid unique selector (no standalone `@unique`) and not tenant-scoped — do not reuse before fixing |
| F3 | `repositories/customerRepo.js` | `upsertByLineId(498-513)`, `upsertByFacebookId(478-493)` compound-unique upserts, `createCustomer(248-263)`, `buildCustomerWhere(124-125)`, `getKpiStats` channel breakdown (589,613-616) |
| F4 | `repositories/consentRepo.js` | **PDPA**: `findCustomerByLineId(37-44)`; `eraseCustomer(110-171)` nulls `Customer.lineId/facebookId` + `Conversation.participantId` — **must also revoke/delete the ExternalIdentity row** or an erased person stays re-contactable via the mapping table |
| F5 | `api/webhooks/line/route.js` | `processWebhook` resolves via `upsertLineCustomer`; route through the resolver AND **refuse identity creation when `destination → lineOaId` is unresolved** (no minting under `DEFAULT_TENANT_ID`) |
| F6 | `api/liff/auth/route.js` | `employee.findFirst({tenantId,lineUserId}):56` is the ONLY staff-vs-customer typing point — resolve both principalTypes via ExternalIdentity with `principalType` a **hard filter** |
| F7 | `lib/liffAuth.js` | session should carry resolved `principalId/customerId` so downstream LIFF routes stop touching the `lineId` column |
| F8 | `api/liff/{consent,enrollment,orders/me,payment/[id]/slip}` | consent = only PDPA writer; **enrollment is a SECOND customer-creation path** (must converge on the shared resolver or identity forks); orders/payment scope by `{tenantId,lineId}` → resolve via `principalId` |

### REVIEW — may be affected, verify

`Employee` (has `lineUserId:273` — the EMPLOYEE-side binding, in scope only when EMPLOYEE/LINE migrates) · `Tenant` (gains `externalIdentities[]`; stays the FIRST hop channel→tenant) · `CustomerProfile`/`CustomerInsight` (1:1 with Customer — merge frequency rises) · `lib/db.ts` (`buildTenantScopedModels` auto-scopes ExternalIdentity for free, **but only inside `withTenantContext`**) · `lib/auth.js`, `lib/tenantContext.js` (ALS guard is a **no-op on webhook/LIFF paths** — resolver must self-scope with explicit `where:{tenantId}`) · `middleware.js` (`/liff/*` public — principalType split must be airtight) · `auth-config.js` + `employeeRepo.findByEmail:18` (the existing non-deterministic cross-tenant staff login) · `services/actionExecutor.js:95` (outbound push via `customer.lineId` — send-address must later resolve from principal) · `webhooks/line-monitor` (hardcodes `DEFAULT_TENANT_ID`) · `crm/CLAUDE.md` (describes a `CustomerIdentity` model that never shipped — ADR-007 revives exactly that intent)

### TEST ONLY — regression surface, no change
`customerRepo.test.js` (extend; keep green) · `consentRepo.test.js` (**add: erase also revokes ExternalIdentity**) · conversationRepo tests

### NO IMPACT
`Message` (tenancy via Conversation) · `permissionMatrix.js` (Employee-only RBAC, no CUSTOMER) · `webhooks/line-bot` (global assistant, never touches Customer)

## 3. The single shared resolver (do this first, collapse 6 sites to 1)

`src/lib/identity/resolveLineCustomer.js` — `resolveLineCustomer(tenantId, {lineUserId, displayName})`:
1. **requires a positively-resolved `tenantId`; throws if absent** — never mints identity under `DEFAULT_TENANT_ID`
2. upserts on `ExternalIdentity(@@unique([tenantId,provider,providerSubject]))` — **this is where the atomic-upsert idempotency guarantee moves** (against concurrent first-contact webhooks)
3. first contact: create `Customer(principal)` + `ExternalIdentity` in **one transaction**; repeat: return `Customer` via `principalId`

The six sites that resolve `lineUserId → customer` today (webhook, liff/auth, liff/enrollment, liff/orders, liff/payment, consent) **must all call this before any one of them flips**, or a principal forks (a LINE-conversation customer ≠ a LIFF customer for the same person).

## 4. Sequencing hazards (why this is dangerous)

1. **Schema drift first** — reconcile the canonical `prisma/schema.prisma` against any worktree copy before merging (governance order).
2. **Consolidate before switch** — 2 creation paths + 6 resolution sites; partial adoption forks the principal.
3. **Silent cross-tenant leak** — webhook/LIFF never open the tenant ALS (`tenantContext.js` is a no-op there); a providerSubject-only lookup resolves across tenants with **no net**. Resolver must query with explicit `{tenantId}`.
4. **`DEFAULT_TENANT_ID` fallback** would mint identity in the wrong tenant for an unrecognized OA — resolver must refuse.
5. **PDPA erasure regression** — ExternalIdentity is a third handle copy; erase must revoke it.
6. **Staff/customer conflation** — `liff/auth:56` needs a strict `principalType` filter + a precedence rule for a human who is both.
7. **Non-deterministic staff login** (existing) — fixing the customer leg without the staff leg leaves auth inconsistent.
8. **Atomic-upsert loss** — keep the three `Customer` uniques until `ExternalIdentity` upsert is proven, or a first-contact race duplicates customers.

## 5. Gate entry

This scan is the **impact classification required before P2/P3 touch Zuri** (ADR-007
P2.5). Gate C (Identity) additionally needs: the shared resolver landed and all six
sites routed through it; erase revokes ExternalIdentity; the `principalType` filter is
airtight; and a Security-Auditor pass on the cross-tenant-leak and staff/customer-split
hazards. The existing non-deterministic staff login and webhook misattribution are V1
defects to fix **in V2's rebuilt identity**, never by editing `G:\zuri`.
