---
domain: inventory
feature: FR-201
module: inventory
source: v2-native
bundle: FEAT-031
requirements:
  - FR-201
version: "0.1.0"
status: building
---

# FR-201 — The nature is declared at the master, once

## Intent

FR-168 gave a SKU three natures — TRACKED, UNTRACKED, SERVICE — and every ledger
rule respects them. What it did not say is *where the choice is made*. It was
made on the SKU form, one SKU at a time, and nothing above the SKU knew. The
repository's own fixture showed the consequence: an "Engraving service" filed as
a variant of the *Tumbler* master, next to the black and the red one. Every ERP
item master puts the item type on the master (SAP's material type, Odoo's
product-template type, Dynamics' item type) for exactly this reason: a service
is not a variant of a good, and the catalogue should be able to say so.

## Decisions worth recording

**`ProductMaster.nature` is the declaration; `Product.stockPolicy` is the
inheritance.** The master says GOOD or SERVICE once, at creation. A SKU under a
SERVICE master is SERVICE and cannot be asked to be anything else
(`INVENTORY_NATURE_MISMATCH`); a SKU under a GOOD master is TRACKED or
UNTRACKED — the master's `defaultStockPolicy` when the request names none — and
cannot be SERVICE. `stockPolicy` stays on the SKU because every ledger rule
reads it there (`movementRule`, the goods receipt, the POS), and none of those
rules changed.

**A service carries no stock fields.** `safetyStock` is stored as 0 (not the
counted default of 10), `trackingMode` is NONE, and the replenishment
parameters are null and refused on UPDATE. A report that reads a threshold
never finds one on a service.

**`untracked` no longer includes services.** The stock summary reports
`services` as its own count. A reader that summed `tracked + untracked` to reach
`products` now needs `services` as well — that is the point, not a side effect.

**Existing data is backfilled, not broken.** The migration sets a master to
SERVICE when every SKU it has is SERVICE, and GOOD otherwise. A service that
ends up under a GOOD master by that rule keeps working (the SKU still says
SERVICE) and appears in the hygiene report as `NATURE_MISMATCH` until the
Business creates a SERVICE master and moves it. The fixture that filed an
engraving under a tumbler was changed to do exactly that.

**The console narrows by the master.** With a SERVICE master selected the SKU
form shows no policy choice at all; with a GOOD master it offers counted or
uncounted and never SERVICE.

## Delivered (local, 2026-09-13)

- `ProductMaster.nature`, `defaultStockPolicy` (schema, both trees, migration
  `20260913120000_inventory_sku_governance` with the backfill, **not applied**).
- `natureRule` / `natureAgrees` in `domain/inventory-governance.js`;
  `createProductMaster` and `createProduct` in the catalogue service; the
  `services` / `phaseOut` counts in `stockSummary`; `?nature=` on the master
  and product lists.
- Tests: `tests/integration/fr201-inventory-sku-governance.test.js` AC-201.1,
  `tests/unit/inventory-governance.test.js`, the render test on the SKU form.

## Not in this slice

Moving a SKU between masters (a service under a good master is reported, not
auto-moved); a category-level nature.
