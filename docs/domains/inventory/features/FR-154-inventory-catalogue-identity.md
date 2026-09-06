---
domain: inventory
feature: FR-154
module: inventory
source: v2-native
bundle: FEAT-020
requirements:
  - FR-154
version: "0.1.0"
status: building
---

# FR-154 — Inventory catalogue identity (คลังสินค้า)

## Intent

The owner asked for an inventory system with counted and uncounted products
and eight ids: `product_id`, `serial_id`, `bundle_id`, `factory_id`, `lot_id`,
`category_id`, `product_master`, `product_family`. This FR is the catalogue
half: who a product *is* — category → family → master → SKU, the factory it
comes from, and the bundle that packs several SKUs — and the one rule a SKU
carries about itself, whether it is counted at all. FR-155 is the ledger half.

## Decisions worth recording

**Eight ids, one key.** Every row is keyed by an internal UUID; each of the
owner's ids is a human `code` unique per Tenant (a serial and a lot number are
unique per product), and none of them is ever a foreign key (BR-002). The
charter's table maps each id to its model.

**Counted or not is decided at creation and never changes.** `stockPolicy`
(TRACKED / UNTRACKED) and `trackingMode` (NONE / LOT / SERIAL) are fixed by
`POST /api/inventory/products`, because the meaning of every ledger row
depends on them; `UPDATE` edits names, colour, material, unit and safety
stock only. A product whose policy must change is archived and re-created
under a new code, so its history stays explainable.

**The ontology's `slug` enum is data, not a vocabulary.** The owner's four
slugs (eco-friendly, classic-oriental, novelty-self-care, executive-smart-tech)
belong to one Business's catalogue. `InventoryCategory.slug` is a free
kebab-case string unique per Business, and the four values are rows, not
members of `enums.js`. See [ONTOLOGY.md](../ONTOLOGY.md).

**`inventory_qty` is not a column.** The ontology carried a quantity on the
SKU; here on-hand is the sum of the ledger, recomputed on read
(`stockOnHand` in `domain/inventory.js`), for the same reason progress is
always recomputed: a stored number a page could disagree with is a wrong
number waiting to happen.

**A bundle packs SKUs; an offer is Commerce's.** `ProductBundle` /
`ProductBundleItem` hold the goods and quantities, and `listBundles` reports
`availableSets` — the tightest counted item's on-hand divided by its
quantity; an uncounted item never limits, and a bundle of only uncounted
items reports `null`. Gift tiers, price tiers, recipient segments and
corporate orders are deferred to a Commerce lane.

**Same write discipline as every recent domain.** Manager authority
(Business OWNER or `INVENTORY_MANAGER`), the `inventory` domain grant for
reads (FR-061), the FR-072 404 for every refusal, one transaction and one
audit row per write, compare-and-swap on `version` for product actions,
archive instead of delete, and references (category, family, factory, master,
bundle item product) that must belong to the same Business or are refused by
code (`422`).

## Delivered (local, 2026-09-06)

- `prisma/schema.prisma` + generated Postgres schema: `InventoryCategory`,
  `ProductFamily`, `Factory`, `ProductMaster`, `Product`, `ProductBundle`,
  `ProductBundleItem`; migrations `prisma/migrations/20260906230000_inventory_domain`
  and `supabase/migrations/20260906230000_inventory_domain.sql` (forced RLS,
  private grants, **not applied**) in the same change, shared with FR-155.
- `src/modules/inventory/domain/inventory.js` — contracts and calculators.
- `src/modules/inventory/application/inventory-authority.js` — the ladder.
- `src/modules/inventory/application/inventory-catalog-service.js` — the only writer.
- `GET/POST /api/inventory/{categories,families,factories,product-masters,products,bundles}`,
  `GET/PATCH /api/inventory/products/[id]`; snapshot coverage after Business.
- `src/config/domains.js` `inventory` slot, `/inventory` dashboard page,
  `INVENTORY_MANAGER` role with `inventory.catalog.write`.
- Tests: `tests/integration/fr154-inventory-catalog.test.js` (AC-154.1–.6),
  `tests/unit/inventory-domain.test.js`, `tests/unit/inventory-routes.test.js`,
  and the real-browser `tests/e2e/fr154-inventory-dashboard.spec.js` (category →
  master → two SKUs → a receipt, on-hand recomputed after reload).

## Not in this slice

Excel / LINE intake converters for the catalogue; product images; costing and
valuation; the Commerce offer layer; the graph projection; production
application of the migration (owner-instructed operator step, ADR-057).
