---
id: ZAI:ADR-109
title: "SCM service extraction — one deployable over Inventory, Procurement and Commerce"
version: "0.1.4b"
status: candidate
created_at: "2026-09-24T14:00:00+07:00,Claude Opus 5.5"
last_update: "2026-09-24T22:30:00+07:00,Claude Opus 5.5"
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

# ADR-109 — SCM service extraction: one deployable over Inventory, Procurement and Commerce

**Status:** Candidate. It needs owner review before it counts as a decision. It
is **not** an approval of production cutover, of a restricted database role or
of any consumer wiring. ADR-069 is unchanged: that ADR decided a navigation
group and never decided a runtime, and this ADR does not rewrite its history.

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

**D5 — Delegated scope, not a copied viewer.** The core, as the Identity owner
reached through the BFF, resolves the viewer as it does today and signs a
short-lived `scm.delegation.v1` statement:

- actor;
- Tenant;
- per Business: owner flag, domains and permissions.

SCM verifies issuer, audience, signature and lifetime (default at most 120 s,
which is also the declared revocation window). It never accepts role, owner or
"verified" flags from a request body. A scope refusal returns the same 404 as an
unknown Business. The contract is **PROPOSED** (gate SCM-CORE). The HMAC scheme
and key distribution need the Identity owner's review.

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
- **Revenue read model (0.1.4b):** 7 pinned queries with a golden recorded by
  the legacy engine; the SCM read model reproduces it from its own store (8/8
  both sides). 158 service tests (157 pass, 1 NOT_RUN on Windows).
- **Server regression:** 12 files / 222 tests (receipt slice), 10 files / 121
  tests (commerce/inventory, POS slice), 5 files / 30 tests (payments) and 6
  files / 39 tests (sales orders) pass.
- **Not yet run:**
  - image build and start;
  - PostgreSQL;
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
| 0.1.4b | 2026-09-24 | candidate | Revenue read model on the SCM store, parity-pinned | uncommitted | Claude Opus 5.5 (Session 5) |
