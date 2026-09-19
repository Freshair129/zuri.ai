---
id: ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913
version: "0.1.0b"
status: approved
superseded_by: null
created_at: "2026-09-13T18:30:00+07:00,Claude Fable 5.1"
last_update: "2026-09-13T18:30:00+07:00,Claude Fable 5.1"
attributes:
  domain: commerce
  doc_type: feature-contract-proposal
  scope: "SmartGift cost calculation and quotation (price-boss) brought into zuri-ai: cost intake, versioned pricing rules, one pricing engine, quotations, LINE ladder quote, knowledge structured records"
---

# Approved proposal — SmartGift Cost & Quote Engine

## Status

Proposed 2026-09-13 from the owner's request to bring the cost calculation system of
`business-01-smart-gift` into zuri-ai with UI/UX and formula adjustments. **The owner
accepted every recommended default on 2026-09-13** ("ใช้ค่าที่แนะนำทั้งหมด"), so the nine
decisions in section 6 are recorded as taken, and the plan in section 7 is scheduled in
`ROADMAP-zuri-ai-24w-program.md` v0.4.2 as TASK-ZAI-052 to TASK-ZAI-059.

This document declares no requirement and no decision record. It is a proposal in the sense
`docs/change-requests/README.md` gives the word: readable, version-controlled, without standing.
The ADR and the FR/FEAT declarations are TASK-ZAI-052's output and will cite this file. The
rendered design with wireframes is the artifact the owner reviewed; this file is its
repository-resident record.

## 1. What exists today

| Concern | SmartGift (`business-01-smart-gift`) | zuri-ai | Gap |
|---|---|---|---|
| Formula location | `price-boss/pricing.html` (browser JS), `src/cascade_engine/pricing_calculator.py`, constants in `config/pricing_rules_formula.yaml` v2026.09.11-v4 exported to `price-boss/pricing-config.json` | `inventory/domain/inventory-costing.js` (landed cost, FR-175) and `agent/tools/smartgift-inventory-tools.js` (FR-181 quote tool with tier margins 22–35% and default logo rates) | The same formula lives in three places with two constant sets that disagree |
| Money | Floats rounded to 4 dp; sell price rounded up to the 10-baht step with `round(value/step, 6)` to hide float noise | Integer satang (ADR-065 D2, BR-027), shared costs rounded up | ROUND-01 in price-boss's own RCA: JS and Python round 0.125 differently and quote different prices |
| Factory cost | `01_raw/08_factory_costs/*.xlsx` (EXW, USD/RMB) → `factory_costs.json` → human-confirmed mapping (ADR-005) → `ProductMaster.base_cost` for 9 of 16 masters | `ProductMaster.baseCost` is a Float attribute; `PurchaseOrderLine.unitCostSatang` exists, but `goods-receipt-service.js:139` posts RECEIPT movements with no `costSatang` | **Cost never reaches the ledger**; the FR-181 tool answers `INVENTORY_COST_UNKNOWN` for any SKU that never went through a work order |
| FX | `usd_to_thb 34.00`, `cny_to_thb 5.00`, locked (SmartGift ADR-009 D4) | `PurchaseOrder.currency` column, no rate | No place to lock a rate per cost sheet |
| Inbound freight | 32-cell matrix (warehouse × mode × goods type × member tier), density switch at 400 kg/CBM, cartons = ceil(qty/upc) | FR-175 takes a typed `seaFreightSatang` total; FR-131 rate card declared only (blocked on SDD-077) | No matrix, no carton data per SKU |
| Domestic delivery | Hard-coded table in `calculate_domestic_shipping()` | ADR-074 D3: the flat 2,500 THB single drop is absorbed into unit cost; multi-drop and islands are a Commerce line | Options B/C/D have no home |
| Customization | `logo_methods` in USD per position/piece by quantity tier; positions = last digit of the code + 2 | Five techniques with satang setup/run (FR-176 records real values, FR-181 carries defaults) | Names and rate shapes differ |
| Sell price | Two profiles: standard (markup 3.00→2.14 on factory cost, anchor 500) and corporate (1.47× on landed, anchor 1000, factors .80/.77/.75/.73); whole-order profit floors by quantity and by kind; round up to 10 THB | FR-181: target margin per tier, `ceil(cost / (1 − margin))`, no floor, no rounding | Different philosophies |
| VAT and discount | At quote save: `Math.round(base × 7) / 100`, amount discounts | FR-186 document-level ROUND_HALF_UP integer satang; FR-166 `discountSatang` | Adopt FR-186 |
| Quote workflow | price-boss CRM: draft → submitted → approved → sent → accepted (rejected / cancelled / expired); print to PDF | No Quote; FR-180 QUOTE reservation and FR-161 SalesTask type QUOTE exist | Build Quote in Commerce |

## 2. Placement

- **Procurement** receives factory cost sheets as `SupplierCostSheet` versions (currency, locked
  FX, source hash, human-confirmed SKU mapping — SmartGift's lane 08 and ADR-005 as a record).
- **Inventory** keeps valuation as it is (FR-175 landed cost in satang, moving weighted average);
  gains carton attributes on `Product` and a cost card on the SKU page. Goods receipts post
  `costSatang`.
- **Commerce** owns `PricingRuleSet`, `Quote`, `QuoteLine` and the pure engine — the offer/price
  layer its charter deferred.
- **Agent** re-points the FR-181 quote tool at the engine; FR-132 (ladder quotation on LINE) is
  unblocked by the rule set.
- **Knowledge** receives sell-side records only (FR-047 excludes cost and margin): a
  `STRUCTURED_RECORDS_V1` format with an Excel converter and MCP widening before Stage 1
  (ADR-075 D2). Cost sheets are a different workbook on a different lane by construction.

## 3. Formula chain (integer satang, `S(x) = ceil(x × 100)`)

```text
factoryUnitSatang(qty)      = S(unitCostForeign(price break ≤ qty) × fxLocked)
inboundFreightSatang(qty)   = cartons = ceil(qty / unitsPerCarton); cbm = cartons × cartonCbm; kg = cartons × cartonKg
                              by weight when kg/cbm ≥ densityKgPerCbm; total = S(kg × rate.kg) or S(cbm × rate.cbm); perUnit = ceil(total / qty)
inlandChinaSatang           = S(perSetCny × fx.cny)
customizationTotalSatang    = Σ positions ( S(setup × fx) + Σ pieces S(rate(qty) × fx) [× colors] ); perUnit = ceil(total / qty)
landedUnitSatang(qty)       = factory + freightPerUnit + inland + ceil(duty / qty) + customizationPerUnit + ceil(singleDrop / qty) + kittingPerUnit
anchorPrice                 = basis(anchorQty) × markup            (basis FACTORY or LANDED; markup flat or by band)
ladder(q)                   = anchorPrice × factor(q) / factor(anchorQty)
floor(q)                    = landed(q) + (max(floorByQty(q), floorByKind(kind, q)) + orderCost) / q
final(q)                    = ceilToStep(max(ladder(q), floor(q)), 1000 satang); driver = LADDER | FLOOR | MANUAL
quote                       = Σ (qty × unitPrice − lineDiscount) − headerDiscount; vat = roundHalfUp(subtotal × vatBps / 10000)
```

Every division is rounded up (BR-027). Margin outside the profile band (corporate 20–35%,
retail 39–52%, SmartGift ADR-009 D3) is a warning flag on the result, never a clamp. The
inbound truck is absorbed and the quote shows delivery 0.00 with `freightAbsorbedSatang`
beside it (ADR-074 D3, SmartGift ADR-009 D2 — kept, not restated).

## 4. UI

- `/commerce/quotes` and `/commerce/quotes/[id]`: line inputs (SKU with ATP badge, quantity, kind,
  technique, positions, colours, delivery option, warehouse/mode, tier), landed-cost waterfall
  with assumption chips, ladder table naming the driver per break, totals with FR-186 VAT,
  actions save → submit → approve (second hat) → send → convert to order.
- `/inventory/products/[productId]`: cost card — WAVG landed cost, last receipt, held value,
  the confirmed cost sheet's price breaks at the locked rate, carton attributes with a
  `CARTON_DATA_MISSING` hygiene finding, ledger cost history.
- `/commerce/pricing-rules`: versioned rule set editor with tabs FX, freight matrix, logo rates,
  ladder profiles, profit floors, domestic delivery, provenance; approve as a new version with an
  effective date; diff against the previous version.
- LINE (FR-132): ladder prices rounded to 10 THB, validity date, free single-drop note; no
  margin, cost or floor in the payload; the reply is returned to the transport, never sent.

## 5. Data model

| Model / column | Lane | Role |
|---|---|---|
| `SupplierCostSheet`, `SupplierCostLine` | procurement | One cost sheet version: supplier, currency, `fxRateLocked`, `sourceRef`, `sourceSha256`, status DRAFT / CONFIRMED / SUPERSEDED; lines by SKU or master with `minQty`, `unitCostForeign`, `unitsPerCarton`, `cartonCbm`, `cartonKg`, `leadTimeDays`, mapping confidence |
| `GoodsReceiptLine.unitCostSatang`, `GoodsReceipt.freightBatchJson` | procurement | The receipt passes `costSatang` to `appendMovement` = agreed line cost plus amortised batch costs |
| `Product.unitsPerCarton`, `cartonCbm`, `cartonKg`, `freightGoodsType` | inventory | Physical data the freight formula needs; nullable; hygiene finding when missing |
| `PricingRuleSet` | commerce | Immutable approved versions of `rulesJson` (Zod schema mirroring the YAML), `effectiveFrom`, `approvedBy`, `approvedAt`, provenance per block |
| `Quote`, `QuoteLine` | commerce | `QUO-YYYYMMDD-NNN`, customer / conversation through the tenant (BR-001), profile, `ruleSetId`, validity, price-boss status machine; lines with input, landed and ladder snapshots, `unitPriceSatang`, `priceDrivenBy`, `manualReason` |
| `CommerceDocument.type` gains `QUOTATION` | commerce | Snapshot document under FR-186 |

## 6. Decisions — recommended defaults accepted by the owner, 2026-09-13

| # | Question | Decision |
|---|---|---|
| Q1 | Keep the global small-order factor (1.5 → 1.0)? | Use real factory price breaks per SKU from the cost sheet; SOF remains only as a flagged fallback when a sheet has no breaks |
| Q2 | Markup ladder (SmartGift) or margin per tier (FR-181)? | SmartGift's markup ladder is the data shape; the margin band is a warning; FR-181's `QUOTE_TIERS` retire |
| Q3 | Where does the freight rate card live? | In `PricingRuleSet`, one block with one provenance; FR-131 is re-scoped onto it; the LINE tool reads through Commerce's read port |
| Q4 | Inland China freight: per set or per CBM? | Per set (2 CNY, the basis the engine actually uses); the CBM formula stays an option in the rule set |
| Q5 | Package profit guardrail 20,000 / 25,000 / 30,000? | 20,000 is the floor (owner directive 2026-09-11), 30,000 the displayed target; the TDD's 25,000 is retired |
| Q6 | Domestic delivery options B/C/D figures? | Moved into the rule set as data with provenance `code_only`; attaching a real carrier rate card is the next revision |
| Q7 | Which logo rates? | SmartGift's USD tables (from the factory price list) as defaults; a job may override with the workshop's own rate per quote |
| Q8 | Who approves a quote? | Business OWNER or a `QUOTE_APPROVER` role; the creator never approves their own quote (FR-196 pattern) |
| Q9 | LINE intent: model-selected tool or matcher? | Deterministic matcher first (the FR-210 `#sku` precedent); model selection later |

## 7. Plan

| Phase | Task | Sprint | Delivers |
|---|---|---|---|
| 0 | TASK-ZAI-052 | SPR-ZAI-02 (current) | This record, the ADR, FR/FEAT declarations, ledger pins; FR-131 re-scope, FR-132 blocker restated, FR-181 status |
| 1 | TASK-ZAI-053 | SPR-ZAI-02 (current) | `SupplierCostSheet` intake (Excel/JSON, preview → commit, confirmed mapping, locked FX), carton attributes, hygiene finding |
| 1 | TASK-ZAI-054 | SPR-ZAI-02 (current) | Goods receipts post landed unit cost; SKU cost card |
| 2 | TASK-ZAI-055 | SPR-ZAI-03 | `PricingRuleSet` v1 ported from the YAML with provenance; Pricing Rules console |
| 2 | TASK-ZAI-056 | SPR-ZAI-03 | `pricing-engine.js` (pure, satang) with price-boss parity fixtures; FR-181 reads the rule set |
| 3 | TASK-ZAI-057 | SPR-ZAI-03 (may move to 04) | Quotes, two-hat approval, QUOTATION document, conversion to sales order with the FR-180 hold |
| 4 | TASK-ZAI-058 | SPR-ZAI-04 | Ladder quotation on LINE (FR-132) over the same engine, deterministic matcher |
| 4 | TASK-ZAI-059 | SPR-ZAI-04 | Knowledge `STRUCTURED_RECORDS_V1`, Excel template and converter, MCP widening |

Migrations ride the ADR-057 operator step (TASK-ZAI-043 or their own recorded apply). Phase 1
is first because it makes every later number real: after it lands, the count of SKUs with a
ledger cost, without factory breaks and without carton data tells how many assumptions the
first quotes will carry.

## 8. Sources read

`config/pricing_rules_formula.yaml`, `src/cascade_engine/pricing_calculator.py`,
`price-boss/pricing.html`, `price-boss/server/index.mjs`, `price-boss/docs/workflow-quotation.md`,
`price-boss/.brain/rca/price-engine-comparison-2026-08-30.md`, SmartGift ADR-005 and ADR-009;
zuri-ai ADR-074, ADR-065, ADR-083, ADR-084, ADR-050 D3, ADR-075 D2; FR-175, FR-176, FR-177,
FR-180, FR-181, FR-131, FR-132, SDD-077, FR-166, FR-186, FR-047, FR-187, FR-209;
`inventory-costing.js`, `smartgift-inventory-tools.js`, `goods-receipt-service.js`,
`knowledge-admission-service.js`, `smartgift-catalog-adapter.js`, `catalog-workbook.js`;
the inventory and commerce charters, `ONTOLOGY.md`, `CR-005-ACCEPTED-SHAPE.md`. No `.env` and
no database was read.

## CHANGELOG

| Version | Date | Change |
|---|---|---|
| 0.1.0b | 2026-09-13 | Recorded from the reviewed design; owner accepted the nine recommended defaults; plan scheduled as TASK-ZAI-052 to TASK-ZAI-059 in programme v0.4.2 |
