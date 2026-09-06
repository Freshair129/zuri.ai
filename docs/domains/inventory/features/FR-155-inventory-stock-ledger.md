---
domain: inventory
feature: FR-155
module: inventory
source: v2-native
bundle: FEAT-020
requirements:
  - FR-155
version: "0.1.0"
status: building
---

# FR-155 — Inventory stock ledger (lot · serial · movement)

## Intent

The ledger half of the owner's inventory request: how many of a counted
product the Business holds, identified as an anonymous quantity, per lot
(`lot_id`) or per serial-numbered unit (`serial_id`), and every movement that
got it there. FR-154 owns who a product is; this FR owns what happened to it.

## Decisions worth recording

**Append-only, signed, summed.** A `StockMovement` is written once and never
edited or deleted. RECEIPT contributes `+q`, ISSUE `−q`, ADJUSTMENT its own
sign (a stocktake correction either way). On-hand is `SUM(quantity)` per
product, recomputed on every read; the summary route does that read, and the
product route does it for one product. An ISSUE that would take on-hand
below zero is refused (`INVENTORY_INSUFFICIENT_STOCK`).

**An uncounted product has no ledger.** `recordMovement` refuses an
UNTRACKED product by code (`INVENTORY_PRODUCT_UNTRACKED`) and the summary
prints `null` for its on-hand. A zero would read as "measured and empty",
which is the wrong answer for a service or a made-to-order item.

**The tracking mode decides what a movement must carry.** For `LOT`, a
receipt names an existing lot (`lotId`) or a lot code (`lotCode`) — an unknown
code creates the lot, so the common path "goods arrived with a lot number" is
one call — and the lot's `receivedQty` follows; a receipt into a CLOSED lot is
refused. For `SERIAL`, every movement names exactly one serial per unit
(`serialNos.length === quantity`), the service writes **one ledger row per
unit** so a unit's history is its own rows, a unit is created IN_STOCK by its
first receipt, moved to ISSUED by an issue, and a receipt of an ISSUED serial
brings it back — while a receipt of a serial that is already IN_STOCK and an
issue of one that is not are refused by code. ADJUSTMENT is not allowed on a
serial product: a discrepancy there is a specific unit, which is a receipt or
an issue of that serial. For `NONE`, a lot or a serial on the movement is
refused, so a plain product cannot quietly grow per-unit rows.

**`POST /api/inventory/lots` exists for the dated lot.** Most lots are born
by a receipt; the explicit path is for a batch whose factory, manufacture
and expiry dates are known before stock arrives. `GET /api/inventory/serial-units`
is read-only on purpose: a unit that could be created by hand would have a
state no ledger row explains.

**Manager authority, FR-072 refusals, one audit row per write.** The
movement's audit payload carries `onHandBefore` / `onHandAfter`, so the audit
stream alone reconstructs the balance; serial units additionally audit
`SERIAL_UNIT_RECEIVED` / `SERIAL_UNIT_ISSUED` per unit.

## Delivered (local, 2026-09-06)

- `ProductLot`, `SerialUnit`, `StockMovement` in both schemas; the shared
  FR-154/155 migrations in both trees (**not applied** to production).
- `src/modules/inventory/application/inventory-stock-service.js` — the only
  writer: `createLot`, `recordMovement`; readers `listLots`, `listSerialUnits`,
  `listMovements`, `stockSummary`.
- `GET/POST /api/inventory/lots`, `GET /api/inventory/serial-units`,
  `GET/POST /api/inventory/stock-movements`, `GET /api/inventory/stock`.
- The `/inventory` dashboard: KPIs, the per-product table with recomputed
  on-hand, and the movement form.
- Tests: `tests/integration/fr155-inventory-stock.test.js` (AC-155.1–.5),
  the ledger calculators in `tests/unit/inventory-domain.test.js`.

## Not in this slice

Warehouse locations and transfers between them; reservations against an
order; expiry alerts; stocktake campaigns (Asset Management has the pattern);
costing (FIFO / average); Excel or LINE intake of movements; production
application of the migration (ADR-057).
