---
id: ZAI:FR-175-NOTE
status: active
superseded_by: null
version: "0.2.0"
domain: inventory
feature: FR-175
relations:
  - type: references
    target: ZAI:FR-175
  - type: relates_to
    target: ZAI:ADR-074
---

# Why the cost figures changed on 2026-11-12

This note is rationale and reader context for
[ZAI:FR-175](../../../features/FEAT-025/requirements/FR-175.md), canonical record
revision 1, and [ADR-074](../../../decisions/ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md)
decision D3. The requirement, its identity, membership and lifecycle are in that
record. The valuation rule and its scope are stated once, in the
[Inventory charter](../CHARTER.md#valuation--one-rule-one-scope-fr-175-adr-074-d3).
What has been implemented and which tests cover it is in the generated
[verification view](../../../features/FEAT-025/verification.md). None of that is
repeated here.

## What was wrong

Every cost projection called one helper that averaged every receipt a product had
ever had, `sum(qty × cost) / sum(qty)`. Issues never reduced the basis. Receive 10
at 100.00, issue all 10, receive 10 at 200.00: the stock on hand cost 200.00 and
the figure shown was 150.00.

## Choices made while correcting it

1. **Scope is the product, Business-wide, not the location.** ADR-074 D2, D3 and
   consequence 2 require it; the charter gives the reasoning.
2. **A transfer is valuation-neutral.** The issue at the source and the receipt at
   the target are matched and removed from the replay. The match is on
   `occurredAt`, `reference`, `reason` and `workOrderId`, with equal quantities on
   both sides. `reason` is part of the key because a work-order completion writes a
   consumption issue and a buffer-return transfer with the same reference and
   timestamp.
3. **A receipt without a cost is carried at the running average and makes the
   figure partial** until the position empties and a costed receipt restarts it.
4. **A cost-less adjustment up is a count correction**, valued at the running
   average and not flagged, unless no average is known.
5. **Receipts written at the same instant are one blend with one rounding.** A
   goods receipt posts its lines in one transaction, so they share both
   timestamps. Blending them one by one would make the result depend on row
   order, because each blend rounds up.
6. **A balance that goes below zero during the replay makes the figure partial,
   and a later receipt does not clear it.** The ledger accepts a movement dated
   in the past or the future, so the rows can describe a history in which stock
   was issued before it arrived. The cost of such a position cannot be proven
   from the rows.
7. **The all-time receipt average survives only as a purchasing statistic**,
   renamed `allTimeReceiptAverageSatang`. No cost is derived from it.

## Numbers a user or a downstream system now sees differently

| Where | What it showed before | What it shows now | Why |
|---|---|---|---|
| SKU page `/inventory/products/[productId]` — "ต้นทุนเฉลี่ยถ่วงน้ำหนัก" tile and the Landed Cost card (`costing.weightedAverageLandedCostSatang`) | The average price of every receipt ever | The average cost of the stock on hand | Issues now reduce the basis. The figure differs for any SKU that had an issue between two receipts at different costs. A SKU with receipts and no issues shows the same number as before, apart from rounding (below) |
| Same page, SKU with nothing on hand | The all-time average | The average the last units left at | An empty position keeps its last average until the next costed receipt replaces it |
| Same page, SKU that has a receipt with no cost | A figure that silently ignored the uncosted units | The figure plus a warning that it is partial, with the number of uncosted units | Uncosted units are in the quantity, carried at the running average, and reported |
| Same page, SKU whose balance goes below zero when its movements are ordered by date | The all-time average, with no warning | The replayed figure plus a warning that it cannot be confirmed | A back-dated issue or a post-dated receipt describes stock leaving before it arrived |
| Same page, new line "ค่าเฉลี่ยราคาซื้อสะสม" (`costing.allTimeReceiptAverageSatang`) | Not shown under its own name | The old figure, labelled as a purchasing average and not a cost of stock | Kept for a buyer comparing prices paid; it is no longer presented as the valuation |
| Same page, API field `costing.valuation` | Did not exist | `method`, `scope`, `unitCostSatang`, `onHandQty`, `partial`, `partialReasons`, `uncostedQty` | A consumer can tell a complete figure from a partial one |
| Kitting work order — the finished set's receipt `costSatang` and the order's `unitCostSatang` | Each component at its all-time average | Each component at its moving average when the run completes | A set assembled from recently re-bought components now carries what those components cost |
| Customization work order — the branded output's receipt `costSatang` | Raw SKU at its all-time average, plus setup and run cost | Raw SKU at its moving average, plus setup and run cost | Same reason. The raw cost is read after the raw units are issued, which is why an empty position keeps its average |
| De-kitting — the `costSatang` on each component returned to stock | The component's all-time average | The component's moving average | A returned component re-enters at what its position currently costs, so the return does not move the average |
| Pricing catalogue preview and approval (FR-253) — the sell price | Priced from the all-time average | Priced from the moving average of the stock on hand | New previews and approvals for a SKU whose cost changed between receipts produce a different price. Prices already frozen or published are not recomputed |
| Pricing catalogue — refusal `PRICING_CATALOG_COMPLETE_LEDGER_COST_REQUIRED` | Refused if any receipt ever lacked a cost, including the cost-less receipt half of every transfer | Refused only while the current valuation is partial | A SKU that was transferred between locations, or whose uncosted stock has since been fully depleted and re-bought, can now be priced. A SKU whose ledger goes negative when ordered by date is now refused, where before it was priced |
| Pricing catalogue — refusal `PRICING_CATALOG_PREVIEW_CHANGED` | Raised when a receipt landed between preview and approval | Raised when any movement of the SKU lands between preview and approval | The evidence hash now covers every row that feeds the price. A preview taken before this change must be taken again |
| Agent tool `calculate_smartgift_quote` (FR-181) — `unitCostSatang` and the quote built on it | The all-time average | The moving average | Same rule as the catalogue |
| Agent tool — refusal `INVENTORY_COST_UNKNOWN` | Raised if any receipt ever lacked a valid cost, transfers included | Raised only while the current valuation is partial | Same reason as the catalogue refusal |
| SCM service (`services/scm`) product page, kitting, customization, de-kitting | The all-time average | The moving average | The service mirrors the Server rules; its kernel is generated from the same file |

**Rounding.** The moving average rounds up to the satang at each blend, as BR-027
rounds every shared cost. Across many receipts the figure can sit up to one satang
per blend above the exact all-in average. Example: 1 at 1.00 and 1 at 1.01, on
different days, blend to 1.01; a third unit at 0.99 on a third day gives 1.01,
where the all-time figure was 1.00.

## What does not change

- No ledger row is rewritten. `costSatang` already stored on a movement keeps its
  value, including work-order outputs costed under the old rule.
- No schema change and no stored running average.
- `lastReceiptCostSatang`, `costHistory` and the supplier price breaks on the SKU
  page.
- How a goods receipt computes the landed cost of a line.
- The persisted `sourceRefs` shape of a pricing calculation (`kind`, `productId`,
  `receiptCount`, `sha256`). `sha256` now covers every movement; `receiptCount`
  still counts receipts.

## Known gaps, not addressed here

- **The ledger writer still accepts a movement whose date makes the history
  impossible.** `appendMovement` refuses an issue only when it would take the
  current total below zero; it does not check the balance at the movement's own
  date. Such a ledger is now reported and refused for pricing, not prevented.
  Refusing it at write time changes the FR-155 ledger rule for every flow that
  sets `occurredAt`, so it needs its own decision. The only remedy today is a
  correcting movement dated so the balance never goes negative.
- A SKU merge, an FR-156 recipe build and a manual receipt entered on the
  Inventory console all write a receipt with no cost. Each makes the receiving
  SKU's valuation partial, so the pricing catalogue and the agent quote refuse it
  until the position restarts. The catalogue refused these before as well.
- De-kitting values a returned component from the component's own position, not
  from the cost of the set it came out of.
- `transferStock` accepts a `costSatang` and writes it on both halves; the
  valuation ignores it.
- Capturing landed-cost components at goods receipt is a separate review finding.
