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
  - ProductLot
  - SerialUnit
  - StockMovement
owns_routes:
  - src/app/(pm)/inventory/**
  - src/app/api/inventory/**
owns_code:
  - src/modules/inventory/**
technical_owner: TD-INVENTORY
status: active-foundation
version: "1.0.0"
created_at: "2026-09-06T21:00:00+07:00"
updated_at: "2026-09-06T21:00:00+07:00"
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
2. Is this product **counted** (นับสต๊อก) or **not counted** (ไม่นับสต๊อก)?
3. For a counted product: how many are on hand right now, is that below its
   safety stock, and which lot or serial unit is each one?
4. What happened to the stock, when, by whom, and against which reference?

Stable identities:

```text
Product domain:   DOM-INVENTORY
Technical owner:  TD-INVENTORY
Route key:        inventory
Display label:    Inventory (คลังสินค้า)
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

Every one of those is an **attribute** (BR-002): the primary key is always the
internal UUID, and no external or human code is ever a foreign key.

## Counted versus uncounted

A `Product` is created with a `stockPolicy` that never changes afterwards:

- **TRACKED** (นับสต๊อก): every movement is a `StockMovement` row and on-hand is
  the sum of them — recomputed on every read, never stored on the product. A
  `trackingMode` says how units are identified: `NONE` (an anonymous
  quantity), `LOT` (a receipt must name or create its lot) or `SERIAL` (every
  movement names one serial per unit; a unit exists from its receipt and is
  `ISSUED` by its issue).
- **UNTRACKED** (ไม่นับสต๊อก): a catalogue identity with no ledger at all — a
  service, a made-to-order or print-on-demand item. The ledger refuses it by
  code (`INVENTORY_PRODUCT_UNTRACKED`), a summary prints `null` for its
  on-hand (never a zero that reads as "measured and empty"), and it never
  limits a bundle's availability.

## Owned records

- `InventoryCategory`, `ProductFamily`, `Factory`, `ProductMaster`, `Product`,
  `ProductBundle`, `ProductBundleItem` — catalogue identity (FR-154).
- `ProductLot`, `SerialUnit`, `StockMovement` — the stock ledger (FR-155).

## Explicitly not owned

| Concept | Authority | Inventory behavior |
|---|---|---|
| Catalogue *offers*, gift tiers, recipient segments, price tiers, corporate clients and their orders (`CatalogOffer`, `GiftTier`, `RecipientSegment`, `CorporateClient`, `ORDERED` in the owner's ontology) | future Commerce lane | Inventory holds the goods an offer is made of; the offer, its price and who bought it are Commerce's. See [ONTOLOGY.md](ONTOLOGY.md) |
| Purchase orders, goods receipts, suppliers | future Procurement lane | a movement records a `reference` string; it does not validate it |
| Physical company assets (equipment the Business owns and depreciates) | Asset Management | a different question — "what do we own" versus "what do we hold to sell or use up" |
| Costing, valuation, COGS, journal posting | future Finance | `baseCost` is a catalogue attribute, not a valuation |
| Warehouse locations / bins | not modelled in this slice | a later FR may add a location to a movement |
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
├── application/inventory-authority.js       the view / manage ladder, FR-072 refusals
├── application/inventory-catalog-service.js the only writer of catalogue rows (FR-154)
├── application/inventory-stock-service.js   the only writer of the ledger (FR-155)
└── index.js                                 stable module exports
```

Runtime surfaces are `/inventory` and `/api/inventory/**`. The domain must not
import a page or route to reach another domain's private repository;
cross-domain work uses an explicit contract or read projection.

## Delivery state

FR-154 and FR-155 are implemented locally with both migrations written and the
production SQL **not applied** (an owner-instructed operator step, ADR-057).
Surfaces: the API family above and the `/inventory` console dashboard. Not in
this slice: Excel/LINE intake converters for stock, warehouse locations,
reservations, costing, and the graph projection of the ontology.

## References

- [ONTOLOGY.md](ONTOLOGY.md) — the owner's node/edge ontology and how each concept maps here
- [FR-154 catalogue identity](features/FR-154-inventory-catalogue-identity.md)
- [FR-155 stock ledger](features/FR-155-inventory-stock-ledger.md)
- [ADR-025](../../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) — the domain spine this charter lives in

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-06 | active-foundation | Established the Inventory domain: eight catalogue/ledger identities, counted-versus-uncounted policy, authority ladder, invariants and explicit external boundaries | working-tree | Claude Fable 5.1 |
