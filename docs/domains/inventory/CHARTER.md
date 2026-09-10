---
domain_id: DOM-INVENTORY
domain: inventory
modules:
  - inventory
owns_models:
  - InventoryCategory
  - ProductFamily
  - Factory
  - ProductMaster
  - Product
  - ProductBundle
  - ProductBundleItem
  - ProductRecipe
  - ProductRecipeLine
  - ProductLot
  - SerialUnit
  - StockMovement
  - WarehouseLocation
  - CustomizationWorkOrder
  - KittingWorkOrder
  - StockReservation
owns_routes:
  - src/app/(pm)/inventory/**
  - src/app/api/inventory/**
owns_code:
  - src/modules/inventory/**
technical_owner: TD-INVENTORY
status: active-foundation
version: "1.2.0"
created_at: "2026-09-06T21:00:00+07:00"
updated_at: "2026-09-10T16:30:00+07:00"
---

<!-- owns_routes are longest-prefix globs (ADR-025). The two claims reserve the
     `/inventory` page tree and the `/api/inventory/**` handlers away from
     project-manager's `src/app/(pm)/**` + `src/app/api/**` catch-all. The
     generators read each list as an unbroken run of `  - value` lines, so
     annotations stay outside the frontmatter. -->

# Inventory domain charter (คลังสินค้า)

## Mission

Inventory is the Business-scoped authority for **what the Business sells or
uses as goods, and how many of them it holds**: the catalogue identity of a
product from its category down to one serial-numbered unit, and the ledger
every stock movement is written to. It answers, for every Business,

1. What is this product — its category, family, master, variant (SKU), the
   factory it came from, and which bundles pack it?
2. Is this a counted good (นับสต๊อก), an uncounted good (ไม่นับสต๊อก) or a service (บริการ)?
3. For a counted product: how many are on hand right now, is that below its
   safety stock, and which lot or serial unit is each one?
4. What happened to the stock, when, by whom, and against which reference?

Stable identities:

```text
Product domain:   DOM-INVENTORY
Technical owner:  TD-INVENTORY
Route key:        inventory
Display label:    Inventory (คลังสินค้า), under the SCM slot since FR-167.
                  It read "Warehouse" while it sat in the domain bar beside a
                  Project's own Inventory tab (FR-077); under SCM the two are
                  never on screen together, and Warehouse is the reserved
                  sibling for bins and stocktake — locations and transfers
                  themselves landed here with ADR-074 D1
```

## The eight ids the owner asked for, and where each lives

| Owner's id | Model | Human identity | Notes |
|---|---|---|---|
| `category_id` | `InventoryCategory` | `code` unique per Tenant; optional `slug` unique per Business | Thai and English names; the ontology's `vibe`, `target_recipient`, `guardrail` are plain attributes |
| `product_family` | `ProductFamily` | `code` unique per Tenant | groups product masters across categories |
| `factory_id` | `Factory` | `code` unique per Tenant | referenced by a product master (default maker) and by a lot (actual maker of that batch) |
| `product_master` | `ProductMaster` | `code` unique per Tenant | in exactly one category; optional family and factory; `baseCost`, `specs` |
| `product_id` | `Product` (SKU) | `code` unique per Tenant | the variant of a master (`color`, `material`); carries `stockPolicy` and `trackingMode` |
| `bundle_id` | `ProductBundle` + `ProductBundleItem` | `code` unique per Tenant | a pack of SKUs with quantities; availability is derived from the ledger |
| `lot_id` | `ProductLot` | `code` unique per product | a manufacturing batch with optional factory, dates and `receivedQty` |
| `serial_id` | `SerialUnit` | `serialNo` unique per product | one physical unit with its custody status |
| `recipe_id` (FR-156) | `ProductRecipe` + `ProductRecipeLine` | `code` unique per Tenant; one recipe per (output SKU, `batchSize`) | the bill of materials at a batch size — "for 10 seats" and "for 20 seats" are two rows, as a gift box has a BOM at 10 / 50 / 100 / 500 sets; lines are component SKUs with `qty` per batch, `fixed` lines do not scale |

Every one of those is an **attribute** (BR-002): the primary key is always the
internal UUID, and no external or human code is ever a foreign key.

## The three natures: counted, uncounted, service

A `Product` is created with a `stockPolicy` that never changes afterwards. The
three differ in **accounting**, not only in how the ledger treats them (FR-168):

- **TRACKED** (นับสต๊อก): every movement is a `StockMovement` row and on-hand is
  the sum of them — recomputed on every read, never stored on the product. A
  `trackingMode` says how units are identified: `NONE` (an anonymous
  quantity), `LOT` (a receipt must name or create its lot) or `SERIAL` (every
  movement names one serial per unit; a unit exists from its receipt and is
  `ISSUED` by its issue).
- **UNTRACKED** (ไม่นับสต๊อก): still a good — it can be bought, received and
  consumed — but the Business has chosen not to carry a perpetual count of it
  (consumables, made-to-order, print-on-demand). It has no ledger: refused by
  code (`INVENTORY_PRODUCT_UNTRACKED`), a summary prints `null` for its on-hand
  (never a zero that reads as "measured and empty"), and it never limits a
  bundle's availability. The decision is reversible in principle: the Business
  could decide to start counting it.
- **SERVICE** (บริการ): not a good at all, so nothing about stock applies and
  nothing ever could. It carries no `trackingMode` but `NONE`, the ledger
  refuses it by its own code (`INVENTORY_PRODUCT_IS_A_SERVICE`, distinct from
  the uncounted refusal precisely because this one can never be reversed), and
  a goods receipt naming it is refused (`PROCUREMENT_RECEIPT_LINE_IS_A_SERVICE`)
  — a service is performed, not delivered to a warehouse. It may still sit on a
  purchase order and be paid for there, which is what gives freight or
  installation a catalogue identity instead of leaving it as free text.

  Until FR-168 a service was recorded as UNTRACKED. That conflated "we do not
  count this good" with "this is not a good", which is a distinction an
  accountant makes and the catalogue could not.

## Owned records

- `InventoryCategory`, `ProductFamily`, `Factory`, `ProductMaster`, `Product`,
  `ProductBundle`, `ProductBundleItem` — catalogue identity (FR-154).
- `ProductLot`, `SerialUnit`, `StockMovement` — the stock ledger (FR-155),
  consumed FEFO for lot-tracked SKUs when an issue names no lot.
- `ProductRecipe`, `ProductRecipeLine` — the bill of materials at a batch size
  (FR-156): explosion, shortages against the ledger, and the atomic build that
  issues components and receives the output. Since ADR-074 a recipe also
  declares the loss it expects (`scrapAllowanceFactor`, BR-029).
- `WarehouseLocation` — where stock is (FR-174), typed by one of nine
  supply-chain buckets, with `isVirtual` for the places the Business does not
  hold. `StockMovement` gained `sourceLocationId` / `targetLocationId`, and a
  transfer is one movement pair in one transaction (BR-026).
- `CustomizationWorkOrder`, `KittingWorkOrder` — work in progress (FR-176,
  FR-177): what a run intends and how far it has got. They hold **no quantity
  the ledger also holds** — on-hand anywhere is still the sum of movements —
  and they write stock only through this lane's own `appendMovement`.
- `StockReservation` — what is already promised (FR-180): a soft, expiring
  `QUOTE` hold or a committed `ORDER` one. It never writes the ledger, because
  a promise is not a physical fact, and it is never deleted (BR-031).

## Explicitly not owned

| Concept | Authority | Inventory behavior |
|---|---|---|
| Catalogue *offers*, gift tiers, recipient segments, price tiers, corporate clients and their orders (`CatalogOffer`, `GiftTier`, `RecipientSegment`, `CorporateClient`, `ORDERED` in the owner's ontology) | future Commerce lane | Inventory holds the goods an offer is made of; the offer, its price and who bought it are Commerce's. See [ONTOLOGY.md](ONTOLOGY.md) |
| Purchase orders, goods receipts, suppliers | Procurement (`docs/domains/procurement/CHARTER.md`, FR-164 / FR-165) | a goods receipt posts RECEIPT rows through this lane's exported `appendMovement` with `PO:<code>/GRN:<code>` as the reference; the PO and supplier stay Procurement's, and Procurement's role never widens this lane's write authority |
| Physical company assets (equipment the Business owns and depreciates) | Asset Management | a different question — "what do we own" versus "what do we hold to sell or use up" |
| COGS, journal posting, the books | future Finance | **inventory valuation** is owned here since ADR-074 D3: `StockMovement.costSatang` is the landed unit cost of a movement, integer satang, computed by `domain/inventory-costing.js`. It is a valuation of what we hold, not a book entry; `ProductMaster.baseCost` remains a catalogue attribute and is neither |
| Warehouse bins, stocktake campaigns and the Warehouse console | the reserved `warehouse` bar slot (ADR-069 D3), still `soon` | **locations themselves are owned here** since ADR-074 D1: the location columns are attributes of `StockMovement`, which only this lane may write, and splitting the table from the columns would put a foreign key across a charter boundary. What stays reserved is the bins-and-stocktake UI, not the model |
| FlowAccount catalogue and stock synchronisation | future Integration lane | this lane records FlowAccount's item code for a tradeable set on `Product.flowAccountSku`, unique per Tenant and never a key (BR-002/BR-032), and refuses a kitting run whose output has none; pushing anything to FlowAccount is not this lane's |
| The graph projection (Neo4j-style nodes and edges) | Knowledge / GKS | the relational rows are the source; a projection reads them |

## Scope and authorization

Every owned row carries `tenantId` and `businessId`, derived on the server from
the trusted viewer and the selected visible Business (`businessId` in a request
is a selector the service validates, never the scope). Reading needs Business
visibility plus the `inventory` domain (FR-061). Every write needs Business
OWNER or the `INVENTORY_MANAGER` role binding (permission
`inventory.catalog.write`, FR-076 pattern). Every refusal is the FR-072
`404 Business not found`.

## Aggregate invariants

- Internal keys are UUIDs; codes, serials, lot numbers and references are never keys.
- A code is unique inside one Tenant and is never recycled; archiving keeps the row.
- `stockPolicy` and `trackingMode` are fixed at creation, because the meaning of
  every ledger row depends on them.
- A `StockMovement` is appended, never edited or deleted. RECEIPT adds, ISSUE
  removes, ADJUSTMENT corrects with its own sign. An ISSUE that would take
  on-hand below zero is refused.
- A SERIAL product writes one ledger row per unit, so a unit's history is its own rows.
- Every write is one transaction that bumps `version` where the row has one and
  appends one `AuditEvent` (SCREAMING_SNAKE entity types: `PRODUCT`,
  `STOCK_MOVEMENT`, `SERIAL_UNIT`, …).
- On-hand, below-safety-stock and bundle availability are pure calculators in
  `domain/inventory.js`; no page shows a number a service would disagree with.

## Source layout

```text
src/modules/inventory/
├── domain/inventory.js                      vocabularies, Zod contracts, pure calculators
├── domain/inventory-costing.js              landed cost in satang, WAVG, the FlowAccount set pattern (FR-175, FR-177)
├── domain/inventory-wip.js                  scrap allowance, dedication guard, shelf life, ATP (FR-176..FR-180)
├── domain/warehouse-location.js             location contract, transfer rules, located on-hand (FR-174)
├── application/inventory-authority.js       the view / manage ladder, FR-072 refusals
├── application/inventory-catalog-service.js the only writer of catalogue rows (FR-154)
├── application/inventory-stock-service.js   the only writer of the ledger (FR-155), FEFO, appendMovement
├── application/inventory-recipe-service.js  the only writer of recipes; explode and build (FR-156)
├── application/warehouse-location-service.js the only writer of locations; located stock read (FR-174)
├── application/location-transfer-service.js  the atomic transfer pair (FR-174)
├── application/customization-work-order-service.js  branded WIP, irreversible on completion (FR-176)
├── application/kitting-work-order-service.js assembly from a frozen BOM (FR-177)
├── application/de-kitting-service.js         controlled disassembly (FR-178)
├── application/inventory-shelf-life-service.js  the ageing audit and the maintenance that resets it (FR-179)
├── application/inventory-atp-service.js      reservations and Available-to-Promise (FR-180)
└── index.js                                 stable module exports
```

Runtime surfaces are `/inventory` and `/api/inventory/**`. The domain must not
import a page or route to reach another domain's private repository;
cross-domain work uses an explicit contract or read projection.

## Delivery state

FR-154, FR-155 and FR-156 are implemented locally with both migrations
(`20260906230000_inventory_domain`, `20260906233000_inventory_recipe`) written
and the production SQL **not applied** (an owner-instructed operator step,
ADR-057).

FR-174…FR-181 (FEAT-025, ADR-074) are implemented locally: locations and the
located ledger, landed cost in satang, the customization and kitting work
orders, de-kitting, the shelf-life storage guard, ATP with two-tier
reservations, and the six agent tools. Migration
`20260910120000_smartgift_scm_wip` is written and **not applied**.

Surfaces: the API family above and the `/inventory` console dashboard. Not in
this slice: HTTP routes and console pages for locations, work orders and
reservations (services and agent tools only), Excel/LINE intake converters for
stock, FlowAccount catalogue/stock synchronisation, cycle counting and
stocktake campaigns, and the graph projection of the ontology.

## References

- [ONTOLOGY.md](ONTOLOGY.md) — the owner's node/edge ontology and how each concept maps here
- [FR-154 catalogue identity](features/FR-154-inventory-catalogue-identity.md)
- [FR-155 stock ledger](features/FR-155-inventory-stock-ledger.md)
- [ADR-025](../../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) — the domain spine this charter lives in

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.2.0 | 2026-09-10 | active-foundation | Claimed `WarehouseLocation`, `CustomizationWorkOrder`, `KittingWorkOrder` and `StockReservation` (FR-174..FR-181, ADR-074): the located ledger with its atomic transfer, landed cost in satang, the two WIP work orders and the irreversible customer dedication, de-kitting, the shelf-life storage guard, Available-to-Promise with two-tier reservations, and the FlowAccount set code recorded as a per-Tenant `Product.flowAccountSku` attribute rather than a second `code` or an installation-unique `ExternalRef`. Inventory valuation moves in from "future Finance"; the `warehouse` bar slot stays reserved for bins and stocktake | working-tree | Claude Opus 5 |
| 1.1.0 | 2026-09-06 | active-foundation | Claimed `ProductRecipe` and `ProductRecipeLine` (FR-156 — the legacy Culinary recipes relabelled as a bill of materials at a batch size), recorded FEFO consumption on the ledger, and the `Warehouse` display label | working-tree | Claude Fable 5.1 |
| 1.0.0 | 2026-09-06 | active-foundation | Established the Inventory domain: eight catalogue/ledger identities, counted-versus-uncounted policy, authority ladder, invariants and explicit external boundaries | working-tree | Claude Fable 5.1 |
