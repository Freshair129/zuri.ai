---
domain: inventory
feature: FR-175
module: inventory
source: v2-native
bundle: FEAT-025
requirements:
  - FR-175
version: "0.1.0"
status: beta
---

# FR-175 — Valuation follows the moving weighted average

## Intent

FR-175 and ADR-074 D3 say valuation across receipts is a moving weighted
average: a receipt blends into the running average at the moment it lands.
Until 2026-11-12 the code computed something else. Every cost projection called
one helper that averaged every receipt a product had ever had,
`sum(qty × cost) / sum(qty)`, and issues never reduced the basis.

The standing example: receive 10 at 100.00, issue all 10, receive 10 at 200.00.
The stock on hand cost 200.00. The old figure was 150.00.

This note records what changed for a reader of the numbers. The rule itself and
its scope are stated once, in the
[Inventory charter](../CHARTER.md#valuation--one-rule-one-scope-fr-175-adr-074-d3),
and are not repeated here.

## Decisions taken in this change

1. **Scope is the product, Business-wide, not the location.** ADR-074 D2, D3 and
   consequence 2 require it; the charter gives the reasoning.
2. **A transfer is valuation-neutral.** The issue at the source and the receipt
   at the target are matched and removed from the replay. The match is on
   `occurredAt`, `reference`, `reason` and `workOrderId`, with equal quantities
   on both sides. `reason` is part of the key because a work-order completion
   writes a consumption issue and a buffer-return transfer with the same
   reference and timestamp.
3. **A receipt without a cost is carried at the running average and makes the
   figure partial** until the position empties and a costed receipt restarts it.
4. **A cost-less adjustment up is a count correction**, valued at the running
   average and not flagged, unless no average is known.
5. **The all-time receipt average survives only as a purchasing statistic**,
   renamed `allTimeReceiptAverageSatang`. No cost is derived from it.

## Numbers a user or a downstream system now sees differently

| Where | What it showed before | What it shows now | Why |
|---|---|---|---|
| SKU page `/inventory/products/[productId]` — "ต้นทุนเฉลี่ยถ่วงน้ำหนัก" tile and the Landed Cost card (`costing.weightedAverageLandedCostSatang`) | The average price of every receipt ever | The average cost of the stock on hand | Issues now reduce the basis. The figure differs for any SKU that had an issue between two receipts at different costs. A SKU with receipts and no issues shows the same number as before, apart from rounding (below) |
| Same page, SKU with nothing on hand | The all-time average | The average the last units left at | An empty position keeps its last average until the next costed receipt replaces it |
| Same page, SKU that has a receipt with no cost | A figure that silently ignored the uncosted units | The figure plus a warning that it is partial, with the number of uncosted units | Uncosted units are in the quantity, carried at the running average, and reported |
| Same page, new line "ค่าเฉลี่ยราคาซื้อสะสม" (`costing.allTimeReceiptAverageSatang`) | Not shown under its own name | The old figure, labelled as a purchasing average and not a cost of stock | Kept for a buyer comparing prices paid; it is no longer presented as the valuation |
| Same page, API field `costing.valuation` | Did not exist | `method`, `scope`, `unitCostSatang`, `onHandQty`, `partial`, `partialReasons`, `uncostedQty` | A consumer can tell a complete figure from a partial one |
| Kitting work order — the finished set's receipt `costSatang` and the order's `unitCostSatang` | Each component at its all-time average | Each component at its moving average when the run completes | A set assembled from recently re-bought components now carries what those components cost |
| Customization work order — the branded output's receipt `costSatang` | Raw SKU at its all-time average, plus setup and run cost | Raw SKU at its moving average, plus setup and run cost | Same reason. The raw cost is read after the raw units are issued, which is why an empty position keeps its average |
| De-kitting — the `costSatang` on each component returned to stock | The component's all-time average | The component's moving average | A returned component re-enters at what its position currently costs, so the return does not move the average |
| Pricing catalogue preview and approval (FR-253) — the sell price | Priced from the all-time average | Priced from the moving average of the stock on hand | New previews and approvals for a SKU whose cost changed between receipts produce a different price. Prices already frozen or published are not recomputed |
| Pricing catalogue — refusal `PRICING_CATALOG_COMPLETE_LEDGER_COST_REQUIRED` | Refused if any receipt ever lacked a cost, including the cost-less receipt half of every transfer | Refused only while the current valuation is partial | A SKU that was transferred between locations, or whose uncosted stock has since been fully depleted and re-bought, can now be priced |
| Pricing catalogue — refusal `PRICING_CATALOG_PREVIEW_CHANGED` | Raised when a receipt landed between preview and approval | Raised when any movement of the SKU lands between preview and approval | The evidence hash now covers every row that feeds the price. A preview taken before this change must be taken again |
| Agent tool `calculate_smartgift_quote` (FR-181) — `unitCostSatang` and the quote built on it | The all-time average | The moving average | Same rule as the catalogue |
| Agent tool — refusal `INVENTORY_COST_UNKNOWN` | Raised if any receipt ever lacked a valid cost, transfers included | Raised only while the current valuation is partial | Same reason as the catalogue refusal |
| SCM service (`services/scm`) product page, kitting, customization, de-kitting | The all-time average | The moving average | The service mirrors the Server rules; its kernel is generated from the same file |

**Rounding.** The moving average rounds up to the satang at each blend, as
BR-027 rounds every shared cost. Across many receipts the figure can sit up to
one satang per blend above the exact all-in average. Example: 1 at 1.00 and 1 at
1.01 blend to 1.01; a third unit at 0.99 gives 1.01, where the all-time figure
was 1.00.

## What does not change

- No ledger row is rewritten. `costSatang` already stored on a movement keeps
  its value, including work-order outputs costed under the old rule.
- No schema change and no stored running average.
- `lastReceiptCostSatang`, `costHistory` and the supplier price breaks on the
  SKU page.
- How a goods receipt computes the landed cost of a line.
- The persisted `sourceRefs` shape of a pricing calculation
  (`kind`, `productId`, `receiptCount`, `sha256`). `sha256` now covers every
  movement; `receiptCount` still counts receipts.

## Known limits, not addressed here

- A SKU merge, an FR-156 recipe build and a manual receipt entered on the
  Inventory console all write a receipt with no cost. Each makes the receiving
  SKU's valuation partial, so the pricing catalogue and the agent quote refuse
  it until the position restarts. The catalogue refused these before as well.
- De-kitting values a returned component from the component's own position, not
  from the cost of the set it came out of.
- `transferStock` accepts a `costSatang` and writes it on both halves; the
  valuation ignores it.
- Capturing landed-cost components at goods receipt is a separate review
  finding.

## Evidence

- `tests/unit/inventory-costing.test.js` — AC-175.9 to AC-175.20: depletion then
  receipt returns 200, partial depletion, several receipts, uncosted receipts,
  out-of-order input, transfers, invalid rows, exact arithmetic, and every
  permutation of 250 generated ledgers giving the same result.
- `tests/integration/fr165-goods-receipt.test.js` — the SKU page after receive,
  issue all, receive.
- `tests/integration/fr177-kitting-work-order.test.js` — staging to WIP leaves
  the component's valuation unchanged and complete.
- `tests/integration/fr253-pricing-catalog.test.js` — pricing from the stock on
  hand, the partial refusal, the hash moving on an issue.
- `tests/integration/fr181-smartgift-agent-tools.test.js` — the agent quote's
  refusals and exact arithmetic.
