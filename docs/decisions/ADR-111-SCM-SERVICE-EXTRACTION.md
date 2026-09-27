---
id: ZAI:ADR-111
title: "SCM service extraction — one deployable over Inventory, Procurement and Commerce"
version: "0.1.12b"
status: candidate
created_at: "2026-09-24T14:00:00+07:00,Claude Opus 5.5"
last_update: "2026-09-27T10:15:00+07:00,Claude Opus 5.5"
author: Claude Opus 5.5 (Session 5)
attributes:
  doc_type: architecture-decision
  domain: inventory
  scope: "runtime/deployment boundary for the SCM leaf modules; changes no domain key, no RBAC key, no model owner and no URL"
relations:
  - type: relates_to
    target: ZAI:ADR-069
  - type: relates_to
    target: ZAI:ADR-065
  - type: relates_to
    target: ZAI:ADR-066
  - type: relates_to
    target: ZAI:ADR-074
  - type: relates_to
    target: ZAI:ADR-098
  - type: relates_to
    target: ZAI:ADR-038
---

# ADR-111 — SCM service extraction: one deployable over Inventory, Procurement and Commerce

**Status:** Candidate. It needs owner review before it counts as a decision. It
is **not** an approval of production cutover, of a restricted database role or
of any consumer wiring. ADR-069 is unchanged: that ADR decided a navigation
group and never decided a runtime, and this ADR does not rewrite its history.

Renumbered on 2026-09-27 from ADR-109 to ADR-111. Main had assigned ADR-109 to
the Notion OAuth and webhook boundary while this ADR was still a candidate on
branch, and the integrator (MC0) allocated ADR-111. ADR-109 was never pinned to
this ADR on main, so no pinned id changes meaning.

## Context

ADR-069 made SCM the parent slot over Warehouse, Inventory, Procurement and
Order Management in the domain bar. It explicitly kept the leaf keys
(`inventory`, `procurement`, `commerce`), their charters and their models.
Nothing in it approved a standalone SCM runtime.

The owner now wants three things:
- edit a price formula, a stock rule or the purchase-order flow;
- test the affected part without starting Next.js, LINE, Files, MSP or GKS;
- prove the business flow through a separate SCM process.

The discovery in `docs/migrations/service-extraction/SCM-HANDOFF.md` §2
establishes the constraints this decision must respect:

- **The atomic groups cross the leaf modules.** Goods receipt, POS checkout and
  sales-order completion all append Inventory ledger rows through
  `appendMovement(tx, …)` inside the caller's transaction. The supplier
  cost-sheet commit writes Product carton facts through Inventory inside
  Procurement's transaction.
- **Every write also writes the core `AuditEvent`** through
  `project-manager/application/audit` in the same transaction.
- **Commerce reads other owners' data.** It reads Customer, Conversation,
  Branch, FileAsset and LegalEntity, and billing writes LegalEntity and Branch
  address fields.
- **The whole-database backup/restore scripts** read and write every SCM
  table.

## Decision

**D1 — One SCM deployable, several logical owners.** `services/scm` is one
process that hosts the Inventory, Procurement and Commerce modules. Pricing
stays inside Commerce: it is Commerce's semantic concern, not a service of its
own. No Stock, Lot, Reservation, PO or Pricing microservice is created. Each
module keeps its charter's models, its own adapter (the only writer of its
tables) and its own public in-process API (`modules/<m>/index.js`). SCM, the
umbrella, owns only its local evidence tables: `ScmOperationReceipt`,
`ScmAuditEvent`, `ScmOutbox` and `ScmSchemaVersion`. It never claims a leaf
model.

**D2 — One transactional store for the atomic groups.** Modules that must
commit together share one unit of work inside the SCM process. A cross-module
use case (the receipt workflow is the first) calls the other module's public
writer inside that unit of work; it never writes that module's tables and never
performs a remote write mid-transaction. An atomic group moves into SCM
**whole** or stays in the legacy writer marked `SHARED_TRANSITION`. Splitting a
group into an HTTP call plus a local transaction is refused. So is a saga
without a separate owner decision.

**D3 — One pricing evaluator, one hand-edited source.** During the transition,
the domain code production runs has one hand-edited source:

- the pricing evaluator (`apps/server/src/modules/commerce/domain/pricing-*.js`);
- the procurement calculators;
- the inventory movement rules and enums.

`services/scm/scripts/sync-kernel.mjs` generates the service copy
(`src/kernel/**`) with an import-only rewrite. `--check` and
`test/unit/kernel-sync.test.js` fail on any drift. Ownership moves to the
service copy, and the legacy copy is deleted, only when the SCM process becomes
the sole executor of the flows that use it. This keeps the image independent of
`apps/server`, and keeps a single evaluator for preview, calculation and
runtime. `packages/pricing-engine` was rejected because no second consumer
exists yet.

**D4 — Keys and URLs do not change.** Authorization in SCM applies the legacy
ladder per operation on the leaf keys:

| Operation | Needs |
|---|---|
| View | Domain `procurement` / `inventory` |
| Write a PO or supplier | `procurement.po.write` or Business owner |
| Post a receipt | `procurement.receipt.post` or Business owner |
| Write stock | Domain `inventory`, plus `inventory.catalog.write` or Business owner |

There is no `scm` grant. A Procurement permission never widens Inventory
(ADR-066 D4). The service identity that carries a request is not a business
authority.

**D5 — Core resolves the viewer; SCM never trusts an asserted one (revised
2026-09-27, owner decision: the ADR-108 D4 pattern).** Core stays the only
identity authority, the same way as for Market Intelligence and Conversation
Runtime:

- The BFF calls SCM with its own static service token (`SCM_API_TOKEN`) and
  passes the end user's session credential through unchanged in `x-zuri-subject`.
  The token proves the caller is the BFF; it is never a business authority.
- SCM asks core's private façade `/api/internal/scm/v1/resolve-scope` (contract
  `scm-core.v1`, SCM authenticating with a different token, `SCM_CORE_TOKEN`) to
  resolve that subject into actor, Tenant and, per visible Business, the owner
  flag, domains and permissions. The BFF also sends the user's active Business
  in `x-zuri-business-id`. It is a selector, never an authority: core answers
  the selected Business's Tenant and only the Businesses the subject sees there,
  and refuses a Business the subject cannot see with the same 404 as an unknown
  Business. So a viewer with memberships in several Tenants works one Tenant at
  a time, as the legacy one-active-Business screen does (owner ruling,
  2026-09-27).
- The same façade serves the Branch, Customer and Conversation facts (D-10 and
  the ReferenceAuthority consequence below). It re-resolves the subject on every
  call and answers `null` without Commerce view of the named Business. Customer
  and Conversation facts come through a reader the CRM module exports
  (`crm/scm-reference-reader.js`); the façade does not read CRM's models
  itself (owner ruling, 2026-09-27). Payment-slip files stay behind SCM-FILES.
- SCM applies its unchanged legacy ladders to that scope. It never accepts role,
  owner or "verified" flags from a request, and a scope refusal is the same 404
  as an unknown Business. An unreachable core refuses retryably (503) with no
  effect.
- SCM keeps successful `resolve-scope` answers in a short in-process cache
  (default 15 s, never above 60 s, 0 turns it off; bounded, least recently used
  evicted first). The key is a hash of the subject, the selected Business and
  the core credential, so the raw subject is never stored. Refusals, errors and
  outages are never cached, and facts are never cached. **Accepted tradeoff
  (owner ruling, 2026-09-27):** a session revoked or a grant changed in core can
  keep acting in SCM for up to that TTL.

The earlier draft had core sign a short-lived HMAC `scm.delegation.v1`
statement. It is kept only as a test and non-production seam and is refused in
production, because a signed actor assertion is a second trust root (ADR-108
D4). The contract is **PROPOSED** (gate SCM-CORE): the consumer side is built
and tested against a fake core in `services/scm`; the provider façade in
apps/server and the Core and CRM owners' review are pending.

**D6 — Business commands, durable identity, evidence in the same unit of work.**
- **Business commands only.** The external API exposes business commands (post
  a receipt), never generic CRUD, SQL or remote transactions.
- **Idempotency-Key on every mutation.** It is scoped by Tenant, Business,
  action and actor.
- **Evidence commits with the effect.** The receipt, local audit and outbox row
  commit in the same unit of work as the effect.
- **Replay.** Same key and same payload returns the stored outcome after
  re-checking current authority. Same key with a different payload returns 409.
- **Unknown outcome.** On network loss or a 5xx, the caller looks the result up
  by key; it never re-sends under a new key.
- **Outbox.** It records committed facts for a future idempotent relay to the
  core audit view. SCM does not become the owner of the global `AuditEvent`.

**D7 — Persistence tranche order.** The service-local store first (SQLite for
dev/test, schema applied by the migration owner, never self-migrated in
production). A PostgreSQL adapter follows with its own concurrency proof.
Physical data ownership (a restricted role, then a separate store) comes after
the runtime slice and is reported as its own status. Cutover moves one aggregate
group at a time with a single-writer switch that both legacy and new writers
check.

**D9 — One synchronous unit-of-work port, two engines.** Modules call
`sql.get/all/run` synchronously inside a unit of work (the `node:sqlite` shape).
The PostgreSQL store keeps that port: one `pg` connection per process in a worker
thread, the caller blocking while a statement runs, units at READ COMMITTED,
reads in a REPEATABLE READ snapshot, a bounded re-run on serialization, deadlock
and unique-violation errors. The SCM invariants on PostgreSQL rest on
compare-and-swap predicates, the ledger fence, the order-row lock and unique
constraints — not on a writer lock — and each of those guards has a PostgreSQL
race test that fails without it. The whole suite runs on both engines.

**D8 — Correctness changes are recorded, not smuggled.** Two differences from
legacy are recorded in the handoff:

- **The receipt's PO update is a version compare-and-swap.** This closes a
  potential over-receipt under READ COMMITTED; the legacy fix is proposed as a
  separate hotfix.
- **A lot's first expiry is set through Inventory's writer.** Procurement no
  longer updates `ProductLot` directly.

Price formulas, FX, floors, tax and approval semantics are unchanged. The pinned
parity golden proves this for the evaluator.

## Alternatives and consequences

- **Rejected: split Stock, PO and Pricing into separate services.** Every atomic
  group above would become a distributed transaction or an unapproved saga.
- **Rejected: an `scm` RBAC key.** It widens PO authority to stock and pricing,
  and ADR-069 D2 already refused it.
- **Rejected: move the code and keep the monolith DB credential.** That is a
  relocation, not an extraction. It is allowed only as a labelled transition
  (`DATA_OWNERSHIP_ENFORCED = NOT_RUN`).
- **Consequence: fulfilment, recipe, transfer, stocktake and work-order paths
  keep running in legacy** until each group moves whole. They append ISSUE and
  ADJUSTMENT movements through the legacy writer. The SCM writer already takes
  RECEIPT and ISSUE (POS moved whole) and refuses the rest explicitly
  (`SCM_MOVEMENT_KIND_NOT_MIGRATED`, `SCM_SERIAL_ISSUE_NOT_MIGRATED`,
  `SCM_UNIT_CONVERSION_NOT_MIGRATED`).
- **Consequence: references to masters SCM does not own are facts, not copies.**
  Branch (core), Customer (CRM) and payment slips (Files) come through a
  ReferenceAuthority port. The facts are read before the unit of work and judged
  inside it in legacy order. The window between the read and the commit is
  declared and reported. An unavailable owner refuses the operation; SCM never
  assumes the reference is valid.
- **Consequence (D9): one unit at a time per process.** A unit waiting on a
  row lock holds its process for up to `lock_timeout` (then 503 busy); capacity
  grows with processes. An asynchronous port is a later refactor with its own
  evidence, not a prerequisite.
- **Consequence: a second writer is possible while the store is not yet
  shared.** Two writers to the same logical tables must not both be live for one
  cohort. That is a cutover gate, not a runtime flag. Tenant-wide uniqueness
  (bank reference, order and payment codes) and payment verification span POS,
  payments and sales orders, so those three switch together per Tenant.

## Verification

Tranche evidence lives in `docs/migrations/service-extraction/SCM-HANDOFF.md`.
For this candidate revision:

- **Pricing parity:** 64 pinned cases, legacy recorder and SCM kernel both
  PASS.
- **Receipt slice:** 103 service tests (102 pass, 1 NOT_RUN on Windows). They
  include two-process SQLite contention, rollback at four injected faults, a CAS
  interleaving test, crash after commit with restart and lookup, contract
  checks, module-boundary scans and image-context checks.
- **POS checkout (0.1.1b):** 126 service tests (125 pass, 1 NOT_RUN on
  Windows), including every legacy FR-183 case, FEFO, dedication, rollback at
  four faults and a two-process oversell test.
- **Payments (0.1.2b):** 136 service tests (135 pass, 1 NOT_RUN on Windows),
  including legacy AC-163.1–163.3, the FR-196 audit assertions, a Payment CAS
  interleaving test and a two-process refund-ceiling race.
- **Sales orders (0.1.3b):** 150 service tests (149 pass, 1 NOT_RUN on
  Windows), including legacy AC-162.1–162.6, the Commerce cohort end to end, an
  order CAS interleaving test and a two-process fulfilment race.
- **Inventory catalogue writers + SKU identity (0.1.9b):** create paths,
  bundles, UPDATE/PHASE_OUT/REACTIVATE, identifiers, unit conversions (the
  ledger now converts pack units) and resolve move; ARCHIVE and MERGE stay in
  legacy until reservations, recipes and work orders move. 221 service tests on
  both engines (220 pass, 1 NOT_RUN on Windows).
- **POS terminal catalogue (0.1.8b):** the read moves onto the SCM store with
  Branch facts from the core owner; 2/2 catalogues reproduce a legacy-recorded
  golden; 202 service tests on both engines (201 pass, 1 NOT_RUN on Windows).
- **PostgreSQL (0.1.7b):** the same 197 service tests pass on embedded
  PostgreSQL 17 (196 pass, 1 NOT_RUN on Windows) and on SQLite; the guard proof
  reproduces F-1, F-9 and F-12 on PostgreSQL (3/3 runs each) when the matching
  SCM guard is removed, while SQLite hides all three.
- **Supplier cost sheets (0.1.6b):** preview/commit move whole; the carton
  facts go through Inventory's own writer inside Procurement's unit of work (the
  D2 rule: one module's use case, another module's public API). Preview parity
  4/4 against a legacy-recorded golden; 188 service tests (187 pass, 1 NOT_RUN
  on Windows); legacy procurement regression 22/22.
- **Pricing rules (0.1.5b):** draft/update/approve/revoke and calculation move
  whole onto the parity-pinned kernel; the seven legacy FR-253 cases are
  mirrored, plus normalized-key, replay-guard, store-immutability, CAS
  interleaving and two-process tests. 173 service tests (172 pass, 1 NOT_RUN on
  Windows); legacy pricing regression 173/173.
- **Revenue read model (0.1.4b):** 7 pinned queries with a golden recorded by
  the legacy engine; the SCM read model reproduces it from its own store (8/8
  both sides). 158 service tests (157 pass, 1 NOT_RUN on Windows).
- **Server regression:** 12 files / 222 tests (receipt slice), 10 files / 121
  tests (commerce/inventory, POS slice), 5 files / 30 tests (payments) and 6
  files / 39 tests (sales orders) pass.
- **Not yet run:**
  - image build and start;
  - a managed PostgreSQL (pooler, TLS, restricted role);
  - consumer (BFF) integration;
  - restricted role and migration rehearsal;
  - CI.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-24 | candidate | Initial proposal with the first vertical slice | 45092b78 | Claude Opus 5.5 (Session 5) |
| 0.1.1b | 2026-09-24 | candidate | POS checkout moved whole; ReferenceAuthority consequence; POS/payments/sales orders switch together | d2a73275 | Claude Opus 5.5 (Session 5) |
| 0.1.2b | 2026-09-24 | candidate | Payments (record/verify/reject/refund) moved whole | dab82845 | Claude Opus 5.5 (Session 5) |
| 0.1.3b | 2026-09-24 | candidate | Sales orders (create/actions/fulfilment/list) moved whole; all Commerce writers now in SCM | 7ee12a29 | Claude Opus 5.5 (Session 5) |
| 0.1.4b | 2026-09-24 | candidate | Revenue read model on the SCM store, parity-pinned | 105d90c7 | Claude Opus 5.5 (Session 5) |
| 0.1.5b | 2026-09-24 | candidate | Pricing rules lifecycle + calculation moved whole; catalog freeze stays behind SCM-FILES/SCM-KNOWLEDGE (F-11) | cd3abb54 | Claude Opus 5.5 (Session 5) |
| 0.1.6b | 2026-09-24 | candidate | Supplier cost sheets moved whole (Procurement + Inventory carton writer in one unit of work) | 1810c90c | Claude Opus 5.5 (Session 5) |
| 0.1.7b | 2026-09-24 | candidate | D9: PostgreSQL store behind the same synchronous port; suite on both engines; guard proof for F-1/F-9/F-12 | ccb3db24 | Claude Opus 5.5 (Session 5) |
| 0.1.8b | 2026-09-24 | candidate | POS terminal catalogue read moved; Branch list as a ReferenceAuthority fact | 14c8e7dd | Claude Opus 5.5 (Session 5) |
| 0.1.9b | 2026-09-24 | candidate | Inventory catalogue writers + SKU identity moved (F-13 writers); ARCHIVE/MERGE stay legacy | uncommitted | Claude Opus 5.5 (Session 5) |
| 0.1.10b | 2026-09-27 | candidate | Renumbered from ADR-109 to ADR-111 (ADR-109 went to Notion on main; MC0 allocated 111); no decision text changed | this merge | Claude Opus 5.5 (Session 5) |
| 0.1.11b | 2026-09-27 | candidate | D5 revised to the owner-approved option 2: core resolves the subject through the private scm-core.v1 facade (ADR-108 D4 pattern); HMAC delegation kept only as a test/non-production seam | this change | Claude Opus 5.5 (Session 5) |
| 0.1.12b | 2026-09-27 | candidate | D5 per owner rulings: Business selector on resolve-scope (one Tenant per request), Customer/Conversation through a CRM-exported reader, short success-only scope cache with the revocation tradeoff recorded | this change | Claude Opus 5.5 (Session 5) |
