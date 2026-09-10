---
id: ZAI:PROPOSAL-COMMERCE-BILLING-POS-20260910
version: "0.2.6b"
status: beta
superseded_by: null
created_at: "2026-09-10T23:55:29+07:00,RWANG"
last_update: "2026-09-11T02:11:17+07:00,RWANG"
attributes:
  domain: commerce
  doc_type: feature-contract-proposal
  scope: "Invoice, receipt, Thai tax document, PromptPay configuration and POS checkout"
---

# Approved contract — Commerce Billing, PromptPay and POS

## Review status and baseline

This is the owner-approved contract for the audited P3 implementation. It
does not add a FEAT or ADR. FR-186 and FR-183 are the two newly allocated
requirements for this scope; their rows remain the requirement authority and
this document records the implementation detail.

The candidate was prepared against `origin/main` `f320e888a7f6fbb978fd274a791eca89bf3eb7e4`
and the audited branch commit
`18a7660ccf1491b2cbc70652867d66da0e3ea02f`. Existing Commerce authority is
ADR-065 with FR-166 (sales orders) and FR-163 (payments and revenue). The
Commerce charter and ADR-065 D6 explicitly leave invoices, receipts and tax
documents for a later contract. The existing payment method vocabulary is
`TRANSFER | CASH | QR | CARD | OTHER`; it is the source of truth until a
reviewed change says otherwise.

The owner-approved billing requirement was originally reserved as FR-182. After
published PR #318 claimed FR-182 for the SCM operations requirement, this
branch renumbers the same billing subject to FR-186 through the repository id
ledger before integration. POS remains FR-183; this is an identity collision
repair, not a product or behavior change.

The requested P3 work is therefore split into a new contract proposal and
adapters over the existing order, payment and Inventory interfaces. It must
not claim that a local preview, a locally persisted document, a PromptPay QR
string, or a mock payment proves Thai legal compliance, bank acceptance or
production readiness.

## RCA from the audited implementation

### Symptom

The P3 branch advertises invoice/tax issuance, PromptPay and a Cloud POS
cashier, but its implementation is not compatible with the current Commerce
contracts and can report values that were never sourced or persisted.

### Evidence

The following evidence is from the audited branch at the baseline above.

| Location | Evidence | Contract consequence |
|---|---|---|
| `apps/server/src/modules/commerce/application/billing-invoice-service.js:144-170` | Reads `order.totals.total` and `order.remaining`, while the current `orderDto` exposes `total` and `balanceDue`; uses the current clock for numbering; uses a fixed PromptPay target. | Invoice generation can fail at runtime and cannot be a reliable document or payment surface. |
| `.../billing-invoice-service.js:176-189` | Falls back to `Zuri Business Solution`, tax id `0105560000000`, branch `00000`, Bangkok address, and walk-in/customer tax values. | Seller and buyer identity are fabricated instead of resolved from scoped Business/LegalEntity/Branch data. |
| `.../billing-invoice-service.js:73-105` | Accepts an empty or malformed target and has a fallback path that emits it into a QR payload. | A QR can be generated without an authoritative configured recipient. |
| `.../pos-cashier-service.js:31-58` | Defaults terminal/branch to `POS-01`/`MAIN`, coerces invalid quantities to `1`, and supplies `Item` for missing descriptions without the existing Zod contracts. | The request can silently change meaning and report a station that was never configured. |
| `.../pos-cashier-service.js:130-171` | Creates a `VERIFIED` payment with the recording actor as verifier, then writes `StockMovement` directly. | It bypasses FR-163's two-hat verification and FR-155's Inventory `appendMovement` checks, including stock, lot, serial, location and audit rules. |
| `.../pos-cashier-service.js:226-286` | Derives a sale price as `baseCost * 1.4`, then falls back to `100`. | Inventory cost is presented as a sale price without an approved Commerce price source. |
| `apps/server/tests/unit/commerce/commerce-p3-billing-pos.test.js:49-195` | Tests VAT/QR with arbitrary identifiers and tests checkout against a synthetic transaction mock. It does not exercise the real schema, viewer domain map, Business/Branch joins, Inventory ledger or rollback. | A green unit test cannot establish authorization, persistence, monetary or external payment correctness. |
| New routes in the branch | They are absent from the machine-readable OpenAPI generator at this baseline. | The generated contract reports `API-OPENAPI-001`; route existence is not sufficient API delivery. |

### Root cause

The branch implemented a product-wide billing/POS prototype against the old
Commerce order shape instead of composing the current scoped contracts. No
authoritative seller, buyer, PromptPay, VAT, terminal or price configuration
was available, so the prototype filled the gaps with constants, default
values and a markup rule. The tests asserted those prototype choices through
in-memory mocks rather than the real authorization and persistence seams.

### Why this escaped detection

The audited branch was based on a one-commit feature addition. The current
Commerce docs still mark fiscal documents as deferred, so no approved FR,
OpenAPI entry, Prisma model, migration or integration suite required the
new routes to agree with the live contracts. The unit test's transaction mock
also had no opportunity to expose missing fields, enum mismatch, cross-scope
joins, direct ledger writes or rollback behavior.

### Prevention

Allocate and approve the new requirement(s) before implementation; keep the
seller, buyer, tax, recipient, terminal and price sources explicit; compose
the existing Commerce and Inventory services; add real SQLite integration
tests and generated OpenAPI/governance edges; and preserve unavailable,
pending, rejected and failed outcomes instead of converting them to success.

## Proposed product contract

The following is the smallest complete shape that covers the audited P3
scope while retaining the current domain boundaries.

### 1. Fiscal documents are durable issuance plus a separate preview

The feature has two explicit operations:

| Operation | Meaning | Durable result |
|---|---|---|
| `PREVIEW` | Read the selected order, validate the requested document type and configuration, and calculate a deterministic tax breakdown. | No document number, issued timestamp, or audit event. |
| `ISSUE` | Create the requested invoice, receipt, tax invoice or abbreviated tax invoice from one order snapshot. | One immutable `CommerceDocument`, one audit event, and a stable document number. |

Issuance is not silently downgraded to preview. `ISSUE` must be one database
transaction: validate scope and configuration, lock/check the order and
idempotency key, snapshot seller/buyer/tax/payment totals, allocate the next
number in a per-Business, per-document-type, per-calendar-year sequence, write
the document, and append `COMMERCE_DOCUMENT_ISSUED`. A retry with the same
idempotency key returns the original document; a different request never reuses
its number. The request's canonical hash is persisted with the document, so a
same-key request with a different order, type, branch or buyer is a 409 rather
than an unrelated replay. The sequence state and document uniqueness constraint must be
updated in the same transaction so concurrent issuance cannot allocate the
same number. Documents are never edited or deleted.

Document correction or void is explicitly outside this minimal P3 contract.
No void route or void status is proposed here. If legal or operational
correction is required, it needs a separately approved contract that preserves
the original immutable snapshot and defines its audit and numbering behavior.

The document snapshot is the evidence for what was issued. It must include
the order id/code, document type, seller identity, selected branch, buyer
identity supplied/linked for this issuance, line values, integer-satang
totals, tax policy/version and payment references. A print/PDF artifact is an
optional `FileAsset` reference in the document; printing alone is not an
issuance event.

After a successful web issue, the Billing console may retain the document id
in its current URL and reload it through the existing scoped `GET` document
route. Reloaded state must display the same immutable document only when the
returned Business matches the active Business; a missing, inaccessible or
cross-Business id is cleared and never shown in the new scope.

The supported document types are closed:
`INVOICE`, `RECEIPT`, `TAX_INVOICE`, `ABB_TAX_INVOICE`. Unknown types are
rejected before any write. `TAX_INVOICE` and `ABB_TAX_INVOICE` require a
verified Thai tax profile. A Business that is not VAT-registered must
explicitly configure `nonVatDocumentPolicy = ALLOW_INVOICE_RECEIPT` before
`INVOICE` or `RECEIPT` may be issued; the default is unavailable and returns
`BILLING_NON_VAT_POLICY_NOT_CONFIGURED` until an owner chooses allow or deny.
The implementation must return a named refusal when the configured policy
denies the document.

An `ISSUE` of `RECEIPT` additionally requires verified payment for at least the
document gross amount; PENDING, rejected or insufficient verified payment is
not evidence of receipt. A `PREVIEW` may show the current unpaid or pending
state so the operator can see why issuance is unavailable, without creating a
document or claiming money was received.

### 2. Seller identity comes from existing scope records

The seller is resolved from the requested Business, never from a free-form
seller object in the request:

1. `Business.legalEntityId` must resolve to a `LegalEntity` in the same
   portfolio and the viewer must be authorized for the Business.
2. A Thai `LegalEntityIdentifier` with the accepted tax-id type and a
   non-null verification time supplies the seller tax id.
3. A requested `Branch` must belong to that Business and be active. Its
   branch code and address supply the branch part of the snapshot.
4. The legal entity and branch must have the address/registered-name fields
   required by the accepted document policy. Missing data returns a stable
   `BILLING_SELLER_NOT_CONFIGURED` or `BILLING_BRANCH_NOT_CONFIGURED` error.

There is no fallback seller name, tax id, branch number, address or current
clock-derived identity. A Business OWNER may edit the approved issuer and
branch configuration through the configuration flow; legal address edits go to
the authoritative `LegalEntity.legalAddress` only when that LegalEntity is
linked to one Business. A shared LegalEntity cannot be overwritten by one
Business OWNER; the configuration flow refuses that edit until the authoritative
owner resolves the shared identity. Until the owner supplies and verifies the
required values, issuance remains explicitly unavailable.
Local development and tests may use clearly labeled fixture values through
that same configuration seam; they must not be presented as production
identity. The existing `LegalEntity`,
`LegalEntityIdentifier` and `Branch` records remain the authorities; an
additive address/branch-tax-code shape may extend them after schema review.
Do not create a second seller master in Commerce.

### 3. Buyer identity is explicit and snapshotted

For P3, buyer identity is `ISSUANCE_INPUT`: the issuer supplies validated
buyer legal name, tax id, branch code and address for this document, and
Commerce snapshots those values without writing a CRM customer or silently
updating the `Customer` row. An optional existing `customerId` may link the
order, but it is not treated as the source of tax identity. A walk-in buyer
may be represented as `ANONYMOUS_WALK_IN` only when the Business OWNER has
configured `walkInDocumentPolicy = ALLOW_ANONYMOUS_RECEIPT`; otherwise it
fails with `BILLING_WALK_IN_POLICY_NOT_CONFIGURED` (or the configured deny
error). This policy permits only `RECEIPT` for an anonymous buyer. A full tax
invoice with missing required buyer data fails with
`BILLING_BUYER_DATA_REQUIRED`; `ลูกค้าทั่วไป` is not a substitute for required
legal data.

### 4. VAT is configured, versioned and integer-satang exact

The tax calculation accepts a non-negative integer-satang amount and a
versioned effective tax policy. The policy supplies:

* registration/applicability status;
* rate in basis points or an equivalent integer representation;
* inclusive or exclusive treatment; and
* the rounding rule and effective date used for the snapshot.

The candidate default for a verified Thai VAT-registered Business is 7%, but
7% is not a universal code constant. VAT-inclusive calculation derives net
and tax from gross; exclusive calculation derives gross from net; both return
integer satang and baht display values. P3 uses one document-level
`ROUND_HALF_UP` operation on integer satang: inclusive VAT is
`grossSatang - roundHalfUp(grossSatang / (1 + rate))`, and exclusive VAT is
`roundHalfUp(netSatang * rate)`, with gross equal to net plus VAT. Line tax is
not independently rounded; the snapshot carries the document-level result so
the sum cannot drift from the order total. A later legal requirement for
per-line rounding would be a separate contract. Negative, non-finite,
fractional-satang and unsupported-rate inputs fail validation.
Billing accepts only the existing FR-166 `THB` order currency in this slice;
other currencies fail before preview or issue, with no FX conversion or
implicit reinterpretation of the source amount.

### 5. PromptPay is a configured QR method

PromptPay uses the existing `Payment.method = QR` vocabulary and a
Business-scoped provider value `PROMPTPAY`; adding new enum values such as
`PROMPTPAY` or `CREDIT_CARD` is a separate choice and migration. The UI may
label `QR` as PromptPay only when the resolved provider is PromptPay.

The recipient configuration must contain a normalized target type (`MOBILE`
or `TAX_ID`), a validated Thai mobile or 13-digit tax/national id in the
format required by the selected Thai QR standard, active status, and
verification metadata. It is resolved for the selected Business on every
request. A Business OWNER may edit this configuration, but until an active,
verified recipient is supplied, PromptPay remains explicitly unavailable.
No hardcoded target, stale Edge value, arbitrary request target or empty
fallback is allowed. Missing or unverified
configuration returns `PROMPTPAY_NOT_CONFIGURED`; malformed configuration
returns `PROMPTPAY_TARGET_INVALID`.

The pure EMVCo/CRC calculator may run locally, but the response must identify
it as a generated payload. No payment endpoint is called, and a QR payload is
not evidence that a bank accepted or delivered a payment.

### 6. POS is an adapter over the current order, payment and Inventory contracts

The POS station does not create a parallel sales ledger. It composes:

* FR-166 `SalesOrder` and `SalesOrderLine`, with the existing Zod line
  contract and `origin = WALK_IN`;
* FR-163 `Payment`, `recordPayment` and its verification action; and
* Inventory's exported `appendMovement` inside the same transaction when the
  order is fulfilled.

The request must carry a selected active `Branch` and a selected active
`WarehouseLocation` for stock issues. A `Branch` is a seller/document
location; it is not silently treated as a warehouse location. A missing or
cross-Business selection returns `POS_BRANCH_NOT_CONFIGURED` or
`WAREHOUSE_LOCATION_NOT_FOUND`. A terminal/station label may be accepted as
request metadata for the receipt, but P3 does not introduce a persistent
terminal hardware registry or defaults such as `POS-01`/`MAIN`.

Because the offer/price catalogue is deferred by ADR-065, the minimal
contract requires a manually entered `unitPrice` on every POS line, validated
by `zOrderLine`.
The POS catalogue may return product identity and recomputed on-hand, but it
must not derive a price from `ProductMaster.baseCost`, apply a markup, or use
a fallback price. An authoritative Commerce price list is a separate future
FR if the owner wants the grid to supply prices.

Checkout is atomic: invalid scope, invalid line, missing price, customer or
product mismatch, payment failure, inventory shortage, lot/serial refusal or
audit failure rolls back the order, payment, stock movements and checkout
audit. Inventory authority is checked separately from Commerce order
authority; a Commerce role never grants stock-write permission.

### 7. POS payment state preserves the two-hat rule

The default checkout operation records the payment as `PENDING`. It returns
the exact durable order/payment ids and a `PENDING` outcome; it never calls a
provider and never claims verified money. A separate verifier action follows
the existing FR-163 contract and permission boundary. P3 adds no
same-transaction verification mode and does not make a cashier their own
verifier. `CASH` change is calculated from integer-satang received and total
values; received money below the total is rejected, and no `NaN`, negative or
floating persistence is allowed. QR/card/transfer remain pending until the
existing payment verification contract has evidence; local checkout does not
manufacture that evidence.

## Minimal schema and configuration delta

The following additions are the minimum to support durable issuance and an
honest configured station. The governance owner should allocate model/FR ids
and choose field names before implementation.

| Need | Reuse | Minimum addition or decision |
|---|---|---|
| Seller legal identity | `Business.legalEntityId`, `LegalEntity`, verified `LegalEntityIdentifier` | Add `LegalEntity.legalAddress` plus the missing normalized `Branch.address` and Thai branch tax-code fields to the existing authority. A Business OWNER may update the legal address only when the LegalEntity is linked to one Business; shared identity edits fail closed. No Commerce seller master or duplicate legal address. |
| VAT policy | Business scope and the legal entity | A Business-scoped versioned tax profile with registration/applicability, rate, treatment, effective time, verification metadata, exact document-level `ROUND_HALF_UP` policy and explicit non-VAT document policy. Do not overload `Business.capabilitiesJson` with legal configuration. |
| PromptPay recipient | `Payment.method = QR` and existing `Payment` record | A Business-scoped PromptPay configuration with provider, target type/value, active status, verification metadata and version. Recipient data is resolved server-side and never supplied as an unchecked request override. |
| Durable document | `SalesOrder`, `Payment`, `FileAsset`, `AuditEvent` | An immutable `CommerceDocument` linked to Business/order/optional Branch, with type, unique number, issued status/metadata, idempotency key, persisted canonical request hash and immutable seller/buyer/tax/payment snapshot. A transactionally updated sequence keyed by Business/type/calendar year plus a uniqueness constraint is required; correction/void remains outside P3. |
| Buyer tax data | Existing CRM `Customer` relation | P3 uses validated `ISSUANCE_INPUT` only; the values are snapshotted into `CommerceDocument` and Commerce performs no CRM write or implicit Customer update. Anonymous walk-in is a configured receipt-only policy, default unavailable. |
| POS location | Existing `Branch` and `WarehouseLocation` | Require selected active Branch and source `WarehouseLocation` ids in the request, refuse unknown or cross-Business selections, and keep any terminal label as request/receipt metadata. No speculative persistent hardware registry and no `POS-01`/`MAIN` defaults. |
| POS sale price | FR-166 line price at sale time | Require a manually entered `unitPrice` per line. A reusable price list/offer catalogue is a separate future FR because ADR-065 defers it. |

No production migration is implied by this proposal. Any new model/column
requires SQLite schema support, the matching Postgres migration, generated
OpenAPI paths, annotations, governance output and migration review before
implementation is complete.

### Configuration lifecycle

P3 configuration is an owner-controlled Business settings flow, not a hidden
constant or a checkout request override. A Business OWNER may read the current
issuer, tax, PromptPay, non-VAT and walk-in policy profile, upsert validated
values, or explicitly deactivate a profile. Each mutation is Business-scoped,
versioned and audited.
Reads expose an explicit `UNAVAILABLE` state when a profile is missing,
inactive or unverified; document issue and PromptPay payload generation refuse
that state with the named errors above. The same service/seed seam may load
clearly labeled fixture values for local tests, so real production identity is
not required to implement or verify the flow. POS requests select Branch and
WarehouseLocation ids and provide manual line prices; they cannot override
seller, tax, recipient or sale-price configuration.

## Proposed HTTP contract

Exact route names remain subject to the allocated FR, but the semantics are:

| Route | Operation | Required outcome |
|---|---|---|
| `/api/commerce/billing/documents/preview` | `POST` | Scoped, non-persistent preview; no document number or issued claim. |
| `/api/commerce/billing/documents` | `POST` | Transactional durable issuance with idempotency; returns the persisted document and truthful status. |
| `/api/commerce/billing/documents/[id]` | `GET` | Reads one document in Business scope. |
| `/api/commerce/pos/catalogue` | `GET` | Business-scoped active product identity and recomputed stock; no derived/fallback sale price. |
| `/api/commerce/pos/checkout` | `POST` | Atomic order + pending payment + Inventory issue; exact satang and no fabricated station/provider values. Payment verification remains a separate existing FR-163 action. |

Every route resolves the trusted viewer before reading the body, validates
Business visibility plus `commerce`, applies the existing order/payment
permissions, and maps scope refusal to the existing 404-shaped Commerce
response. POS stock issue additionally requires Inventory authority.

## Acceptance tests required before implementation can be marked done

1. **Seller and scope:** wrong-tenant Business, invisible Business, missing
   commerce domain, cross-Business LegalEntity/Branch and inactive Branch all
   fail closed with no document, payment, stock or audit rows.
2. **Issuer configuration:** missing Business legal entity, missing verified
   Thai tax identifier, missing address, missing Branch or missing branch
   address returns named configuration errors and writes nothing. A missing
   non-VAT or walk-in policy remains unavailable until an OWNER configures it.
3. **Buyer contract:** the chosen buyer source is enforced; required full-tax
   fields cannot be omitted; a walk-in document follows the accepted policy;
   the snapshot preserves the supplied/linked values without changing CRM.
4. **Document issuance:** preview has no durable id/number; issue persists one
   immutable document and one audit event; `RECEIPT` issue requires verified
   payment at least equal to document gross while preview preserves unpaid and
   pending states; the same idempotency key is idempotent; concurrent issuance
   never duplicates the per-Business/type/year sequence; correction/void is
   outside P3 and has no unapproved route.
5. **VAT money:** inclusive/exclusive calculations, zero, boundary
   `ROUND_HALF_UP` at document level, large amounts, invalid rates and invalid
   numeric inputs are tested using integer satang. Stored totals and returned
   baht values agree with the order's FR-166 calculation. A non-`THB` source
   order fails before preview or issue; no FX conversion is implied.
6. **PromptPay:** configured mobile and tax-id recipients produce a valid
   deterministic payload and CRC; malformed/unverified/missing configuration
   refuses; no request-supplied or hardcoded target is accepted; the test
   makes no bank/provider call.
7. **Payment integrity:** duplicate bank/slip references are rejected under
   the real unique constraint; POS checkout remains PENDING; only the existing
   authorized verifier action can make it VERIFIED; rejected/pending money
   never enters revenue.
8. **POS money and validation:** invalid line shape, zero/negative/non-finite
   quantity or price, over-discount, insufficient cash and exact change are
   covered. Existing `zOrderLine`/`zRecordPayment` semantics are reused.
9. **POS inventory:** product ownership, active status, tracked/untracked,
   lot FEFO, serial refusal, selected location and Inventory authority are
   exercised through `appendMovement`; shortage or any later failure rolls
   back the order, payment, movement and audit.
10. **Billing recovery:** a complete snapshot carries the profile, sequence
    and CommerceDocument arrays with a versioned feature manifest in FK order;
    import preview validates closed billing types/statuses, scope references,
    sequence continuity and parseable immutable snapshots. A legacy snapshot
    without those arrays is explicitly `UNAVAILABLE`, and import refuses it
    when existing billing rows would otherwise be erased. Restored numbering
    continues above the highest issued sequence.
11. **Persistence and API:** real SQLite integration tests cover every write,
   Business scope and rollback; Postgres schema/migration parity is checked;
   all routes are present in generated OpenAPI and the route inventory;
   focused unit tests, Server build and `npm run govern` pass. No test is
    counted as production/provider/payment activation evidence. The browser
    proof issues a document, observes its number in the result, reloads the
    deep link and observes the same number again, then confirms a Business
    switch clears the old result.

## External and business inputs still required

Implementation cannot invent these values:

* the Business/LegalEntity that is authorized to issue documents, its verified
  Thai tax identifier, legal address and branch addresses/codes;
* the VAT registration status, rate/effective date and inclusive/exclusive
  policy (the Business OWNER can supply this through configuration; P3 fixes
  document-level `ROUND_HALF_UP` above);
* the PromptPay recipient and its verification/activation owner;
* the buyer values supplied for each issuance (P3 fixes `ISSUANCE_INPUT` and
  receipt-only anonymous walk-in, with OWNER configuration required to enable
  it);
* the selected Branch and WarehouseLocation values and whether an
  authoritative Commerce price list is required; and
* whether durable output needs only a JSON/printable record or a generated
  `FileAsset` PDF artifact.

These are explicit configuration or product/legal choices, not values a local
test, fixture, default or generated QR may supply. Real production identity
values are not required to build or test the configuration flow: labeled
fixtures may exercise configured and unavailable states. They are required
before a Business can activate issuance or PromptPay. No real payment
endpoint, external purchase, message, deployment or production migration is
part of this proposal.

## Technical and legal reference boundary

The Revenue Department's published VAT overview states a general VAT rate of
7 percent and describes the tax base as exclusive of VAT. The accepted tax
profile must still capture registration, applicability, effective date and
rounding policy, and this local feature must not claim statutory tax-invoice or
e-tax certification. See the [Revenue Department VAT overview](https://www.rd.go.th/english/6043.html).

The Bank of Thailand's [Thai QR Payment Standard](https://www.bot.or.th/content/dam/bot/documents/th/our-roles/payment-systems/about-payment-systems/ThaiQRCode_Payment_Standard.pdf)
defines the EMVCo-aligned merchant-presented structure and reserves tag 29 for
PromptPay credit transfer, including mobile and national/tax-id target forms.
The [PromptPay overview](https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/promptpay.html)
describes PromptPay as an account-linked payment infrastructure. These sources
bound the technical reference for a local payload calculator; they do not
prove bank acceptance, payment settlement, merchant onboarding or Thai legal
issuance for this product.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-10 | candidate | Candidate contract and acceptance package for durable Commerce billing/POS issuance, configured PromptPay and atomic checkout; no new FR ids allocated | 260d04c0 | RWANG |
| 0.2.0b | 2026-09-11 | beta | Owner-approved FR-186/FR-183 contract: deterministic issuance, configured profiles, receipt-only anonymous walk-in, exact document-level rounding and pending POS verification | pending | RWANG |
| 0.2.1b | 2026-09-11 | beta | LegalEntity.legalAddress remains the authoritative seller address, shared identities fail closed, and CommerceDocument persists requestHash for idempotent request binding | pending | RWANG |
| 0.2.2b | 2026-09-11 | beta | Receipt issuance requires verified payment at least equal to document gross; exclusive VAT payable and PromptPay use the gross snapshot while the source order remains unchanged | pending | RWANG |
| 0.2.3b | 2026-09-11 | beta | Published PR #318 claimed FR-182 for SCM, so the owner-approved billing subject is recorded as FR-186 through the id-ledger abandonment path; POS remains FR-183 and behavior is unchanged | pending | RWANG |
| 0.2.4b | 2026-09-11 | beta | Billing refuses non-THB FR-166 source orders before preview or issue; no FX conversion is part of the approved P3 contract | pending | RWANG |
| 0.2.5b | 2026-09-11 | beta | Billing recovery is explicit: complete manifests and arrays validate immutable rows and sequence continuity, while legacy omissions stay unavailable and cannot erase existing evidence | pending | RWANG |
| 0.2.6b | 2026-09-11 | beta | The web console reloads an issued document through its existing Business-scoped read route and clears inaccessible or cross-Business deep links | pending | RWANG |
