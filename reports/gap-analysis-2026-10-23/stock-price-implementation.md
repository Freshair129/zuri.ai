---
doc_type: implementation-plan
status: implemented-locally
version: "0.1.0"
source_revision: "e444eb461f9fec8ab95e6c09b19b4476261964d5"
---

# Stock/price source consistency implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans for the assigned implementation. Checkboxes track
> execution evidence, not new product authority.

**Goal:** Make the existing FR-180 staff/source ATP read consistent with fenced
ledger and reservation mutations, a prerequisite for the approved stock design.

**Architecture:** Reuse Inventory's existing transaction helper and Business
ledger fence. Preserve the current reader and reservation APIs, authorization
and output. Customer stock access and deterministic LINE fact answering remain
separate source/consumer contracts; do not add unused ports to simulate them.

**Tech Stack:** Existing Server JavaScript, Prisma SQLite/PostgreSQL and Vitest.

**Spec:** [Approved stock/price design](../../docs/change-requests/integration/line-agent-stock-price-facts-20261023.md),
[FR-180](../../docs/features/FEAT-025/requirements/FR-180.md) and
[verification policy](../../docs/architecture/VERIFICATION-POLICY.md).

## Global constraints

- Preserve `{ businessId, products, byProductId }` and all existing ATP row fields.
- Reuse `inTx` and `acquireLedgerFence`; support an existing transaction client.
- Retain authorization/error semantics and injected `now`; sample a default
  ATP/due-selection clock after acquiring the fence. Existing wrappers must
  pass an omitted clock through rather than synthesizing an explicit old time.
- Keep exact counts private to the existing authorized staff API; add no
  customer grant, policy store, route, intent matcher, Runtime operation or schema.
- Test only isolated disposable databases; no active development/UAT/production DB.
- Root integrates and runs generators serially. Delegated work uses Luna Max.

## Review focus

- Concurrent movement plus hold changes must not produce a torn ATP aggregate.
- Release, conversion and expiry must participate in the same fence protocol.
- Caller-supplied transactions must not trigger a nested transaction/deadlock.
- A wait across reservation expiry must use the post-fence clock by default,
  including buildable-set and SmartGift callers; an explicit clock remains
  authoritative.
- Authorization denial must occur before fence metadata writes. This task does
  not establish immutable product-catalog metadata or customer fulfillment.

## Task 1: Prove the current reader/writer race

**Files:**

- Extend `apps/server/tests/integration/fr180-atp-reservations.test.js`.
- Extend `apps/server/tests/integration/fr181-smartgift-agent-tools.test.js`
  for the registered tool's implicit and explicitly injected clocks.
- Register both files in `apps/server/vitest.postgres.config.js` so the same
  cases run on SQLite and independent-connection disposable PostgreSQL.
- Follow the real second-connection/fence precedent in
  `apps/server/tests/integration/fr184-inventory-stocktake.test.js` and the
  disposable target helpers; do not substitute a mocked transaction for DB proof.

**Interfaces:** Exercise existing `availableToPromiseFor`,
`applyReservationAction`, `expireDueReservations` and movement/reservation APIs.

- [x] Add deterministic two-connection regression cases for a reader and
  concurrent movement/hold mutation. Assert complete committed quantities and
  unchanged response shape, not just that a lock method was called.
- [x] Add concurrent release plus conversion/expiry fence-participation and delayed-clock cases,
  including explicit `now`, existing transaction and denied viewer behavior.
- [x] On PostgreSQL, wait for both writer row-fence attempts before releasing
  the reader gates; on SQLite, account for blocking before transaction callback.
  An outer transaction-start hook alone is not PostgreSQL contention proof.
- [x] Run the new tests on the original implementation and retain the actual
  failing assertions. Failures must expose consistency/clock behavior, not a
  missing fixture, timeout-only assertion or production connection attempt.

## Task 2: Fence the existing ATP boundary

**Files:** `apps/server/src/modules/inventory/application/inventory-atp-service.js`
and `apps/server/src/modules/agent/tools/smartgift-inventory-tools.js`.

**Interfaces:** Existing `availableToPromiseFor({businessId, productIds, viewer,
db, now})`, reservation actions and expiry retain their public signatures.

- [x] Put ATP authorization, fence acquisition and source reads inside `inTx`;
  pass the same transaction to product, movement and reservation queries.
- [x] Fence release/conversion before authoritative reservation reads/CAS and
  fence expiry before selecting/stamping due rows. Retain state, expiry,
  idempotency and existing denial/error behavior.
- [x] Sample implicit ATP/due-selection clocks after acquiring the fence;
  preserve explicit time injection and avoid nested transactions when `db`
  is already a transaction.
- [x] Preserve omitted clocks through `maxBuildableSets` and `checkInventoryAtp`;
  keep caller-supplied dates unchanged and prove the implicit wrappers across
  expiry with the same real-database regression boundary.
- [x] Run the red regressions to green, plus existing FR-180 and stocktake
  regressions. Root independently verifies the frozen composed change.

## Task 3: Review and qualify the bounded fix

- [x] Independent Luna Max review checks the same source/test delta, lock
  ordering, rollback, clock and authorization boundaries.
- [x] Run the targeted SQLite cases, the disposable PostgreSQL profile,
  applicable caller regressions and Server build.
- [x] Record commands/results in the mutable application verification record;
  leave the original assessment and historical receipts unchanged.

Document governance and delivery are separate gates: run the document chain,
then commit/push to existing [draft PR #723](https://github.com/Freshair129/zuri.ai/pull/723).
The PR records actual document-check and exact-head hosted CI results; this
local implementation status does not claim them in advance. Merge/deployment
retain separate authority, and an E2E/Desktop skip is not a pass. See
[the verification record](application-fixes.md#atp-source-consistency-after-design-approval)
for the executed checks and source fingerprint.

## Customer stock/price integration remains a separate gated deliverable

The owner approved the design, including quantity-independent positive/zero
ATP. The code assessment found three unresolved integration boundaries:

1. **Request and caller:** no approved typed product-fact trigger enters current
   LINE turns. `#sku` is staff catalog authorization; FR-132 remains declared
   and blocked. Do not invent intent recognition or a Customer staff viewer.
2. **Runtime response:** v1 validates only the existing fixed-reply kinds.
   A deterministic product-fact turn needs a reviewed, versioned prepare/result
   amendment and matched Core/Runtime qualification. RECORD context slices are
   model inputs, not a deterministic-reply channel.
3. **Published price and stock grant:** catalog currentness/`NOT_VERIFIED`
   admission is not publication proof. A later typed reader must use authorized
   published manifests and exact producer lineage; stock exposure needs its
   explicit canonical policy/authority contract. No policy signer/store or
   publication acceptance is inferred from this design approval.

These are source/contract prerequisites, not completed features or permission
to add default-deny scaffolding with no consumer. The useful source fix above
does not certify customer access, lot eligibility, exact-price answers or live
LINE/Runtime integration. This plan lives beside its dated assessment rather
than creating another global roadmap or a new plan directory.
