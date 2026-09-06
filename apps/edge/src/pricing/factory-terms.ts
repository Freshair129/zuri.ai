import { LogoMethod, LogoSpec, Provenance, SmallOrderFactor } from './types.js';

/**
 * Terms printed at the foot of the Shenzhen Zhimei catalogs, plus the screening conventions the
 * owner confirmed. These are the factory's rules, not SmartGift policy — they change only when
 * the factory reissues a catalog.
 */
export const FACTORY_TERMS_PROVENANCE: Provenance = {
  source:
    'Google Drive · SmartGift/01-ต้นทุน-BusinessGiftSet/01-ต้นทุน-20260612 Business Office Gift set catalog.xlsx ' +
    '(Note block, rows 5938–5951); screening conventions confirmed by the owner 2026-08-11',
  asOf: '2026-06-12',
  note: 'Logo charges are quoted in USD. EXW Shantou, excluding transport, testing and tax.',
};

/**
 * "Price is based on ≥500 sets, small quantity order is acceptable with 1.1 - 1.5 times price."
 *
 * The catalog's EXW price is a 500-set price. Below that the factory charges a premium, and the
 * note gives only the range — not which quantity attracts which multiple. The schedule below
 * spans the stated 1.1–1.5 monotonically and is **an assumption pending confirmation**, which is
 * why any quote that lands on a factor above 1.0 says so.
 *
 * It matters most exactly where it is least visible: at ten sets a 1.5x factory cost moves landed
 * cost by half, and that is the break where the minimum-profit floor decides the price.
 */
export const SMALL_ORDER_COST_FACTORS: SmallOrderFactor[] = [
  { maxQuantity: 20, factor: 1.5 },
  { maxQuantity: 50, factor: 1.4 },
  { maxQuantity: 100, factor: 1.3 },
  { maxQuantity: 300, factor: 1.2 },
  { maxQuantity: 499, factor: 1.1 },
  { maxQuantity: Infinity, factor: 1.0 },
];

export function smallOrderFactorFor(quantity: number, schedule: SmallOrderFactor[]): number {
  const band = schedule.find((b) => quantity <= b.maxQuantity);
  return band ? band.factor : 1;
}

/**
 * How many places a logo goes on one set.
 *
 * The last digit of an item code is the number of components in the set — TTT02-**3** is umbrella
 * plus flask plus glass cup, TDR0--**5** is a five-piece kettle set, TCZ003**6** is six. Every
 * component takes a logo, and so do the gift box and the bag, which is the "+2" and matches the
 * published price lists promising "ชุดกล่องของขวัญและถุงพร้อมสกรีน".
 *
 * Codes ending in 0 are single stock items rather than sets, so they count as one component.
 * The result is a starting point, not a fact about the order — callers should let a person
 * override it.
 */
export const GIFT_PACKAGING_POSITIONS = 2;

export function screenPositionsForItemCode(code: string): number {
  const last = /(\d)\s*$/.exec(code || '');
  const components = last ? Number(last[1]) : 1;
  return (components === 0 ? 1 : components) + GIFT_PACKAGING_POSITIONS;
}

/**
 * Logo charge for the whole order, in USD.
 *
 * Every schedule below is quoted by the factory per position and, for silk, per colour — so a
 * seven-piece set with a box and a bag pays its mould fee nine times, not once. That multiplier
 * is the single largest thing missing from a naive cost sheet.
 *
 * `flat` is priced in THB, not USD, and is handled by `logoCostThb`.
 */
export function logoCostUsd(spec: LogoSpec, quantity: number): number {
  const positions = Math.max(1, spec.positions);
  const colors = Math.max(1, spec.colors);

  switch (spec.method) {
    case 'none':
    case 'flat':
      return 0;

    // "Name or short letters deboss charge: $4.84" — flat, no mould, no per-piece rate.
    case 'hotstamp_text':
      return 4.84 * positions;

    /*
     * "One logo one position one mold, 1-100 pcs, charge is $11.3; 101-499 pcs, charge is
     *  $11.3 + (quantity-100)*$0.081/pc; 500-999 pcs, $11.3 + (quantity-100)*$0.065/pc;
     *  >1000 pcs, $11.3 + (quantity-100)*$0.048/pc."
     * The mould fee covers the first hundred pieces outright.
     */
    case 'hotstamp': {
      const mould = 11.3;
      const over = Math.max(0, quantity - 100);
      const perPc = quantity <= 100 ? 0 : quantity <= 499 ? 0.081 : quantity <= 999 ? 0.065 : 0.048;
      return (mould + over * perPc) * positions;
    }

    /*
     * "No logo mold fee … <9 pcs, cost is $0.17/pc; 10-99 pcs, $0.081/pc; 100-299 pcs, $0.05/pc;
     *  300-499 pcs, $0.035/pc; >500 pcs, $0.02/pc."
     * The note skips 9 and 500 exactly; each is folded into the cheaper neighbouring band so no
     * quantity is left without a rate.
     */
    case 'engrave': {
      const perPc =
        quantity <= 9
          ? 0.17
          : quantity <= 99
            ? 0.081
            : quantity <= 299
              ? 0.05
              : quantity <= 499
                ? 0.035
                : 0.02;
      return quantity * perPc * positions;
    }

    /*
     * "1 color one position one mold, 1-350 pcs, charge is $13, ≥351 pcs, charge is $0.04/pc."
     * A separate mould per colour and per position, which is what makes silk expensive on a
     * multi-piece set.
     */
    case 'silk': {
      const perMould = quantity <= 350 ? 13 : quantity * 0.04;
      return perMould * positions * colors;
    }

    /*
     * UV printing: unlimited colours and no mould fee, which is why it suits small orders. The
     * catalog says "Color printing: Please check cost with sales", so there is no published rate
     * — the caller supplies one and the quote says when it is still zero.
     */
    case 'uv':
      return quantity * positions * (spec.uvRatePerPieceUsd ?? 0);
  }
}

/**
 * Total logo charge for the order, in THB.
 *
 * The house method bills a flat rate per position per piece, so it scales cleanly with quantity.
 * The factory schedules do not — a mould fee is paid once per position no matter how many pieces
 * follow — which is why the two are computed separately and only the total is comparable.
 */
export function logoCostThb(spec: LogoSpec, quantity: number, usdToThb: number): number {
  if (spec.method === 'flat') {
    return quantity * Math.max(1, spec.positions) * spec.flatRatePerPositionThb;
  }
  return logoCostUsd(spec, quantity) * usdToThb;
}

/** Methods that carry no published rate and need a figure from the factory before quoting. */
export function logoMethodNeedsRate(method: LogoMethod): boolean {
  return method === 'uv';
}
