import { PricingPolicy, Provenance } from './types.js';

/**
 * The published SmartGift gift-set ladder.
 *
 * `ladderFactors` are stated relative to the *first* break because that is how they were fitted
 * from the customer price lists, and how a person reading the sheet sees them: each step down is a
 * round percentage off the 10-set price. The engine normalises them against the anchor (the last
 * break) before use, so the anchor's own factor cancels out.
 *
 * Fit quality against `03.ตัวอย่างใบราคาส่งให้ลูกค้า.pdf` (published THB vs. factor-implied):
 *
 *   TTT02-3            1180 · 1060 (1062) · 1000 (1003) · 950 (944) · 890 (885)
 *   TSPB2-2 powerbank  2340 · 2100 (2106) · 1990 (1989) · 1880 (1872) · 1760 (1755)
 *   TAB01-1 flask       630 ·  570  (567) ·  540  (535) ·  510 (504) ·  480 (472)
 *
 * Worst deviation across those rows is under 2%. Independently, regressing the 10-set and 500-set
 * prices across 43 matched SKUs gives a slope ratio of 1.3246 against the ladder's 1.3333 — the
 * ladder shape holds across the whole catalog, not just the three rows above.
 *
 * Two older single-item sheets (TS0212 skip rope, TZ0110 nail clipper) discount far more steeply
 * at the 20-set break and do not fit this ladder — they follow an earlier convention.
 */
export const GIFTSET_LADDER_PROVENANCE: Provenance = {
  source:
    'Google Drive · SmartGift/01-ต้นทุน-BusinessGiftSet/02-ตัวอย่างใบราคาแยกแต่ละสินค้า-ส่งลูกค้า/' +
    '03.ตัวอย่างใบราคาส่งให้ลูกค้า.pdf',
  asOf: '2023-06-13',
};

/**
 * Markup provenance: fitted from 43 SKUs present in BOTH the Shenzhen Zhimei factory catalog and
 * the customer price list, matched on item code and on the product description appearing
 * identically in both.
 *
 * Factory cost was recovered exactly, not estimated: the catalog's USD column is a live formula of
 * the form `32/6.5`, so the RMB figure and the 6.5 RMB/USD rate the factory used are both readable
 * from the cell.
 */
export const MARKUP_PROVENANCE: Provenance = {
  source:
    'Google Drive · SmartGift/01-ต้นทุน-BusinessGiftSet/01-ต้นทุน-20260612 Business Office Gift set catalog.xlsx ' +
    '(EXW formulas) joined to 03.ตัวอย่างใบราคาส่งให้ลูกค้า.pdf (published 500-set prices)',
  asOf: '2026-06-12',
  note:
    'Fitted over 43 matched SKUs at FX 5.0 THB/RMB. Band medians reproduce published 500-set ' +
    'prices with 4.6% mean absolute error. The published list is not formula-generated — it was ' +
    'priced SKU by SKU — so no band will reproduce it exactly.',
};

/**
 * Markup falls as the item gets dearer. This is the single most important finding from the cost
 * data, and it is why a one-number markup cannot work: across the 43 matched SKUs the observed
 * multiple on factory cost runs from 3.27x at the cheap end to 1.71x at the dear end.
 *
 * Band medians (thresholds are factory cost in THB at FX 5.0, i.e. RMB x 5):
 *
 *   ≤ 250 THB   (≤ 50 RMB)    n=5    median 3.00x   range 2.85–3.27
 *   ≤ 350 THB   (≤ 70 RMB)    n=16   median 2.73x   range 2.44–3.03
 *   ≤ 500 THB   (≤ 100 RMB)   n=13   median 2.62x   range 2.37–2.88
 *   ≤ 650 THB   (≤ 130 RMB)   n=2    median 2.45x   range 2.41–2.48
 *   > 650 THB   (> 130 RMB)   n=7    median 2.14x   range 1.71–2.27
 *
 * Reproduction error against published 500-set prices: 4.64% mean, versus 14.74% for a single
 * 2.30x. The 100–130 RMB band rests on only two observations and is the weakest of the five.
 */
export const DEFAULT_MARKUP_BANDS = [
  { maxBasisCostThb: 250, factor: 3.0 },
  { maxBasisCostThb: 350, factor: 2.73 },
  { maxBasisCostThb: 500, factor: 2.62 },
  { maxBasisCostThb: 650, factor: 2.45 },
  { maxBasisCostThb: Infinity, factor: 2.14 },
];

/**
 * Volume deals are not priced off the ladder. The owner negotiates them against a markup they will
 * accept: **1.4–1.5x cost at 1,000 sets** (confirmed 2026-08-11), for the 800–1,000 THB corporate
 * segment — state enterprises, กสทช., ไทยคม and the like, where one order can be 5M THB in a month.
 *
 * The multiple is applied to **landed** cost: at 1.4–1.5x, a set selling at the segment's
 * 800–1,000 THB price point must cost 550–700 THB all-in, which is a 80–100 RMB product once
 * freight, screening, box and domestic delivery are counted. On factory cost alone the arithmetic
 * does not reach that price point.
 *
 * **1.47, not the 1.45 midpoint** (owner's decision, 2026-08-11). The 1.4–1.5x range was set while
 * every SKU shipped on the Electronic มอก. freight rate. Now that a box with nothing electrical in
 * it takes the cheaper ทั่วไป rate, a cost-plus multiple would hand that saving to the customer —
 * the opposite of the decision to keep it as margin. Raising the multiple holds the price where it
 * was and lets the freight saving fall to margin, matching how the standard profile already
 * behaves.
 *
 * This multiple **cannot coexist with the fitted ladder** — see `CORPORATE_VOLUME_POLICY`. It is
 * offered as a separate profile, not as an override inside the standard ladder, because the owner's
 * own first note says different products are priced by different formulas.
 */
export const CORPORATE_VOLUME_MARKUP = 1.47;

/**
 * Minimum gross profit per order, by order size. Confirmed 2026-08-11:
 *
 * - **10–20 sets → 5,000 THB.** Small companies and freelance insurance agents buying 800–1,000 THB
 *   sets. An order this size costs about as much to service as a large one, so it has to clear a
 *   higher bar to be worth taking.
 * - **Above 20 sets → 3,000 THB.** The original guard rail, which in practice almost never binds.
 */
export const DEFAULT_PROFIT_FLOORS = [
  { maxQuantity: 20, minOrderGrossProfitThb: 5000 },
  { maxQuantity: Infinity, minOrderGrossProfitThb: 3000 },
];

/**
 * Default policy: the published ladder and fitted markup, with volume deals and the minimum-profit
 * rule layered on. The ladder still decides the price wherever it clears the floor and no override
 * applies, so the quantities the sales team quotes today do not move.
 *
 * The **300-set factor of 0.77 is interpolated, not fitted** — the published sheets have no 300
 * break. It sits log-linearly between 100 (0.80) and 500 (0.75). The 1,000-set factor is a
 * placeholder that the volume override normally supersedes.
 */
export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  quantityBreaks: [10, 20, 50, 100, 300, 500, 1000],
  ladderFactors: [1.0, 0.9, 0.85, 0.8, 0.77, 0.75, 0.73],
  anchorQuantity: 500,
  markupBasis: 'factory_cost',
  markupBands: DEFAULT_MARKUP_BANDS,
  volumeMarkupOverrides: [],
  profitFloors: DEFAULT_PROFIT_FLOORS,
  roundingStepThb: 10,
};

/**
 * The corporate volume profile: state enterprises, กสทช., ไทยคม and large companies buying
 * 300–1,000 sets at a fixed 800–1,000 THB price point, where a single month can carry 5M THB of
 * sales. These deals are won on a new product nobody else has, at a thin multiple.
 *
 * It is a **separate profile** because the volume multiple and the catalog ladder contradict each
 * other. On a 625 THB set the ladder gives 1,540 THB at 500 sets (418k profit); the volume
 * multiple gives roughly 920 THB at 1,000 sets (209k profit) — a bigger order earning half as
 * much. Both cannot be the rule for one product. Pick the profile that matches the deal.
 *
 * **The profile still steps down by quantity** (owner, 2026-08-11) — it is not one flat price. The
 * ladder factors below are the same shape as the standard profile at the same breaks; what differs
 * is the multiple the ladder is anchored on, and that the anchor is the 1,000-set break rather
 * than 500.
 */
export const CORPORATE_VOLUME_POLICY: PricingPolicy = {
  quantityBreaks: [100, 300, 500, 1000],
  ladderFactors: [0.8, 0.77, 0.75, 0.73],
  anchorQuantity: 1000,
  markupBasis: 'landed_cost',
  pricingReferenceGoodsClass: 'electronic_tisi',
  markupBands: [{ maxBasisCostThb: Infinity, factor: CORPORATE_VOLUME_MARKUP }],
  volumeMarkupOverrides: [],
  profitFloors: DEFAULT_PROFIT_FLOORS,
  roundingStepThb: 10,
};

export const PRICING_PROFILES = {
  standard: DEFAULT_PRICING_POLICY,
  corporate: CORPORATE_VOLUME_POLICY,
} as const;

export type PricingProfile = keyof typeof PRICING_PROFILES;

/** The minimum gross profit an order of this size has to clear. */
export function profitFloorFor(quantity: number, policy: PricingPolicy): number {
  const floor = policy.profitFloors.find((f) => quantity <= f.maxQuantity);
  // The schema requires the last floor to end at Infinity, so this cannot miss.
  return floor
    ? floor.minOrderGrossProfitThb
    : policy.profitFloors[policy.profitFloors.length - 1].minOrderGrossProfitThb;
}

/**
 * USB Flash Drive quotes use different breaks (see `ตัวอย่างใบราคาแฟลชไดร์ฟ - 4 ตค 67.pdf`). The
 * ladder shape there has not been fitted, so this exposes the breaks only; it is not a policy.
 */
export const USB_QUANTITY_BREAKS = [50, 100, 500, 1000] as const;

/** The markup multiple for a given basis cost. */
export function markupFactorFor(basisCostThb: number, policy: PricingPolicy): number {
  const band = policy.markupBands.find((b) => basisCostThb <= b.maxBasisCostThb);
  // The schema requires the last band to end at Infinity, so this cannot miss.
  return band ? band.factor : policy.markupBands[policy.markupBands.length - 1].factor;
}
