---
version: "0.2.2b"
created_at: "2026-08-11T09:30:00+07:00, Claude"
last_update: "2026-08-11T12:25:00+07:00, Claude"
status: "candidate"
superseded_by: null
attributes:
  domain: "zuri-command-agent"
  scope: "SmartGift price-list calculation (local, offline)"
  governance: "not yet promoted — requires GoVibe review before any customer-facing use"
---

# SmartGift Pricing Engine

Turns a factory quote plus carton facts into the quantity-break price list SmartGift publishes to
customers. It replaces a manual Excel step that had become a bottleneck.

**Status: candidate.** The freight rate card, the ladder shape, and the markup are all traced to source
documents and fitted against real data. What remains open is listed in §7 — chiefly that the
published price list was never formula-generated, so no model reproduces it exactly.

## 1. Scope and position in the runtime

`price quote` is a **local calculation**. It reads no tenant data, opens no DuckDB query, creates
no Zuri command, and delivers nothing. It therefore needs no lease, policy snapshot, or capability
grant, and sits outside the `ADMITTED → … → DELIVERED` lifecycle in `AGENT-RUNTIME-SPEC.md`.

If price output is ever put on a Flex card or sent to a LINE group, that delivery path goes through
the normal Zuri command lifecycle and needs its own template approval. This module does not.

## 2. Cost model

```
landed unit cost  =  factory cost (RMB × FX)
                  +  freight per unit
                  +  per-unit additions (logo screening, gift box, bag, domestic delivery)
```

**Factory cost is in RMB, and it is recoverable exactly.** The Shenzhen Zhimei catalogs show an
"EXW Unit Price (USD/Set)" column, but every cell in it is a live formula of the form `32/6.5` —
so both the RMB price and the 6.5 RMB/USD rate the factory used can be read straight out of the
cell. Reading the displayed USD value instead would lose that. 1,088 SKUs across the two catalogs
carry a recoverable RMB cost.

Per-order costs (sample, artwork/plate setup, customs paperwork) are held separately because the
profit floor in §6 divides them across the order while per-unit costs scale with it.

### 2.1 Freight

Freight is **not** a flat per-carton figure. The LK rate card prices on four axes:

| Axis | Values |
|---|---|
| Warehouse | กวางโจว/เซินเจิ้น · อี้อู |
| Mode | ทางรถ (truck) · ทางเรือ (sea) |
| Membership tier | ELITE · GOLD · SILVER · MEMBER |
| Goods class | ทั่วไป · Electronic มอก. · Cosmetic อย. · อื่นๆ |

**SmartGift's account is Guangzhou warehouse at SILVER tier** (confirmed by the owner 2026-08-11),
so the working cells are:

| Goods class | Truck | Sea |
|---|---|---|
| Electronic มอก. | 7,400 / 19 | 5,400 / 14 |
| ทั่วไป | 6,900 / 18 | 4,900 / 13 |

The owner also confirms the goods are light, so freight is volume-charged in practice.

Each cell gives a THB/CBM rate and a THB/kg rate. Which one applies is decided by density:

```
cartons      = ceil(quantity / units per carton)
volume       = cartons × max(carton CBM, 0.01)      # 0.01 CBM per-package minimum
weight       = cartons × carton weight
density      = carton weight / carton CBM           # true dimensions, not the billable minimum

density < 400 kg/CBM  →  charge volume × THB/CBM
density ≥ 400 kg/CBM  →  charge weight × THB/kg
```

Cartons are indivisible, so freight per unit is quantity-dependent: 10 units out of a 50-unit
carton pay for the whole carton. Each quantity break therefore carries its own landed cost.

**Carton weight is almost never available.** Of 1,017 gift-set SKUs, exactly one states a carton
weight; the rest give only `"20 sets/ctn, 47.5*45.5*51cm"`. Weight is therefore optional, and when
it is missing the shipment is charged on volume — correct for gift goods, since a 0.11 CBM carton
of twenty sets would have to weigh 44 kg to flip. The quote reports the assumption and the exact
weight that would change it, so it stays checkable rather than silent.

Carton dimensions are present for 316 of the 1,017 SKUs — the newer blocks (TJS, TTB, TFS, TED,
FXD). The older gift-set blocks (TSQ, TDR, TDS, TBG, TCZ …) have no packing line at all.

### 2.2 Mode and goods-class routing

Confirmed by the owner 2026-08-11, and applied automatically when `mode` is `auto`:

1. **Sep–Jan selling season → everything by truck.** Customers are rushing; sea is too slow.
2. **Off season → sea for shipments over 5 CBM**, truck below.
3. **A box with nothing electrical in it takes the ทั่วไป rate**, not Electronic มอก. Previously
   every SKU was shipped on the มอก. rate regardless of contents.

Rule 2 keys off shipment volume, so the mode can differ between quantity breaks of the same quote.
The resolved mode and the reason are reported per break, and a quote whose breaks do not all agree
raises a warning — a sea break is cheaper but slower, and that is a lead-time question for the
customer rather than a silent optimisation.

In practice rule 2 rarely fires on gift sets: at 20 sets per 0.11 CBM carton, 5 CBM is about 920
sets, above the top published break. It matters for bulk orders quoted outside the ladder.

Rule 3 is worth **500 THB/CBM** — a 6.8% cut in freight per unit on non-electrical sets, or about
1,380 THB per 500-set order at the carton sizes in the catalog.

**The saving is kept as margin, not passed to the customer** (owner's decision, 2026-08-11). On the
standard profile this needs no mechanism: the markup is applied to factory cost, so a cheaper
freight rate leaves the published price untouched and drops straight through to margin. Measured
across the costed catalog — electrical content inferred from the product description, so the split
is an estimate:

| | |
|---|---|
| Non-electrical SKUs | 52 of 316 (16%) |
| Saving per unit | 4.76 THB average |
| Per 500-set order | ~2,380 THB average |
| Published prices that moved | **0** |

**The corporate profile needed a change to match.** Its price is cost-plus, so a lower freight cost
would mechanically have lowered the price — 820 → 810 THB — handing the saving to the customer. The
multiple was therefore recalibrated from the 1.45 midpoint to **1.47** (owner's decision), since
1.4–1.5× was set while every SKU paid the มอก. rate. The price now holds across freight classes and
the saving lands in margin, exactly as it does on the standard profile:

| Freight class | Landed | Price | Profit on 1,000 sets | Margin |
|---|---|---|---|---|
| Electronic มอก. | 563.51 | **830** | 266,486 | 32.1% |
| ทั่วไป | 558.21 | **830** | 271,791 | 32.8% |

One side effect worth knowing: 1.47 is slightly above the multiple that would have held the price
exactly (1.464), and rounding up to the nearest 10 THB carries it over a step. The base price rises
from 820 to 830 — 1.2% — on every corporate quote, not only the non-electrical ones. Still inside
the segment's 800–1,000 THB band.

## 3. Two profiles, because there are two businesses

The owner's first note is that different products are priced by different formulas. That is not a
detail — it is the shape of the whole model. Two profiles, chosen per deal:

| | `standard` | `corporate` |
|---|---|---|
| Customer | Small companies, freelance insurance agents, brokers | State enterprises, กสทช., ไทยคม, large corporates |
| Breaks | 10 / 20 / 50 / 100 / 300 / 500 / 1000 | 100 / 300 / 500 / 1000 |
| Pricing | Cost-band markup + quantity ladder (§4, §5) | Flat **1.47× landed cost**, no ladder |
| Typical price | Whatever the ladder gives | Fixed 800–1,000 THB price point |
| Won on | Price range | A new product nobody else has |

**The two contradict each other, deliberately.** On a 625 THB set the ladder gives 1,540 THB at 500
sets (418k profit); the volume multiple gives about 920 THB at 1,000 sets (209k profit) — half
as much. Both cannot be the rule for one product, so they are separate profiles rather than one
model with an exception. Mixing them is a real error, and the engine warns whenever a larger order
would earn less than a smaller one.

The corporate multiple is on **landed** cost, not factory cost. That follows from the owner's own
figures: a set selling at 800–1,000 THB on a 1.4–1.5× multiple must cost 550–700 THB all-in, which
is an 80–100 RMB product once freight, screening, box and domestic delivery are counted. On factory
cost alone the arithmetic cannot reach that price point. Worked example — 85 RMB, 60 THB of
screening and packaging, in-season truck freight:

```
landed 563 THB  ->  820 THB per set at every break
   100 sets   20,656 THB profit   25.2% margin
 1,000 sets  251,486 THB profit   30.7% margin
```

That lands inside the stated 800–1,000 THB price point, and profit rises with volume as it should.

## 4. The quantity ladder (standard profile)

The published price lists use breaks **10 / 20 / 50 / 100 / 500** and a fixed percentage ladder off
the 10-set price:

| Break | 10 | 20 | 50 | 100 | 500 |
|---|---|---|---|---|---|
| Factor | 1.00 | 0.90 | 0.85 | 0.80 | 0.75 |

Fitted against `03.ตัวอย่างใบราคาส่งให้ลูกค้า.pdf` (published THB, factor-implied in brackets):

| SKU | 10 | 20 | 50 | 100 | 500 |
|---|---|---|---|---|---|
| TTT02-3 | 1180 | 1060 *(1062)* | 1000 *(1003)* | 950 *(944)* | 890 *(885)* |
| TSPB2-2 | 2340 | 2100 *(2106)* | 1990 *(1989)* | 1880 *(1872)* | 1760 *(1755)* |
| TAB01-1 | 630 | 570 *(567)* | 540 *(535)* | 510 *(504)* | 480 *(472)* |

Worst deviation is under 2%. Regressing the 10-set and 500-set prices independently across 43
matched SKUs gives a slope ratio of **1.3246** against the ladder's implied 1/0.75 = 1.3333, so the
shape holds across the catalog rather than only on the three rows above.

**Known non-fits.** Two older single-item sheets discount far more steeply at the 20-set break —
TS0212 skip rope (590 → 480, a 19% step where the ladder predicts 10%) and TZ0110 nail clipper
(870 → 690). They follow an earlier convention and are not covered by this ladder.

**USB Flash Drive** uses different breaks entirely (50 / 100 / 500 / 1000). The breaks are recorded
in `policy.ts`; the ladder shape has not been fitted and no USB policy is claimed.

**300 and 1,000 were added on the owner's instruction** (2026-08-11) because real orders land there.
Neither appears on any published sheet, so neither factor is fitted: 300 is interpolated
log-linearly between 100 (0.80) and 500 (0.75) to give **0.77**, and 1,000 is extrapolated to
**0.73**. Both should be replaced with real figures once a sheet carrying them exists.

The stated minimum order target is **100 sets**. The 10- and 20-set breaks are kept because that is
what small companies and freelance insurance agents actually buy — and it is exactly where the
profit floor in §6 does its work.

The anchor is the **largest** break, matching the customer sheet's own statement that its list price
is "based on more than 500 pcs". Ladder factors are configured relative to the first break because
that is how they read on the sheet; the engine normalises against the anchor internally.

## 5. Markup

Fitted from **43 SKUs present in both the factory catalog and the customer price list**, matched on
item code and on the product description reading identically in both.

**The markup is not one number — it falls as the item gets dearer.** Across the matched set the
observed multiple on factory cost runs from 3.27× at the cheap end to 1.71× at the dear end, and
the trend is monotonic. Band medians (thresholds are factory cost in THB at FX 5.0):

| Factory cost | ≈ RMB | n | Median | Observed range |
|---|---|---|---|---|
| ≤ 250 THB | ≤ 50 | 5 | **3.00×** | 2.85 – 3.27 |
| ≤ 350 THB | ≤ 70 | 16 | **2.73×** | 2.44 – 3.03 |
| ≤ 500 THB | ≤ 100 | 13 | **2.62×** | 2.37 – 2.88 |
| ≤ 650 THB | ≤ 130 | 2 | **2.45×** | 2.41 – 2.48 |
| > 650 THB | > 130 | 7 | **2.14×** | 1.71 – 2.27 |

Reproduction of published 500-set prices: **4.64% mean absolute error**, against **14.74%** for a
single 2.30×. The 100–130 RMB band rests on two observations and is the weakest of the five.

### 5.1 Neither figure in the original brief is right

The brief gave "Markup 80%" and "2.2–2.3 เท่า" as if they were the same thing; they are not (2.3× is
a 130% markup). Against the data:

- **1.8× (80% markup)** matches only the most expensive SKUs, and undercuts the cheap end by half.
- **2.3×** matches roughly the 110–140 RMB band and undercuts everything below it.

Neither is wrong so much as incomplete — each is one row of the table above.

### 5.2 There is no exact formula to recover

Three models were fitted against the 43 matched SKUs:

| Model | Mean abs. error | Max |
|---|---|---|
| Constant multiple of RMB | 8.63% | 23.0% |
| Linear with intercept | 5.03% | 12.1% |
| Power law `33.5 × RMB^0.783` | 4.34% | 10.8% |

None gets near measurement error, and the linear model's intercept implies 202 THB of freight per
unit — roughly seven times what the rate card actually gives for these cartons. The conclusion is
that **the published list was priced SKU by SKU with judgment**, tracking cost only loosely. The
band table is a faithful summary of that judgment, not a rule that was ever applied.

### 5.3 Markup basis

The observed multiples were taken over **factory cost alone**, with freight absorbed inside them.
Applying them to a landed cost would count freight twice, so `markupBasis` defaults to
`factory_cost`. `landed_cost` is available for cost-plus pricing where carton data is known.

Either way the minimum-profit floor below uses the **real** landed cost, so freight can never be
priced out of a deal regardless of which basis is chosen.

## 6. Minimum profit floor

The floor is **by order size**, not one number (confirmed 2026-08-11):

| Order size | Minimum gross profit |
|---|---|
| 10–20 sets | **5,000 THB** |
| Above 20 sets | **3,000 THB** |

The higher bar on small orders is deliberate: a 10-set order for a freelance insurance agent costs
about as much to service as a 500-set one, so it has to clear more to be worth taking. At each
break:

```
ladder price  =  anchor price × (factor at break / factor at anchor)
floor price   =  landed unit cost + (floor for this size + per-order costs) / quantity
published     =  roundUp(max(ladder, floor), 10 THB)
```

The floor only binds where the ladder falls short — small quantities on low-cost SKUs — so the
volume breaks the sales team quotes today do not move.

Rounding is always **up**. Rounding to nearest would let a price that was just raised to satisfy the
floor fall back below it.

Approved by the owner 2026-08-11: small-quantity prices are allowed to rise.

### 6.1 Measured impact on the current catalog

The floor was run against all **316 SKUs** that have both a recovered RMB cost and packing data,
priced in-season on the Electronic มอก. truck rate:

| Break | SKUs raised | Median increase |
|---|---|---|
| 10 sets | **37 of 316** (12%) | +17% (max +91%) |
| 20 sets | 1 of 316 | +19% |
| 50 sets and above | 0 of 316 | — |

It binds only below roughly **36 RMB** of factory cost, and only at the smallest break. Above that
the fitted markup already clears 5,000 THB on its own. Largest moves:

```
TJS05-2    17.0 RMB   340 -> 650 THB  (+91%)
BW16-2     23.5 RMB   470 -> 700 THB  (+49%)
TJS30-2    24.0 RMB   480 -> 710 THB  (+48%)
```

The practical reading: this is a guard rail on small orders of cheap items, not a repricing of the
catalog. Nothing at 50 sets or more moves at all. Note that raising the floor from 3,000 to 5,000
took the affected SKU count from 3 to 37 — the 10-set break is where the whole policy lives, so
that number is worth re-checking whenever the floor changes.

### 6.2 What "gross" excludes

The 3,000 THB figure is gross profit over supplied costs. It does **not** account for VAT, import
duty, payment-processing fees, or any cost the caller did not pass in. A quote built with no
per-unit or per-order additions emits a warning saying so, because the profit shown will be higher
than the real one.

### 6.3 Guards

- **Monotonicity.** A larger order must never carry a higher unit price. Carton rounding makes a
  violation possible in principle, so it is checked and warned on rather than assumed away.
- **Ladder length.** Factors must be one-per-break and breaks strictly ascending; both are rejected
  at parse time.
- **Zero quantity.** Breaks are positive integers by schema, so the `3000 / Q` division cannot
  divide by zero.

## 7. Open items before promotion

1. **The exchange rate is a caller input with no default.** The band thresholds in §5 were fitted at
   5.0 THB/RMB. A materially different FX shifts SKUs across band boundaries; the bands should be
   re-fitted rather than the thresholds rescaled by eye.
2. **Carton data covers 316 of 1,017 SKUs, weight covers 1.** Quotes for the older blocks need
   packing figures from the factory before freight is anything but an assumption.
3. **The 100–130 RMB band rests on two observations.** Widen it as more SKUs are matched.
4. **Rate-card currency.** Rates were photographed 2026-07-27 and are contractual with the
   forwarder. Re-confirm before quoting large orders.
5. **Only the gift-set catalog is covered.** The Power bank / notebook catalog (71 SKUs) has costs
   but no packing lines, and the USB Flash Drive costs are in a legacy `.xls` that has not been
   parsed. Neither has a fitted ladder.

## 8. Usage

```bash
zuri-agent price quote --sku TJS23-2 --rmb 32 --fx 5 --units-per-carton 20 --carton-cbm 0.1102 \n  --ship-month 11 --no-electronics
```

Required: `--sku --rmb --fx --units-per-carton --carton-cbm`.
Optional: `--profile --carton-kg --no-electronics --ship-month --mode --warehouse --tier --class
--unit-cost --order-cost --markup --markup-basis --min-profit --round-to`.

`--profile corporate` switches to the flat 1.47x landed-cost profile for enterprise volume deals.
Supply `--unit-cost` with it: on that profile the multiple is applied to landed cost, so leaving
screening and packaging out understates the price.

`--warehouse` and `--tier` default to SmartGift's own LK account and rarely need setting.

`--carton-cbm` is the catalog's packing dimensions in cm, multiplied out and divided by 1,000,000:
`"20 sets/ctn, 47.5*45.5*51cm"` → `--units-per-carton 20 --carton-cbm 0.1102`.

Sanity check on that SKU: 32 RMB lands at 480 THB per set at 500 sets. TBX-1-2, a comparable
umbrella-plus-accessory set costing 30 RMB, is published at 490.

Output is the standard CLI JSON envelope. Every quote carries the freight rate card's source and
`as_of`, the basis (`ladder` or `min_profit_floor`) for each break, and the unrounded ladder and
floor prices so any published number can be re-derived by hand.

## 9. Source documents

- `Google Drive · SmartGift/ค่าขนส่งจีน-ไทย/LK-กวางโจว.jpg`, `LK-อี้อู.jpg` — freight rate cards
- `Google Drive · SmartGift/01-ต้นทุน-BusinessGiftSet/02-ตัวอย่างใบราคาแยกแต่ละสินค้า-ส่งลูกค้า/03.ตัวอย่างใบราคาส่งให้ลูกค้า.pdf` — ladder fit, published prices
- `Google Drive · SmartGift/01-ต้นทุน-BusinessGiftSet/01-ต้นทุน-20260612 Business Office Gift set catalog.xlsx` — factory RMB costs (1,017 SKUs) and packing (316)
- `Google Drive · SmartGift/02.ต้นทุน-PowerBank Notebook/02-ต้นทุน-20260417 Power bank notebook catalog.xlsx` — factory RMB costs (71 SKUs)
- `D:\workspace\zuri-command-agent\src\pricing\` — implementation
- `D:\workspace\zuri-command-agent\tests\unit\pricing.test.ts` — behaviour

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 0.1.0b | 2026-08-11 | draft | Freight rate card, published ladder, and minimum-profit floor | Claude |
| 0.1.1b | 2026-08-11 | draft | Markup fitted from 43 matched SKUs: cost-band table replaces the single 2.3× guess; carton weight made optional | Claude |
| 0.1.2b | 2026-08-11 | draft | Owner-confirmed LK account (Guangzhou/SILVER); seasonal truck-sea routing and goods-class rules | Claude |
| 0.1.3b | 2026-08-11 | candidate | Owner approved the 3,000 THB floor; impact measured across 316 costed SKUs | Claude |
| 0.2.0b | 2026-08-11 | candidate | Split standard and corporate profiles; 300/1000 breaks; profit floor by order size (5,000 / 3,000) | Claude |
| 0.2.1b | 2026-08-11 | candidate | Freight-class saving kept as margin; measured across the costed catalog | Claude |
| 0.2.2b | 2026-08-11 | candidate | Corporate multiple recalibrated 1.45 -> 1.47 so the freight saving becomes margin there too | Claude |
