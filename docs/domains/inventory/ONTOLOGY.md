---
domain: inventory
title: "Inventory ontology — the owner's node/edge model and its relational mapping"
status: reference
version: "1.0.0"
updated: "2026-09-06"
---

# Inventory ontology (reference)

The owner supplied a graph-shaped ontology with the request for the inventory
system (2026-09-06). This page records it verbatim in structure, states how
each concept maps to the rows the Inventory domain owns, and names what is
deliberately **not** Inventory's. Nothing here is a schema; the schema is
`prisma/schema.prisma` and the charter's `owns_models`.

## Node ontology as supplied

| Node | Prefix | Properties (as supplied) |
|---|---|---|
| Category | `cat:` | `name_th`*, `name_en`*, `slug`* (enum: eco-friendly, classic-oriental, novelty-self-care, executive-smart-tech), `vibe`, `target_recipient`, `guardrail` |
| ProductMaster | `pm:` | `code`* unique, `name_th`*, `name_en`*, `category`*, `base_cost`*, `specs` (map) |
| SKU (ProductVariant) | `sku:` | `code`* unique, `color`, `material`, `inventory_qty` (default 0), `safety_stock` (default 10) |
| CatalogOffer | `offer:` | `code`* unique, `name`*, `gift_tier` (Reach / Select / Signature / Bespoke), `unboxing_experience`*, `base_price`, `price_tiers`; vector space `unboxing_sensory` |
| BundleOffer (CorporateMetaBundle) | `bundle:` | `code`* unique, `name`*, `target_recipients`*, `total_price`*, `description`, `tier_breakdown` (map) |
| GiftTier | `tier:` | `name` (enum), `budget_tier`, `priority` |
| RecipientSegment | `seg:` | `name`*, `target_level` (C-Level / Mid-Management / Operations) |
| CorporateClient | `client:` | `client_id`* unique, `name`*, `industry`, `segment`, `tier_breakdown`* |

## Edge ontology as supplied

| Edge | Source → Target | Properties |
|---|---|---|
| `IN_CATEGORY` | ProductMaster → Category | — |
| `VARIANT_OF` | SKU → ProductMaster | — |
| `CONTAINS` | CatalogOffer → ProductMaster | `qty` (default 1) |
| `BELONGS_TO_TIER` | CatalogOffer → GiftTier | — |
| `RECOMMENDED_TIER` | RecipientSegment → GiftTier | — |
| `INCLUDES_OFFER` | BundleOffer → CatalogOffer | `qty`* |
| `ORDERED` | CorporateClient → BundleOffer | `order_id`*, `quantity`*, `amount`*, `ordered_at` |

## Mapping to the Inventory domain (FR-154 / FR-155)

| Ontology | Inventory row | How it maps | Decision |
|---|---|---|---|
| Category | `InventoryCategory` | `name_th`/`name_en` → `nameTh`/`nameEn`; `slug`, `vibe`, `target_recipient`, `guardrail` → same-named columns | **`slug` is a free kebab-case string, not an enum.** The four supplied values are one Business's catalogue, so they are data rows in that Business, not a system-wide vocabulary in `enums.js`. Unique per Business |
| `IN_CATEGORY` | `ProductMaster.categoryId` | one category per master, required | as supplied |
| ProductMaster | `ProductMaster` | `code`, `nameTh`, `nameEn`, `baseCost`, `specs` (stored as `specsJson`) | as supplied, plus the owner's `product_family` (`familyId`) and `factory_id` (`factoryId`) which the ontology did not carry |
| SKU / ProductVariant | `Product` | `code`, `color`, `material`, `safetyStock` (default 10) | **`inventory_qty` is not stored.** On-hand is the sum of the product's `StockMovement` rows, recomputed on read (the same rule progress follows). The owner's counted / uncounted distinction is `stockPolicy`; how units are identified is `trackingMode` |
| `VARIANT_OF` | `Product.productMasterId` | required | as supplied |
| BundleOffer (as a pack of goods) | `ProductBundle` + `ProductBundleItem` | `code`, `name`, `description`, `targetRecipients`, `totalPrice`; items carry `qty` | Inventory's bundle packs **SKUs**, not offers — that is the part of the concept that touches stock. `tier_breakdown` and the offer-level composition are Commerce's |
| `lot_id`, `serial_id`, `factory_id` (owner's ids, not in the ontology) | `ProductLot`, `SerialUnit`, `Factory` | see the charter | added for FR-155 |

## Not Inventory's (deferred to a Commerce lane)

`CatalogOffer`, `GiftTier`, `RecipientSegment`, `CorporateClient`, the
`unboxing_sensory` vector space, `price_tiers`, and the edges `CONTAINS`,
`BELONGS_TO_TIER`, `RECOMMENDED_TIER`, `INCLUDES_OFFER` and `ORDERED`. They
describe **what is offered, to whom, at what price, and who bought it** —
Commerce questions. Inventory owns the goods an offer is made of and how many
exist; Commerce will reference `ProductMaster` / `Product` by internal id and
never write to them. When that lane is chartered it declares its own FRs; the
Inventory rows will not need to change for it.

## Graph projection

The ontology's prefixes (`cat:`, `pm:`, `sku:`, …) are node ids for a graph
view. Inventory does not write a graph; the Knowledge lane (GKS, ADR-042) may
project these rows into one, keyed on the internal UUIDs, with the prefix as
a label. The relational rows stay the source of truth.
