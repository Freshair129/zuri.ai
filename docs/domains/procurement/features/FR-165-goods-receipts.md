---
domain: procurement
feature: FR-165
module: procurement
source: legacy-prior-art
bundle: FEAT-024
requirements:
  - FR-165
version: "0.3.0b"
status: building
---

# FR-165 — Goods receipts into the stock ledger (grn_id)

## Intent

What actually arrived against a purchase order, and the stock it became: a
goods receipt posted line by line against a SENT order, whose counted lines
land in the Inventory ledger in the same transaction. The legacy "GRN" adapted
under [ADR-066](../../../decisions/ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md)
D4 and D6.

## Decisions worth recording

**The receipt is the record; the ledger is the stock.** `GoodsReceipt` and
its lines say what was delivered, when and under which delivery note; the
`StockMovement` rows they post (reference `PO:<code>/GRN:<code>`, reason
`GOODS_RECEIPT`) say what is held. One ledger (FR-155), not a second stock
table.

**Line by line, never beyond the order.** Every receipt line names one order
line of that order and may not receive more than it still has outstanding —
refused whole with the per-line list (`PROCUREMENT_RECEIPT_EXCEEDS_ORDERED`).
A receipt is posted only against a SENT order.

**Lots, expiry and serials travel with the line.** A LOT-tracked SKU needs
its `lotCode` (Inventory's `INVENTORY_LOT_REQUIRED` bubbles up); a given
`expiresAt` is set on a lot that has none yet and never overwrites one that
does — through Inventory's `setLotExpiryIfUnset`, which compare-and-swaps the
lot `version`, bumps it and audits `PRODUCT_LOT_EXPIRY_SET`; Procurement never
writes `ProductLot` (review finding C8); a SERIAL-tracked SKU needs exactly one serial per unit. An uncounted
SKU or a free-text line is recorded on the receipt, touches no ledger, and
refuses lot or serial data.

**The unit cost is derived, never typed (review finding C14).** ADR-074 D3
says landed cost is computed. A counted line's cost handed to Inventory is the
PO line's agreed cost — converted at the locked rate of a confirmed
`SupplierCostSheet` (`fxCostSheetId`, same Business, supplier and currency; the
rate is read from the sheet, never supplied) when the PO is not in THB — plus
each typed `landedCosts` component (`SEA_FREIGHT`, `IMPORT_DUTY`,
`INBOUND_TRUCK`, `OTHER` with a note) amortised `ceil(amount / counted
quantity)`. The legacy `batchCostSatang` still works and is recorded as one
`OTHER` component; it cannot be combined with `landedCosts`. The components,
rate, sheet and each line's derived `unitCostSatang` are stored on the receipt
and in the audit row, so the figure is reproducible from stored rows. A
supplied `costSatang` is refused by the strict contract; a component above the 32-bit column is refused by the request contract (422 validation) and a derived unit cost above it by `PROCUREMENT_RECEIPT_COST_OUT_OF_RANGE`, and Inventory's public
`recordMovement` refuses the reserved reason `GOODS_RECEIPT`.
There is **no manual-override path**: the approved text defines none, so none
was invented.

**Two ladders, checked separately.** The buyer's `procurement.receipt.post`
(or the owner) posts the receipt; the ledger rows need Inventory's write
authority on top (`403 PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY`),
because a Procurement role never widens Inventory. A receipt of only
free-text or uncounted lines needs no Inventory authority.

**Completion is the receipt's side effect.** The receipt that completes every
line makes the order RECEIVED in the same transaction (audited on the order
too); a RECEIVED, SHORT_CLOSED or CANCELLED order receives nothing more; the order's
`version` moves with each receipt so a stale caller conflicts; CANCEL is
refused once a receipt exists.

**Never edited.** A receipt has no status, no version and no PATCH. A wrong
one is corrected by an Inventory ADJUSTMENT and, when a return FR exists, by
a return.

## Delivered (local, 2026-09-07)

- `GoodsReceipt`, `GoodsReceiptLine` in both schemas; migration shared with
  FR-164 (**not applied**).
- `application/goods-receipt-service.js` — the only writer; the receipt plan
  and reference in `domain/procurement.js`.
- `GET/POST /api/procurement/purchase-orders/[id]/receipts`; the receipt
  panel of the `/procurement/purchase-orders` console.
- Tests: `tests/integration/fr165-goods-receipt.test.js` (AC-165.1–.5),
  calculators in the unit suite, the e2e spec shared with FR-164 (the
  Warehouse's on-hand rises by what the receipts posted).

## Retained workstation completion (2026-09-11)

The owner's parallel completion request resumes the retained Goods Receipts
workstation under FR-165 and ADR-066. Risk LOW; C-2, no schema change. Add
`/procurement/receipts` with scoped registry and detail reads, intake against
SENT purchase orders, and a printable receipt. Posting continues through
`postGoodsReceipt`, retaining both permission ladders and atomic stock/audit
writes. Quantity starts blank: the receiver supplies what actually arrived.
The receipt shows persisted PO/line/lot/serial data and distinguishes counted
goods from lines that do not affect stock. No quality-inspection or warehouse
location capability is introduced by this workstation.

List queries validate a bounded positive limit and return an explicit
`hasMore` flag; the UI describes the displayed subset rather than calling its
length a Business total. Business changes discard selection, intake and stale
responses. Verification covers real persisted detail and scope refusals,
malformed pagination, stale response isolation and the browser intake/read
flow. Local verification: 17 database/route/tab tests passed; Server build
passed; two focused browser tests passed with zero retries (real intake and
reload; delayed response after Business change). The standard warmup passed
before the first intake proof; the final two-test run used `--no-deps` while
fixing a test fixture, so the combined full E2E gate remains an integration
check. Browser screenshots show the real persisted voucher and Bangkok date.

## Remaining exclusions

Purchase returns and credit notes; a receipt against no order (a direct
receipt stays Inventory's own RECEIPT movement); warehouse locations; quality
inspection and quarantine on receipt; production application of the migration
(ADR-057, `20261113090000_goods_receipt_cost_provenance`).

## Open policy questions (not decided by the approved text)

- **Manual cost override.** Whether an authorised person may post a receipt at a
  cost different from the derived one (with actor, reason and audit event) is
  not decided by ADR-074, FR-164/165 or the charters. The strict path ships
  without it; adding one needs an owner/delegated decision.
- **Which locked rate.** ADR-074 D3 says "the rate locked at clearance". Today
  the only recorded locked rate is a `SupplierCostSheet.fxRateLocked`, so a
  foreign-currency receipt uses the sheet the caller names. A rate captured at
  customs clearance on the receipt itself would need its own record.
- **Minor units.** A foreign PO line's `unitCostSatang` is read as the PO
  currency's two-decimal minor unit (`/100`). A currency with another exponent
  (`NON_TWO_DECIMAL_CURRENCIES`, e.g. JPY, KWD) is refused for a counted line
  (`422 PROCUREMENT_RECEIPT_FX_CURRENCY_UNSUPPORTED`) instead of being mis-valued;
  supporting them needs a currency-exponent rule on the PO.
- **SCM service.** `services/scm` does not port `landedCosts` / FX; it refuses
  them (`PROCUREMENT_RECEIPT_COST_INPUTS_NOT_SUPPORTED`) until it owns the flow.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-11-13 | building | Receipt cost derived from recorded inputs with stored provenance and no manual override; lot expiry set through Inventory's version-checked contract; additive schema columns with an unapplied migration | working-tree | Claude Sonnet 5.5 |
| 0.2.0b | 2026-09-11 | building | Complete the retained receipt workstation with actual scoped projections, validated pagination, intake and printable detail; no schema or posting-policy change | working-tree | RWANG |
