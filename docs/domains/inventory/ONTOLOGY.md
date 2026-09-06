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

## The legacy "Culinary" module, relabelled (owner instruction, 2026-09-06)

The legacy product's ERD (`Freshair129/zuri1.0`,
`docs/architecture/database-erd/full-schema.md` v2.0.0 — the same file
ADR-054 reads as prior art) carries an *industry/culinary* module: `Ingredient`
with `IngredientLot` (FEFO), `Recipe` / `RecipeIngredient` / `RecipeEquipment`,
`CourseMenu`, `StockDeductionLog`, and a recipe per class size. The owner's
instruction was to **take the label off**: a recipe for 10 seats and one for
20 seats is the same thing as a bundle's bill of materials at 10 / 50 / 100 /
500 sets. So the concepts land in Inventory as general ones (FR-155, FR-156):

| Legacy (culinary) | Inventory (general) | Note |
|---|---|---|
| `Ingredient` (`unit` g / ml / piece, `currentStock`, `minStock`) | `Product` — TRACKED, `unit`, `safetyStock` | `currentStock` is not stored: on-hand is the ledger's sum |
| `IngredientLot` (`initialQty`, `remainingQty`, `expiresAt`, FEFO) | `ProductLot` (`receivedQty`, `expiresAt`) + per-lot on-hand from the ledger | FEFO is the ledger's rule for an unnamed-lot issue (FR-155) |
| `Recipe` per class size | `ProductRecipe` per (output SKU, `batchSize`) | the "10 seats / 20 seats" separation is `batchSize` |
| `RecipeIngredient` (`qtyPerPerson` × students) | `ProductRecipeLine` with `fixed = false` (scales by `quantity / batchSize`) | |
| `RecipeEquipment` (`qtyRequired` per session) | `ProductRecipeLine` with `fixed = true` (does not scale) | |
| `CourseMenu` (Product → Recipe) | `ProductRecipe.productId` (the output SKU) | an UNTRACKED output (a course, a service) consumes components and produces nothing to stock |
| `StockDeductionLog` (ADR-038 flow) | `StockMovement` rows written by `POST /api/inventory/recipes/[id]/build` (reference `RECIPE:<code>`) | atomic: every component or none |
| `Package` / `PackageCourse` / `PackageGift` / price tiers | Commerce (deferred) | a bundle (FR-154) holds the goods; the offer holds the price |
| `MarketPrice`, `PurchaseRequest`, `PurchaseRequestItem` | Procurement (deferred) | a movement's `reference` carries the PO / GRN string only |
| `Enrollment`, `CourseSchedule`, `ClassAttendance`, `Certificate` | Operations / Commerce (deferred) | scheduling and attendance are not stock |

What did not survive the border, and why: `Ingredient.currentStock` (a stored
on-hand — refused, recomputed instead), `IngredientLot.remainingQty` (same),
the per-person multiplication at deduction time (replaced by an explicit
batch-size recipe, which also gives the gift-box tiers), and every legacy id
as a key (BR-002).
