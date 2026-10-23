---
doc_type: implementation-plan
status: implementation
version: "0.2.0"
source_revision: "e444eb461f9fec8ab95e6c09b19b4476261964d5"
---

# LINE stock/price integration and source consistency implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or
> superpowers:executing-plans for the assigned implementation. Checkboxes track
> execution evidence, not new product authority.

**Goal:** Make the existing FR-180 staff/source ATP read consistent with fenced
ledger and reservation mutations, a prerequisite for the approved stock design.

Tasks 1–3 and their constraints below record the completed ATP prerequisite.
Phase 2 is the subsequent owner-authorized LINE integration; its policy, typed
request and Runtime v2 are not prohibited by the earlier phase's narrower scope.

**Architecture:** Reuse Inventory's existing transaction helper and Business
ledger fence. Preserve the current reader and reservation APIs, authorization
and output. Customer stock access and deterministic LINE fact answering remain
separate source/consumer contracts; do not add unused ports to simulate them.

**Tech Stack:** Existing Server JavaScript, Prisma SQLite/PostgreSQL and Vitest.

**Spec:** [Approved stock/price design](../../docs/change-requests/integration/line-agent-stock-price-facts-20261023.md),
[FR-180](../../docs/features/FEAT-025/requirements/FR-180.md) and
[verification policy](../../docs/architecture/VERIFICATION-POLICY.md).

## Phase 1 constraints (ATP prerequisite only)

- Preserve `{ businessId, products, byProductId }` and all existing ATP row fields.
- Reuse `inTx` and `acquireLedgerFence`; support an existing transaction client.
- Retain authorization/error semantics and injected `now`; sample a default
  ATP/due-selection clock after acquiring the fence. Existing wrappers must
  pass an omitted clock through rather than synthesizing an explicit old time.
- Keep exact counts private to the existing authorized staff API; add no
  customer grant, policy store, route, intent matcher, Runtime operation or schema.
- Test only isolated disposable databases; no active development/UAT/production DB.
- Root integrates and runs generators serially. Delegated work uses Luna Max.

## Phase 1 review focus

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

## Phase 1 assessment: customer integration prerequisites

At the Phase 1 source baseline, the owner had approved design only, including
quantity-independent positive/zero ATP. That assessment found these integration
boundaries, which the later Phase 2 mandate below explicitly authorizes filling:

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

These were Phase 1 source/contract prerequisites, not completed features or permission
to add default-deny scaffolding with no consumer. The useful source fix above
does not certify customer access, lot eligibility, exact-price answers or live
LINE/Runtime integration. This plan lives beside its dated assessment rather
than creating another global roadmap or a new plan directory.

## Phase 2: Owner-authorized LINE integration (2026-10-23)

The owner explicitly requested completing all three contracts and the code.
This phase implements revision 0.3.0 of the approved fact contract; the earlier
source-consistency phase remains separately verified historical evidence.

Architecture: one strict #product JSON selector and Core-owned resolver, safe
Inventory and Commerce/Knowledge projections, private durable decision per
job/execution and final-release revalidation shared by Server and Runtime.
Runtime v2 carries only a bounded fixed PRODUCT_FACTS reply, never private
bindings. Keep v1 strict and staff #sku unchanged.

### Task 4: Establish the reviewed source contract

Root owns the approved contract revision, sanctioned standalone FR migration,
registry/ledger writers and shared generators. Preserve all existing subjects
and feature memberships. Independent reviewer checks the exact contract before
source implementation. Canonical source, migration manifest/receipt and exports
must be generated through existing sanctioned tooling, not hand-maintained.

- [x] Review the v0.3.0 contract and register the new source requirement.
- [x] Reconcile intake index, FR-234 follow-up and service contract references.

### Task 5: Implement safe owner projections and typed request

Worker assess_business owns new line-stock-policy-service and its authenticated
route, Inventory stock projection, Commerce published-price reader, a narrow
Knowledge exact-record publication read and modules/agent/line-product-facts.js.
The independent Knowledge/Commerce published-price slice and its tests are
delegated to review_application_patch; assess_business retains the shared
resolver/principal, policy, stock and formatting. Review assignments later exclude
each author's own files and bind to the same composed patch.
Root alone owns Prisma schema, migration and client generation. No fake Viewer,
new price opt-in, direct substrate call or model fallback.

Interfaces: parseLineProductFactsRequest(text) returns null for noncommands,
otherwise a parsed request or deterministic clarification.
resolveLineProductFacts(job,{db,now}) returns {text,binding}.
revalidateLineProductFacts(job,binding,{db,now}) returns a boolean.
The principal is reconstructed from the persisted job and original signed raw
LINE source with the live account/Tenant/Business binding. Availability requests
additionally require an active verified identity, an exact Business-bound Customer
and the original DIRECT user audience. Price-only requests retain the existing
Business-scoped published Knowledge authority; stock-specific gates do not apply.
Policy grants key trusted Tenant + Business + internal LINE account + Product IDs, default OFF, owner-only CAS.
Knowledge validates the verified generation/manifest/source receipt; Commerce
matches PCAT asset hash, exact producer record, Product/quantity/unit, THB safe
minor units and current rules. Final release rechecks the persisted signed job,
live account/Tenant/Business binding and applicable source authority for every
request. Availability and combined requests also recheck the verified identity,
exact non-erased Customer-to-Business binding, DIRECT audience and disclosure
policy. Price-only requests use the existing published Knowledge authorization
without inheriting stock-specific identity, Customer or policy requirements.
Result/source/policy bindings are compared so changed facts never release an
older reply.

- [x] Write and execute failing cases before source code.
- [x] Implement policy authorization/CAS/audit and actual authenticated route.
- [x] Implement source-bound stock/price reads and bounded formatter.
- [x] Prove positive/zero/untracked, exact price including zero, source denial,
  partial/unavailable, malicious/unknown fields, revoked publications and scopes.
- [x] Execute real disposable DB integration tests, not mock-only reader tests.

### Task 6: Wire both LINE cohorts and Runtime v2

Worker assess_core owns Core/Runtime v2 schema, route/client/validation, Server
worker composition, durable content-free AgentTraceEvent fact bindings and
common pre-send gate, plus matching tests. Shared parser/resolver module belongs
to assess_business; coordinate exact imports, no duplicate parser.

- [x] Write and run failing route/version and fixed-turn tests.
- [x] Add versioned v2 PRODUCT_FACTS turns, preserve strict v1 and staff #sku.
- [x] Persist per-job/execution private binding and verify deterministic reply.
- [x] Revalidate on the shared send path before SENDING for both execution owners.
- [x] Prove end-to-end webhook/job/prepare/complete/send parity, zero model calls,
  absent/stale bindings, account/identity/customer revocation or rebind and audience changes between answer and send, policy/publication revocation, retries and old v1 refusal. Applicable consent/erasure is rechecked under its existing owner contract; memory READ/consent is neither an ERP grant nor a new price gate.

### Task 7: Compose, review and verify

Root serializes Prisma/generators, Server Vitest reporter ownership and build.
Runtime's independent Node test suite may run separately. All workers use Luna
Max; preserve other sessions' changes. Integrate actual tests, schema migration,
backup scope and API inventory where applicable.

- [x] Independent Luna Max review of exact composed patch and contract meaning.
- [x] Server targeted DB and cross-service contracts, Runtime tests/build,
  PostgreSQL policy/projection verification and Server build.
- [x] Canonical registry/services/graph/views, governance, readers and corpus.
- [x] Record exact commands/results and remaining live acceptance separately.
  No live LINE send, deployment, active DB migration or disclosure activation
  is implied by local fixture acceptance.


## Phase 2 verification closeout

Implementation and independent author-separated Luna Max reviews are complete.
Final composed Server acceptance passed 29 files / 475 tests with one
PostgreSQL-only race skipped on SQLite; the full disposable PostgreSQL profile
passed 17 files / 158 tests. Runtime passed 91 tests and its 11-source-file
build; Server build and 99 document migration/reader contracts passed.
The [verification record](application-fixes.md) distinguishes earlier failures,
corrections, document checks and exact-head hosted CI from live acceptance.
No live LINE send, deployed migration, disclosure activation or production
publication is claimed. This closes the bounded implementation plan, not those
separate deployment/provider acceptance activities.

After main advanced to 55f9413b through PR #724, the generated state conflict
was rebuilt from the composed tree. Fresh qualification for follow-up PR #725
passed 33 Server files / 526 tests with one PostgreSQL-only skip, the full
17-file PostgreSQL profile / 158 tests, Runtime 91 tests/build, Server build,
governance 0 critical / 0 warning and 99 document contracts. The four additional
Server files are adopted-main Knowledge worker/runtime guards. This adds no
product scope or live acceptance.
