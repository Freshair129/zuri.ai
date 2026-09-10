# Warehouse P4 console contract proposal — owner review

**Date:** 2026-09-11  
**Branch:** `codex/finish-warehouse-20260911`  
**Base:** `origin/main` at `f320e888`  
**Review status:** Proposed; no implementation or requirement-registry change is authorized by this file  
**Tentative requirement:** The parent session has tentatively reserved FR184. This proposal does not declare, renumber, or write FR184 to the registry or ID ledger.
**Proposal revision:** 0.3 (backup and restore durability review)

## Purpose

This proposal defines the smallest reviewable Warehouse P4 slice that can expose the
located stock already implemented by Inventory and add a safe physical-count desk.
It keeps the `warehouse` navigation slot as the user-facing console while
Inventory remains the owner of `WarehouseLocation`, `StockMovement`, and all
ledger writes. It does not introduce a second Warehouse domain, a duplicate
inventory schema, bins, campaigns, synchronization, or outbound integration.

The decision requested from the owner is whether this contract is acceptable as the
basis for a subsequent implementation and requirement note.

## RCA

### Symptom

The retained `feat/p4-inventory-warehouse` prototype presents a Warehouse screen,
but its location, alert, ATP, and stocktake results are not trustworthy against the
current Inventory contract. It fabricates three locations, infers location from
free-text movement references, compares a location count with Business-wide stock,
coerces invalid counts, and commits adjustment rows one at a time.

### Evidence

The current mainline authorities are already present and enumerated:

- `apps/server/src/modules/inventory/application/warehouse-location-service.js`
  exports `listLocations` and `locationStock`. They read Business-scoped
  `WarehouseLocation` rows and `sourceLocationId` / `targetLocationId` ledger
  fields, and keep the unlocated remainder beside located stock.
- `apps/server/src/modules/inventory/application/location-transfer-service.js`
  exports `transferStock`. It writes the source ISSUE and target RECEIPT through
  `appendMovement` in one transaction.
- `apps/server/src/modules/inventory/application/inventory-shelf-life-service.js`
  exports `shelfLifeAudit` and `recordLotMaintenance`, with FR-179 state
  calculation in `domain/inventory-wip.js`.
- `apps/server/src/modules/inventory/application/inventory-atp-service.js`
  exports `availableToPromiseFor`, whose result separates on-hand, committed
  reservations, live quote reservations, available ATP, and over-commitment.
- `apps/server/prisma/schema.postgres.prisma` contains the existing
  `StockMovement`, `ProductLot`, `SerialUnit`, `WarehouseLocation`, and
  `StockReservation` records. `StockMovement` is append-only and already has
  nullable location, lot, and serial references. There is no stocktake record.
- `docs/domains/inventory/CHARTER.md` says Inventory owns the location model and
  atomic transfers but keeps the Warehouse console, cycle counting, and stocktake
  campaigns out of the current delivery.
- `docs/decisions/ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md`
  records the location/transfer contract and explicitly lists cycle counting as a
  later Warehouse-console slice.
- `docs/decisions/ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md`
  keeps `warehouse` as a reserved `soon` child/bar slot and currently has no
  `/warehouse` page.

The old branch `feat/p4-inventory-warehouse` at `146d0914` contains the
following conflicting implementation details:

- `inventory-warehouse-service.js` defines `DEFAULT_LOCATIONS` and
  `extractLocationFromReference`, defaulting missing references to `MAIN_WH`
  and parsing `[LOC:...]`, `WH-`, and `LOC-` text.
- `aggregateStockByLocation` groups all movements by that parsed text and
  clamps each output total with `Math.max(0, ...)`; it does not use the real
  location IDs or movement source/target fields.
- `reconcileStocktake` uses Business-wide and lot-only sums, silently turns a
  missing, negative, decimal, or non-numeric count into a truncated nonnegative
  integer, creates a random batch id, writes a free-text location reference, and
  loops `recordMovement` for each adjustment without one surrounding transaction.
- `getInventoryAlerts` duplicates shelf-life calculations and omits ATP's
  committed/live reservation split. `calculateAvailableToPromise` is a second
  local ATP calculator.
- `WarehouseWorkspace.jsx` initializes every count against `MAIN_WH`, reads
  prototype route shapes, and offers no snapshot, idempotency, stale-count, or
  serial-unit contract.
- The old unit test only proves those prototype helpers; it does not prove a
  real location join, atomic rollback, idempotent replay, stale snapshot refusal,
  or serial/lot count boundaries.

### Root cause

The prototype was built as a standalone warehouse model on top of the old
Business-wide ledger. It treated a movement's human reference as location state
and treated a stocktake as a loop of independent signed writes. That bypassed the
current Inventory ownership and left no durable operation identity or read
snapshot with which a retry or concurrent movement could be reasoned about.

### Why the issue escaped detection

The prototype tests exercised the helper functions in isolation and used the
prototype's own fake locations and route shapes. Existing FR-155 and FR-174 tests
prove the authoritative ledger and transfer services, but there was no console
route or stocktake acceptance contract connecting them.

### Proposed prevention

The implementation must use the existing Inventory service/domain authorities,
test each concurrency and tracking invariant against a real test database, and
keep the Warehouse route/page as a thin Business-scoped projection. The
stocktake commit must have a durable operation key and an immutable read
snapshot; all writes must happen in one transaction through the existing ledger
writer and audit path.

## Proposed slice

### 1. Located-stock console

The Warehouse console is a page under the reserved Warehouse surface, backed by
Inventory-owned services. It is always scoped to the selected Business; the
server validates the viewer's Business visibility and derives tenant scope.

The read contract is:

`GET /api/inventory/warehouse/locations?businessId=<id>`

The route is a thin adapter over `listLocations` and `locationStock` (with an
optional product filter). Its response contains:

- `businessId`;
- active locations with UUID `id`, stable `code`, name, type, virtual flag,
  and status;
- per-product located rows keyed by `locationId`, including product identity,
  integer on-hand, and lot/serial detail where the authoritative read provides
  it;
- `unlocated` and Business-wide `total` as separate values.

The UI must use location UUIDs and the canonical nine location types. It must not
create default rows, parse `reference`, assign unlocated rows to a named
location, or clamp a negative authoritative balance. Archived locations remain
visible only when explicitly requested for history and cannot receive transfers.

An optional transfer action may call the existing
`POST /api/inventory/warehouse/transfers` adapter over `transferStock`. It
accepts real source/target location IDs, product, quantity, lot/serial input
according to the existing ledger contract, and an optional reference. The
service remains the only writer. The response must expose the pair's result and
authoritative `onHandAfter`; a failed issue, shelf-life refusal, lot mismatch,
or permission check writes no half-transfer.

Location creation, rename/archive, bins, putaway rules, route optimization, and
stock movement import remain out of this slice.

### 2. Alerts and ATP

The console may combine these existing reads into one honest radar response:

- FR-179 `shelfLifeAudit({ businessId, thresholdDays, includeEmpty, viewer, now })`
  for `OK`, `DUE`, and `EXPIRED` lot state. Expired stock remains visible;
  issue/kitting refusal remains the existing service rule.
- FR-180 `availableToPromiseFor({ businessId, productIds, viewer, now })`
  for tracked products. The UI labels `onHand`, `committed`,
  `reservedForQuotes`, `available`, and `overCommitted` separately.
- Existing Inventory stock summary/calculator for safety-stock comparison. A
  safety alert is Business-wide unless a location-specific threshold is
  explicitly defined in a later approved contract.

The response includes `businessId` and `generatedAt`. A failed or unavailable
read is shown as an error/unknown state; it is never rendered as zero or as a
provider-success claim. The route validates `thresholdDays` as finite and
nonnegative before passing it to the shelf-life service. The prototype's local
ATP and duplicate expiry implementation are removed rather than used as a
second source of truth.

### 3. Physical count preview

A count is a snapshot-based reconciliation of authoritative on-hand, scoped by
Business and physical location. It is a preview first, then a commit of the
unchanged preview.

The request shape is strict and canonical:

```json
{
  "businessId": "uuid",
  "lines": [
    {
      "locationId": "uuid-or-null-for-unlocated",
      "productId": "uuid",
      "lotId": "uuid-or-null",
      "countedQuantity": 12
    }
  ]
}
```

The exact route names may be finalized in the approved feature note, but the
server must expose separate `preview` and `commit` phases or an equivalent
phase field. A preview returns:

- a server-created `previewId`;
- `businessId`, `generatedAt`, and an opaque `snapshotToken`;
- normalized unique line keys;
- authoritative expected quantity for each
  `locationId + productId + lotId` bucket;
- counted quantity, signed variance, and status;
- explicit `unlocated` handling;
- validation errors without any ledger write.

The server never trusts client-supplied expected quantity, location code,
product code, or batch id. It computes expected quantities from
`sourceLocationId`/ `targetLocationId` and lot/serial identity.

Count input validation is strict:

- `countedQuantity` is a finite integer greater than or equal to zero; missing,
  negative, decimal, NaN, and string-coerced values are rejected with 422.
- A line key is unique. A location is a UUID or explicit null for the unlocated
  bucket; a free-text `[LOC:...]` value is rejected.
- `stockPolicy !== TRACKED` products cannot be counted.
- `trackingMode === NONE` may use a numeric product/location count.
- `trackingMode === LOT` must identify one lot per line. A product-level
  aggregate without a lot is rejected because it would hide a lot variance;
  the UI can create one line per known lot plus an explicit unknown/unlocated
  refusal.
- `trackingMode === SERIAL` does not accept a numeric adjustment. This slice
  may display serial units and their location evidence, but a committed serial
  count requires an explicit observed serial set (known unit IDs/serial numbers)
  and a separate approved contract for unknown, missing, duplicate, or moved
  serials. Until that contract is approved, serial stocktake lines are refused
  with a stable 422 code rather than inventing quantities.
- A count never silently assigns unlocated stock to a location. The preview
  shows it as `locationId: null`; if a caller omits that bucket, the response
  marks the result incomplete and commit is refused until the caller explicitly
  chooses whether it counted the unlocated bucket.

### 4. Commit atomicity and idempotency

A commit request carries:

```json
{
  "businessId": "uuid",
  "previewId": "uuid",
  "snapshotToken": "opaque",
  "idempotencyKey": "client-operation-key",
  "lines": [ "the exact normalized preview lines" ]
}
```

The owner-approved implementation must satisfy these rules:

1. The service validates the Business/viewer, loads the server-persisted preview
   by `previewId` inside that Business, and validates the normalized payload and
   idempotency key before writing. A client-supplied expected quantity or hash is
   never the authority.
2. It opens one database transaction and acquires the Business's shared ledger
   fence before reading any stock. The same fence is acquired by
   `appendMovement` before its on-hand read, so an ordinary receipt, issue,
   transfer, work-order movement, or stocktake cannot pass the fence while this
   transaction verifies and applies its count. The transaction then recomputes
   the snapshot for every affected product/location/lot bucket and compares it
   with the persisted preview's `snapshotVersion` and `snapshotHash`. Any
   movement or relevant tracked-unit change after preview returns 409
   `INVENTORY_STOCKTAKE_SNAPSHOT_STALE`; no adjustment or audit row is committed.
   A second concurrent commit of the same preview re-reads its row after waiting
   on the fence and returns the stored result rather than writing twice.
3. It derives each signed adjustment from
   `countedQuantity - expectedQuantity`. The client cannot provide a signed
   quantity. Every nonzero adjustment is appended through
   `appendMovement` as an `ADJUSTMENT` with real location/lot identity and
   a server-created stocktake reference. The adjustment rows and their audit
   records commit together; any failure rolls back the entire batch.
4. The operation key is durable and Business-scoped. The first successful commit
   stores the normalized payload hash and result. Repeating the same key with
   the same payload returns the stored result and appends no rows. Reusing it
   with a different payload in the same Business returns 409
   `INVENTORY_STOCKTAKE_IDEMPOTENCY_CONFLICT`; the same key string in another
   Business is an independent operation.
5. The successful result reports the operation/batch ID, committed adjustment
   movement IDs, line outcomes, and authoritative post-commit balances. A
   zero-variance commit may store a completed no-op result so a retry remains
   deterministic.
6. A stale snapshot, validation error, authorization refusal, or any failed line
   produces no partial movement and no "committed" success response.

The preview and operation record is a bounded Inventory aggregate named
`InventoryStocktake`; it is not an equivalent global receipt and is not a second
Warehouse ledger. Add it to the canonical SQLite schema
(`apps/server/prisma/schema.prisma`) and regenerate the checked-in PostgreSQL
schema (`schema.postgres.prisma`) from that source. Its minimum fields are:

```text
InventoryStocktake
  id                   String   @id @default(uuid())
  tenantId             String
  businessId           String
  idempotencyKey       String
  payloadHash          String   // SHA-256 of canonical normalized count lines
  normalizedLinesJson  String   // includes server expected/count/variance rows
  snapshotVersion      Int      // InventoryLedgerFence.mutationRevision at preview
  snapshotHash         String   // sorted affected-ledger/unit fingerprint
  status               String   // PREVIEWED | COMMITTED
  resultJson           String?
  committedAt          DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  version              Int      @default(1)

  @@unique([tenantId, businessId, idempotencyKey])
  @@index([businessId, status, createdAt])
```

The server generates `id` as the retrievable `previewId`. Commit loads that row
by `id`, `tenantId`, and the authorized `businessId`; it does not accept a
client-created opaque snapshot as authority. If the request includes the
returned hash, it is only a consistency check against the persisted row. A
same-key/same-payload replay returns the stored row/result; a same-key/different
payload is a 409 conflict. The compound uniqueness deliberately scopes the key
to a Business: the same string in another Business is an independent operation.
All key lookups include the already-authorized Business scope, so an unknown
preview/key in another Business returns the same generic not-found response and
cannot become a cross-Business conflict oracle.

The shared fence is a second small Inventory-owned record, named
`InventoryLedgerFence`, with `id`, `tenantId`, `businessId`,
`mutationRevision` (default 0), `createdAt`, and `updatedAt`, plus
`@@unique([tenantId, businessId])`. `acquireLedgerFence(tx, businessId)` must
atomically ensure the row and issue a lock-only update (for example, touching
`updatedAt`) as the first write-side statement in `appendMovement` and in
stocktake preview/commit. The update holds the row lock until the transaction
ends. `advanceLedgerFence(tx, businessId)` increments `mutationRevision` only
after `appendMovement` has appended its movement/audit rows; a preview or a
commit that has not yet changed stock never advances it. The normal writer
cannot read on-hand before acquiring the lock; transfer and work-order callers
inherit it through `appendMovement`.

The preview stores the current `mutationRevision`, not a revision created by
the act of taking the preview. A second preview therefore does not invalidate
the first one. A successful stock or serial-unit mutation advances the revision
and makes every older affected preview stale. Serial-unit status changes are
currently made only inside `appendMovement` and therefore share this fence;
the accepted numeric count scope is NONE/LOT only. Shelf-life maintenance
changes a lot's ageing metadata, not its physical quantity, so it does not
invalidate a numeric count. Any future writer that changes tracked quantity or
serial state must call the same fence before reading/writing.

#### FR-045 backup and restore durability

`InventoryStocktake` and `InventoryLedgerFence` are recoverable Inventory state,
not transient UI/cache rows. The implementation must add both to the existing
FR-045 `SNAPSHOT_MODELS` list in `apps/server/src/modules/project-manager/application/backup-service.js`:

1. `inventoryLedgerFence` follows `stockMovement`, because its revision fences
   the complete located ledger and has no child foreign keys.
2. `inventoryStocktake` follows `inventoryLedgerFence`, because its persisted
   normalized lines and result refer to the already-restored product, lot,
   serial, and location identities. The reverse order is used by the existing
   deletion loop. It stays before work-order/reservation rows because those rows
   are independent of a stocktake record.

The snapshot schema version must advance from `1.0` to `1.1` when these models
land. A `1.0` snapshot must be refused by preview after the change rather than
silently restoring an installation without pending count retries or the ledger
revision that makes them safe. Every `1.1` export contains both table keys even
when their arrays are empty. The existing single transaction still deletes in
reverse `SNAPSHOT_MODELS` order and creates in forward order; no separate partial
Inventory restore is allowed.

Restore must preserve `InventoryStocktake.id`, Business-scoped
`idempotencyKey`, canonical `payloadHash`, `normalizedLinesJson`, status,
`resultJson`, and the exact `snapshotVersion`/`snapshotHash`. It must preserve
`InventoryLedgerFence.mutationRevision` exactly; restore must not reset it to
zero or increment it merely because rows were recreated. Neither model contains
secret material, so no redaction transform is needed. Repeating the same full
snapshot import must recreate the same operation key and fence revision without
duplicate rows, using the existing destructive restore transaction. A post-restore
same-key stocktake commit must return the persisted result when the payload is
the same and must raise the existing Business-scoped conflict for a different
payload.

The backup proof must seed a fence at a nonzero revision and both a `PREVIEWED`
and `COMMITTED` stocktake row, export them, mutate/delete them, restore the
snapshot twice, and assert exact row identity, revision, operation key, and
result preservation. It must also prove a stale post-restore movement advances
the restored revision and makes the restored preview stale. This extends the
existing FR-045 backup integration/unit evidence; it does not create a second
backup path.

Provider strategy is explicit:

- PostgreSQL uses the row update/upsert lock held to commit. No claim relies on
  a READ COMMITTED snapshot remaining stable; a movement that starts while a
  stocktake holds the fence waits, then reads the post-commit ledger. A
  deterministic integration test must hold a preview/commit transaction at the
  fence barrier, attempt a concurrent `appendMovement`, and prove either the
  movement waits and the commit succeeds against the pre-movement snapshot or
  the commit returns the stale code after the movement commits. The test must
  also prove a second commit cannot append duplicate rows and that a second
  preview alone leaves the first `mutationRevision` valid.
- SQLite has no `FOR UPDATE`; the same upsert/update is the portable fence and
  SQLite serializes the write transaction. The test uses two deferred promises
  around the fence to prove the same ordering locally. No raw Postgres locking
  syntax is sent to SQLite. The schema/migration is generated from the
  canonical SQLite model, and production Postgres migration SQL is an owner and
  deployment step outside this lane.

The owner must approve these concrete model names, fields, uniqueness scope,
fence behavior, and provider tests before implementation and migration work.

### 5. Authorization and truthful UI

Reads require Business visibility and the Inventory/Warehouse capability already
resolved by the shell. Transfers, location writes, and stocktake commits require
the existing Inventory manager/owner write authority. Every response remains
Business-scoped and uses stable server error codes. The UI disables commit when
the preview is stale or incomplete, shows the server's expected/count/variance
values, and refreshes after a successful transaction. It never claims a movement
was sent to an external provider.

## Out of scope

- New Warehouse domain/module or a duplicate stock schema.
- Bin master data, putaway/pick paths, campaign scheduling, cycle-count
  assignment, or workforce workflows.
- Numeric serial stocktake shortcuts, unknown serial auto-creation, or silent
  serial relocation.
- Procurement/FlowAccount/LINE/Excel synchronization, customer messaging, or
  deployment/production migration.
- Changes to the existing FR-155, FR-174, FR-179, or FR-180 business rules.

## Acceptance evidence after approval

The implementation lane should add meaningful regression coverage for:

1. real UUID location joins, explicit unlocated balances, and no reference parsing;
2. transfer failure rollback and Business-wide conservation;
3. alert response composition with shelf-life and ATP fields, including an
   expired reservation and an unknown/untracked product;
4. strict count validation (negative, decimal, missing, duplicate, wrong
   tracking mode);
5. a movement that commits after preview and before commit returning
   `INVENTORY_STOCKTAKE_SNAPSHOT_STALE` with zero count writes, plus a movement
   attempted while a commit holds the fence waiting and applying only after the
   stocktake transaction ends;
6. one failing line rolling back every adjustment;
7. same-key same-payload replay returning the same result with no duplicate
   movements, and same-key different-payload conflict;
8. serial count refusal until the explicit serial-observation contract exists;
9. browser proof of Business switch, located/unlocated presentation, truthful
   alert/ATP labels, preview, stale refusal, and successful refresh.

Local test, build, governance, and browser evidence must be reported separately
from production or clean-device evidence. No deployment or real credential use is
part of this proposal.

## Owner decision

Please approve or reject this contract, including the bounded Inventory stocktake
aggregate/idempotency record and the explicit serial-count limitation. Upon
approval, the implementation lane may write the feature note/registry change
through the governance tooling and then implement the API, console, transaction,
tests, and browser evidence. Until then this worktree contains documentation and
read-only analysis only.

## Proposal revisions

| Revision | Date | Change |
|---|---|---|
| 0.3 | 2026-09-11 | Added the FR-045 snapshot schema/version, FK-order, idempotency, and exact `mutationRevision` restore contract for both persisted stocktake models. |
| 0.2 | 2026-09-11 | Made preview persistence, Business-scoped idempotency, and the lock-only `InventoryLedgerFence` / `mutationRevision` concurrency contract explicit for SQLite and PostgreSQL. |
| 0.1 | 2026-09-11 | Initial located-stock, alerts/ATP, and physical-count contract and RCA. |


