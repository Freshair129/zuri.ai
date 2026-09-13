---
version: "1.0.0"
created_at: "2026-09-13T15:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-13T15:00:00+07:00,Claude Fable 5.1"
status: "accepted"
superseded_by: null
attributes:
  domain: "inventory"
  doc_type: "architecture-decision"
  scope: "SKU governance in the Inventory catalogue — the product nature declared once at the master and inherited by every SKU (a service is never a variant of a good), variant identity as the anti-SKU-bloat key, barcodes and partner codes as attributes with a resolve step before create, pack sizes as unit conversions rather than SKUs, the SKU lifecycle (phase-out, reactivate, merge, the archive guard), replenishment parameters, and the read-only catalogue hygiene report"
---

# ADR-083 — SKU governance: nature at the master, variant identity, and the catalogue hygiene report

**Status:** Accepted. Implemented by FR-201…FR-207 (FEAT-031) in the same change.
**Date:** 2026-09-13
**Decided by:** Boss (instruction of 2026-09-13: "review และออกแบบระบบ inventory แบบนับสต๊อกและไม่นับสต๊อก
แยก SKU ที่เป็น service และวางระบบ anti SKU บวม และเพิ่มเติมส่วนที่ขาดตามมาตรฐาน ERP ทำในบรานช์ใหม่").
**Relates to:** [ADR-074](ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md),
[ADR-069](ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md),
[ADR-066](ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md),
[ADR-065](ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md),
FR-154, FR-155, FR-168, FR-174, FR-180, FR-184, BR-002, SEC-001,
`docs/domains/inventory/CHARTER.md`, `docs/ERP-MODULE-MAP.md`.

## Context

The owner asked for a review of the Inventory system's counted / uncounted / service model, a
separation of service SKUs from goods, a design against SKU bloat, and the parts an ERP item
master has that this catalogue does not. The review was done against the code on `main` at
`92c2448f` (FR-154, FR-155, FR-168, FR-174…FR-184) and the governing documents, not from memory.

### What the review found

**The three natures are right, and they sit on the wrong row.** FR-168 made `stockPolicy`
TRACKED / UNTRACKED / SERVICE, and the ledger, the goods receipt and the POS all respect it. But
the nature is a property of a *SKU*, while every ERP item master puts the item type on the
master (SAP material type `DIEN` for a service, Odoo's product *template* type, Dynamics' item
type). The consequence is visible in the repository's own fixtures: `tests/integration/fr154-inventory-catalog.test.js`
creates an "Engraving service" as a variant of the *Tumbler* master. A service that is a
colour-variant of a mug is the exact conflation FR-168 set out to end, one level up. Nothing in
the catalogue could refuse it, and nothing could list "the services" as a class because a
service had no class of its own.

**Nothing stops the same physical thing from becoming two SKUs.** The only identity guard is
`code` unique per Tenant. Two SKUs under one master with the same colour and the same name are
accepted; a case of twelve becomes a second SKU beside the single; a barcode can be typed as a
`code` on one SKU and as `name` on another; an intake that does not know the SKU exists creates
it again. Every one of those is how item masters bloat in practice, and every one is invisible
to a `code` check. The stock summary also counts a SERVICE under `untracked`, so the one number
a dashboard shows for "goods we do not count" is wrong by exactly the number of services.

**A SKU can be archived with stock on it.** `ARCHIVE` has no ledger guard, so a counted SKU
with 500 on hand disappears from every default list while the 500 units stay in the sum of the
ledger. An ERP refuses to block an item that still has stock or open promises; this catalogue
did not.

**The ERP item-master fields that are missing** are the ones every material master carries
and this one does not: a unit-of-measure conversion (purchase in cartons, count in pieces),
barcodes and partner codes (GTIN, supplier code, manufacturer part), reorder point / reorder
quantity / lead time, and an item lifecycle between "active" and "gone" (phase-out: sell what
is left, buy no more). Costing (landed cost, FR-175), lots and serials (FR-155), locations
(FR-174), reservations (FR-180) and physical counts (FR-184) already exist and are not
re-decided here.

### What is deliberately not changed

- `stockPolicy` and `trackingMode` stay on the SKU and stay fixed at creation (FR-154, FR-168).
  The master *declares* the nature; the SKU still *carries* it, because every ledger rule reads
  the SKU and none of those rules changes.
- On-hand is still never stored (FR-155). A unit conversion changes what a caller may *say*,
  never what the ledger *holds*.
- Nothing is deleted. A merged duplicate is archived pointing at its survivor and its ledger
  rows stay where they are.

## Decision

### D1 — The nature is declared once, at the master, and every SKU inherits it (BR-038)

`ProductMaster.nature` is `GOOD` or `SERVICE`, fixed at creation. A SKU under a `SERVICE`
master is always `stockPolicy: SERVICE`; a request naming any other policy is refused
(`INVENTORY_NATURE_MISMATCH`). A SKU under a `GOOD` master is TRACKED or UNTRACKED — never
SERVICE — and defaults to the master's `defaultStockPolicy` when the request names none. A
service SKU is stored with `safetyStock: 0` and `trackingMode: NONE`, because the fields do
not exist for it, and the stock summary reports `services` as its own count instead of folding
them into `untracked`.

Existing masters are backfilled by the migration from their own SKUs: a master whose SKUs are
all SERVICE becomes a SERVICE master; every other master is GOOD. A SERVICE SKU left under a
GOOD master by that rule is not broken — every ledger rule still reads the SKU — but it is
reported by the hygiene report (D6) as `NATURE_MISMATCH` until the Business moves it.

**Why the master and not a category flag or a separate table.** A category groups masters
for people; the nature is an accounting statement about what a thing *is*, and it has to sit
where the SKUs inherit from. A separate `Service` table would have given services their own
identity at the cost of two catalogues, two authority ladders and two code namespaces — and a
purchase order line that names "a product" would then have needed a union.

### D2 — One physical variant, one SKU: the variant key is unique per master (BR-039)

`ProductMaster.variantAxes` is the ordered list of axes that distinguish this master's SKUs
(`["color", "size"]`). Each SKU carries `variant`, one value per declared axis, and the
service computes `variantKey` — the normalized `axis=value|axis=value` fingerprint — unique
per master by index. Two SKUs with the same combination cannot both exist, archived or not:
the second is refused with `INVENTORY_PRODUCT_VARIANT_EXISTS` naming the first, and if the
first is archived the answer is `REACTIVATE` (D5), not a new row. The legacy `color` and
`material` columns feed the matching axis when `variant` does not name it, so a master that
declares `["color"]` accepts the SKUs that were already being written with `color`.

A master that declares no axes has no key and enforces nothing — that is every master created
before this ADR, and it is reported (`MASTER_WITHOUT_AXES`) rather than broken. For those, and
for the axis-less descriptive fields on any master, the service applies the softer
**lookalike guard**: a new SKU whose normalized name, colour, material and variant exactly
match a live SKU under the same master is refused (`INVENTORY_PRODUCT_LOOKALIKE`) unless the
caller passes `allowLookalike: true`, which is recorded in the audit row. The guard is
deliberately exact-match: a fuzzy one would refuse real variants and be switched off.

Normalization is one function (`normalizeToken`): NFC, lower-case, and every character that
is not a letter, a mark or a digit removed — so `Tumbler  Black`, `tumbler-black` and
`TUMBLER BLACK` are one token, and Thai tone marks survive.

### D3 — A barcode or a partner's code is an attribute of one SKU, and an intake resolves before it creates (BR-002)

`ProductIdentifier` holds `kind` (`GTIN`, `BARCODE`, `SUPPLIER_CODE`, `MANUFACTURER_PART`,
`LEGACY_CODE`), `value`, an optional `issuer`, an optional `unit` (the pack whose barcode this
is, see D4) and `ACTIVE` / `RETIRED`. It is unique per `(tenantId, kind, value)`, and the two
scannable kinds additionally share one value space — the same barcode cannot be a `GTIN` on
one SKU and a `BARCODE` on another. A `GTIN` must be 8, 12, 13 or 14 digits with a valid
mod-10 check digit (EAN-13 and UPC-A are GTIN-13 and GTIN-12; there is no separate kind for
them). None of these is ever a key, and none of them is an `ExternalRef` — that table is
unique across the installation and carries no `tenantId`, the same reason ADR-074 D5 gave for
`flowAccountSku`.

`GET /api/inventory/products/resolve?identifier=` answers "which SKU is this" from the `code`,
the `flowAccountSku` or any active identifier, and follows a merged SKU to its survivor. It is
the step an intake — Excel, LINE, a scanner — takes before it creates anything, which is the
only place SKU bloat can actually be stopped: at the moment a second row is about to be written.

### D4 — A pack size is a unit conversion on the SKU, never a second SKU (BR-037)

`ProductUnitConversion` declares, per SKU, a unit (`BOX12`, `CTN`) and an integer `factor`
— how many base units one of that unit is — with a `usage` of `PURCHASE`, `SALES` or `ANY`.
The ledger counts base units only: a movement may name a `unit`, and the service converts to
base before `appendMovement` sees it, refusing an unknown unit (`INVENTORY_UNIT_UNKNOWN`) and
a unit on a serial-tracked product (`INVENTORY_UNIT_NOT_FOR_SERIAL`, one serial is one unit by
definition). The factor is an integer because the ledger is; a conversion that would need a
fraction (a pound of grams) is a different base unit, not a factor.

### D5 — A SKU has a lifecycle, and it cannot leave with stock on it (BR-040)

`Product.status` gains `PHASE_OUT` between `ACTIVE` and `ARCHIVED`, and the product actions
grow from two to five:

| Action | From | Effect |
|---|---|---|
| `PHASE_OUT` | ACTIVE | receipts refused (`INVENTORY_PRODUCT_PHASED_OUT`); issues, sales and the sell-down continue; replenishment never suggests it |
| `ARCHIVE` | ACTIVE, PHASE_OUT | refused while a counted SKU has on-hand (`INVENTORY_PRODUCT_HAS_STOCK`) or live reservations (`INVENTORY_PRODUCT_HAS_RESERVATIONS`) |
| `REACTIVATE` | PHASE_OUT, ARCHIVED | back to ACTIVE; a merged duplicate cannot (`INVENTORY_PRODUCT_MERGED`) |
| `MERGE` `{ into }` | ACTIVE, PHASE_OUT | the anti-bloat repair: same Business, same nature; on-hand moves to the survivor as an ISSUE / RECEIPT pair (reference `MERGE:<code>`) when both are TRACKED / NONE, otherwise the duplicate must be empty first (`INVENTORY_MERGE_REQUIRES_EMPTY_STOCK`); active identifiers and unit conversions move to the survivor; bundle items and recipe lines are re-pointed unless the survivor already appears there (`INVENTORY_MERGE_BLOCKED_BY_REFERENCES`); the duplicate ends ARCHIVED with `mergedIntoProductId` set, and its ledger stays |
| `UPDATE` | ACTIVE, PHASE_OUT | as before, plus `variant` (re-keyed, re-checked) and the D6 replenishment fields |

Merge never deletes and never rewrites a ledger row: "why does this SKU say 0 and that one
500" is answerable from the two rows the merge wrote. Sales and purchase order lines that
name the duplicate keep naming it — they are history — and `resolve` redirects the living.

### D6 — Replenishment parameters live on the SKU; the hygiene report is read-only and pure

`Product` gains `reorderPoint`, `reorderQty` and `leadTimeDays` (all nullable). A TRACKED,
ACTIVE SKU whose on-hand is below `reorderPoint ?? safetyStock` appears in
`GET /api/inventory/replenishment` with `suggestedQty = reorderQty ?? (threshold − onHand)`.
It is a suggestion the Procurement lane may turn into a purchase order; Inventory never
creates one (ADR-066).

`GET /api/inventory/catalog-hygiene` is the anti-bloat *report*: every finding is computed by
a pure function in `domain/inventory-hygiene.js` over the catalogue and the ledger, so a page
and a test agree. Kinds: `NATURE_MISMATCH`, `LOOKALIKE_SKUS`, `MASTER_WITHOUT_AXES`,
`MASTER_WITHOUT_SKUS`, `DORMANT_SKU` (counted, empty, no movement in `dormantDays`, 180 by
default), `SKU_WITHOUT_IDENTIFIER`, `SERVICE_WITH_STOCK_FIELDS`, `PHASE_OUT_WITH_STOCK`.
Each names the rows and the action that repairs it. The report writes nothing; the repairs
are the D5 actions, run by a person.

### D7 — What this does not do

No new domain, no new role, no new authority: every write is still Business OWNER or
`INVENTORY_MANAGER`, every refusal is still the FR-072 404. No category hierarchy (a flat
category with a family above the master is what the owner asked for in FR-154, and a tree
would re-open that). No FlowAccount push, no Excel / LINE intake converter — `resolve` is the
contract those will call. No automatic merge: the report proposes, a person disposes.

## Mapping to ERP vocabulary

| ERP concept | Here | Decision |
|---|---|---|
| Item type / material type (service vs. stocked vs. non-stocked) | `ProductMaster.nature` + `Product.stockPolicy` | D1 |
| Product template with variant attributes | `ProductMaster.variantAxes` + `Product.variant` / `variantKey` | D2 |
| GTIN / EAN / UPC, vendor item number, manufacturer part number | `ProductIdentifier` | D3 |
| Alternate units of measure, purchase / sales UoM | `ProductUnitConversion` | D4 |
| Item status: active, phase-out / discontinued, blocked | `Product.status` ACTIVE / PHASE_OUT / ARCHIVED | D5 |
| Item merge / duplicate consolidation | `MERGE` action, `mergedIntoProductId` | D5 |
| Reorder point, reorder quantity, planned delivery time | `reorderPoint`, `reorderQty`, `leadTimeDays` | D6 |
| Master data quality report | `catalog-hygiene` | D6 |

## Consequences

1. **Migration `20260913120000_inventory_sku_governance`** in both trees: three columns on
   `ProductMaster` (with the nature backfill), six on `Product`, the unique
   `(productMasterId, variantKey)` index (NULL-tolerant, so every existing row stays valid),
   and two tables with forced RLS and private grants. Not applied to production by this
   change (ADR-057).
2. **Existing fixtures change where they were wrong.** The test that made a service a variant
   of a tumbler now creates a service master. That is the review finding, applied to the
   repository's own data.
3. **The dashboard SKU form narrows by the master's nature**: a SERVICE master offers no
   policy choice at all; a GOOD master offers counted or uncounted. The `/inventory/hygiene`
   tab is the report and the merge desk.
4. **Intake surfaces gain a contract.** Every future converter (FR-154's "Excel / LINE intake
   converters", still open) must call `resolve` before `POST /api/inventory/products`, and
   the guard in D2 refuses what a converter gets wrong anyway.
5. **Two numbers on the stock summary change meaning**: `untracked` no longer includes
   services, and a new `services` count appears beside it. Any reader that summed
   `tracked + untracked` to get `products` now needs `services` as well.
