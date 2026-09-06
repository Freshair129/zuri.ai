import {
  FACTORY_TERMS_PROVENANCE,
  SMALL_ORDER_COST_FACTORS,
  logoCostThb,
  logoMethodNeedsRate,
  smallOrderFactorFor,
} from './factory-terms.js';
import {
  DENSITY_SWITCH_KG_PER_CBM,
  FREIGHT_RATE_PROVENANCE,
  MIN_BILLABLE_CBM_PER_PACKAGE,
  getFreightRate,
  resolveFreightMode,
} from './freight-rates.js';
import { DEFAULT_PRICING_POLICY, markupFactorFor, profitFloorFor } from './policy.js';
import {
  LandedUnitCost,
  PriceBasis,
  PriceBreak,
  PriceQuote,
  PricingInput,
  SmallOrderFactor,
  PricingPolicy,
  ResolvedPricingInput,
  pricingInputSchema,
  pricingPolicySchema,
} from './types.js';

// @req SDD-014 — the pricing engine: SmartGift quote calculation.

/** Round half-up to `decimals` places. Used for money and for the sheet's 2-decimal CBM rule. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Round *up* to a step. Published prices always round up: rounding to nearest would let a price
 * that was just raised to satisfy the minimum-profit floor fall back below it.
 */
export function roundUpTo(value: number, step: number): number {
  // Both operations need a guard: dividing by the step can land at 86.99999... where the true
  // value is 87, and multiplying back can produce 4.3500000000000005 where the price is 4.35.
  return round(Math.ceil(round(value / step, 6)) * step, 6);
}

/**
 * Freight for one shipment of `quantity` units, following the LK sheet's own rules: whole cartons,
 * a 0.01 CBM minimum per package, and a density switch that charges on volume for light goods and
 * on weight for dense ones.
 *
 * Density is computed from the true carton dimensions, not the billable minimum, so a very small
 * carton does not read as artificially dense.
 */
export function calculateFreight(
  input: ResolvedPricingInput,
  quantity: number
): LandedUnitCost['freight'] {
  const { unitsPerCarton, cartonCbm, cartonWeightKg } = input.carton;

  const cartons = Math.ceil(quantity / unitsPerCarton);
  const billableCartonCbm = Math.max(cartonCbm, MIN_BILLABLE_CBM_PER_PACKAGE);
  const volumeCbm = round(cartons * billableCartonCbm, 2);

  /*
   * Carton weight is usually unknown — the factory catalogs state packing dimensions but almost
   * never a weight. Charging on volume is the right default for gift goods (a 0.11 CBM carton of
   * twenty gift sets would have to weigh 44 kg to flip), but the assumption is reported rather
   * than buried, along with the weight that would change the answer.
   */
  const weightKg = cartonWeightKg === undefined ? null : round(cartons * cartonWeightKg, 2);
  const densityKgPerCbm = cartonWeightKg === undefined ? null : cartonWeightKg / cartonCbm;
  const chargedBy =
    densityKgPerCbm !== null && densityKgPerCbm >= DENSITY_SWITCH_KG_PER_CBM ? 'weight' : 'volume';

  // Mode is resolved after the volume is known, since the off-season rule keys off shipment size.
  const { mode, modeReason } =
    input.freight.mode === 'auto'
      ? (() => {
          const r = resolveFreightMode(input.freight.shipMonth as number, volumeCbm);
          return { mode: r.mode, modeReason: r.reason };
        })()
      : { mode: input.freight.mode, modeReason: 'mode pinned by the caller' };

  const rate = getFreightRate(input.freight, mode);
  const orderFreightThb =
    chargedBy === 'weight' && weightKg !== null
      ? weightKg * rate.thbPerKg
      : volumeCbm * rate.thbPerCbm;

  return {
    cartons,
    volumeCbm,
    weightKg,
    densityKgPerCbm: densityKgPerCbm === null ? null : round(densityKgPerCbm, 2),
    mode,
    modeReason,
    chargedBy,
    weightFlipThresholdKg: round(cartonCbm * DENSITY_SWITCH_KG_PER_CBM, 2),
    rate,
    orderFreightThb: round(orderFreightThb, 2),
  };
}

/**
 * Landed cost of one unit at a given order quantity. Freight per unit is quantity-dependent
 * because cartons are indivisible — 10 units out of a 12-unit carton still pay for the whole
 * carton.
 */
export function calculateLandedUnitCost(
  input: ResolvedPricingInput,
  quantity: number,
  smallOrderFactors: SmallOrderFactor[] = SMALL_ORDER_COST_FACTORS
): LandedUnitCost {
  const freight = calculateFreight(input, quantity);
  /*
   * The catalog price is a 500-set price. Ordering fewer costs more per unit at the factory, so
   * the premium has to land here, before markup and before the profit floor reads the cost.
   */
  const smallOrderFactor = smallOrderFactorFor(quantity, smallOrderFactors);
  const factoryCostThb = round(input.factoryCostRmb * input.exchangeRate * smallOrderFactor, 4);
  const freightPerUnitThb = round(freight.orderFreightThb / quantity, 4);

  /*
   * Screening is a per-set cost in the way the sales team thinks about it, so it belongs in landed
   * cost rather than sitting off to the side as an order fee. Under the factory's own schedules a
   * mould is paid once per position, so the per-unit share falls as the order grows — the same
   * shape as freight, and reported the same way.
   */
  const orderLogoThb = logoCostThb(input.logo, quantity, usdRateFor(input));
  const logoPerUnitThb = round(orderLogoThb / quantity, 4);

  /* The rule is 2 RMB per set; the price is in THB. Convert here rather than storing THB. */
  const inlandChinaCostThb = round(input.inlandChinaCostRmb * input.exchangeRate, 4);

  const totalThb = round(
    factoryCostThb +
      inlandChinaCostThb +
      freightPerUnitThb +
      logoPerUnitThb +
      input.additionalUnitCostThb,
    4
  );

  return {
    factoryCostThb,
    smallOrderFactor,
    freightPerUnitThb,
    logoPerUnitThb,
    inlandChinaCostThb,
    orderLogoThb: round(orderLogoThb, 2),
    additionalUnitCostThb: input.additionalUnitCostThb,
    totalThb,
    freight,
  };
}

/** THB per USD for the factory's logo charges — see `usdToThb` on the input. */
export function usdRateFor(input: ResolvedPricingInput): number {
  return input.usdToThb ?? input.exchangeRate * 6.5;
}

/**
 * Build the published price list for one SKU.
 *
 * Two rules run at every break and the higher price wins:
 *
 *   1. **Ladder** — the shape the customer price lists already use. The anchor (largest break) is
 *      priced at landed cost x `anchorMarkupFactor`; smaller breaks step up by the ladder factors.
 *   2. **Minimum-profit floor** — the price at which the order clears
 *      `minOrderGrossProfitThb` after per-order costs.
 *
 * The floor only ever binds at small quantities, so quotes at the volume breaks keep the prices
 * the sales team publishes today.
 */
export function buildPriceQuote(
  rawInput: PricingInput,
  rawPolicy: PricingPolicy = DEFAULT_PRICING_POLICY,
  asOf: string = new Date().toISOString()
): PriceQuote {
  const input = pricingInputSchema.parse(rawInput);
  const policy = pricingPolicySchema.parse(rawPolicy);

  const anchorIndex = policy.quantityBreaks.indexOf(policy.anchorQuantity);
  const anchorQuantity = policy.anchorQuantity;
  const anchorFactor = policy.ladderFactors[anchorIndex];

  const anchorLandedUnitCost = calculateLandedUnitCost(input, anchorQuantity);

  /*
   * The markup may be priced off a reference cost rather than the real one, so that a cheaper
   * freight class widens margin instead of cutting the published price.
   */
  const basisInput: ResolvedPricingInput = policy.pricingReferenceGoodsClass
    ? {
        ...input,
        freight: { ...input.freight, goodsClass: policy.pricingReferenceGoodsClass },
      }
    : input;
  const basisLanded =
    basisInput === input ? anchorLandedUnitCost : calculateLandedUnitCost(basisInput, anchorQuantity);
  const markupBasisCostThb =
    policy.markupBasis === 'landed_cost' ? basisLanded.totalThb : basisLanded.factoryCostThb;
  const markupFactor = markupFactorFor(markupBasisCostThb, policy);
  const anchorPriceThb = markupBasisCostThb * markupFactor;

  const warnings: string[] = [];

  const breaks: PriceBreak[] = policy.quantityBreaks.map((quantity, index) => {
    const landed = calculateLandedUnitCost(input, quantity);

    /*
     * A volume deal is negotiated against a target markup, not stepped down from the published
     * sheet, so an override replaces the ladder outright at that break rather than adjusting it.
     */
    const breakLandedForBasis =
      basisInput === input ? landed : calculateLandedUnitCost(basisInput, quantity);
    const breakBasisCostThb =
      policy.markupBasis === 'landed_cost'
        ? breakLandedForBasis.totalThb
        : breakLandedForBasis.factoryCostThb;
    const override = policy.volumeMarkupOverrides.find(
      (o) => o.quantity === quantity && breakBasisCostThb >= o.minBasisCostThb
    );
    const ladderPriceThb = override
      ? breakBasisCostThb * override.markupFactor
      : anchorPriceThb * (policy.ladderFactors[index] / anchorFactor);

    const minOrderGrossProfitThb = profitFloorFor(quantity, policy);
    const floorPriceThb =
      landed.totalThb + (minOrderGrossProfitThb + input.additionalOrderCostThb) / quantity;

    const basis: PriceBasis =
      floorPriceThb > ladderPriceThb ? 'min_profit_floor' : override ? 'volume_markup' : 'ladder';
    const unitPriceThb = roundUpTo(Math.max(ladderPriceThb, floorPriceThb), policy.roundingStepThb);

    const orderGrossProfitThb =
      (unitPriceThb - landed.totalThb) * quantity - input.additionalOrderCostThb;
    const revenueThb = unitPriceThb * quantity;

    return {
      quantity,
      unitPriceThb,
      basis,
      minOrderGrossProfitThb,
      logoCostThb: landed.orderLogoThb,
      smallOrderFactor: landed.smallOrderFactor,
      markupFactor,
      freightMode: landed.freight.mode,
      landedUnitCostThb: round(landed.totalThb, 2),
      ladderPriceThb: round(ladderPriceThb, 2),
      floorPriceThb: round(floorPriceThb, 2),
      orderGrossProfitThb: round(orderGrossProfitThb, 2),
      grossMarginPct: round((orderGrossProfitThb / revenueThb) * 100, 2),
    };
  });

  /*
   * A published list where a larger order costs more per unit than a smaller one is not
   * defensible to a customer. Carton rounding makes this possible in principle — freight per unit
   * can jump at a break that opens a new carton — so it is checked rather than assumed.
   */
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i].unitPriceThb > breaks[i - 1].unitPriceThb) {
      warnings.push(
        `Unit price increases from ${breaks[i - 1].quantity} to ${breaks[i].quantity} units ` +
          `(${breaks[i - 1].unitPriceThb} → ${breaks[i].unitPriceThb} THB). ` +
          `Check carton packing: a larger order should not cost more per unit.`
      );
    }
  }

  /*
   * A bigger order that earns less money than a smaller one is never intended. It means a volume
   * markup is being applied outside the segment it was negotiated for — the thin multiple was
   * agreed for dear products sold at a fixed price point, not as a blanket discount on cheap ones.
   */
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i].orderGrossProfitThb < breaks[i - 1].orderGrossProfitThb) {
      warnings.push(
        `An order of ${breaks[i].quantity} sets earns LESS than one of ${breaks[i - 1].quantity} ` +
          `(${Math.round(breaks[i].orderGrossProfitThb).toLocaleString()} vs ` +
          `${Math.round(breaks[i - 1].orderGrossProfitThb).toLocaleString()} THB). ` +
          `The ${breaks[i].quantity}-set markup does not suit a SKU at this cost — check whether ` +
          `the volume rule was meant for a more expensive product.`
      );
    }
  }

  /*
   * A volume-markup break sits far below the ladder by design. On a printed sheet that reads as a
   * cliff — a customer at 500 sets sees a much better price 500 sets away and feels short-changed.
   * Worth flagging so the step is a deliberate negotiating position, not an accident of config.
   */
  for (let i = 1; i < breaks.length; i++) {
    const drop = 1 - breaks[i].unitPriceThb / breaks[i - 1].unitPriceThb;
    if (drop > 0.25) {
      warnings.push(
        `Price drops ${(drop * 100).toFixed(0)}% between ${breaks[i - 1].quantity} and ` +
          `${breaks[i].quantity} sets (${breaks[i - 1].unitPriceThb} → ${breaks[i].unitPriceThb} THB). ` +
          `Consider quoting this break on request rather than printing it beside the others.`
      );
    }
  }

  const flooredBreaks = breaks.filter((b) => b.basis === 'min_profit_floor');
  if (flooredBreaks.length > 0) {
    warnings.push(
      `The minimum-profit floor raised the price at ${flooredBreaks
        .map((b) => `${b.quantity} (to clear ${b.minOrderGrossProfitThb} THB)`)
        .join(', ')} units. These quantities are priced above the published ladder.`
    );
  }

  const modes = new Set(breaks.map((b) => b.freightMode));
  if (modes.size > 1) {
    const bySea = breaks.filter((b) => b.freightMode === 'sea').map((b) => b.quantity);
    warnings.push(
      `Freight mode is not the same at every break: ${bySea.join(', ')} ship by sea, the rest by ` +
        `truck. Sea is cheaper but slower — confirm the lead time suits the customer.`
    );
  }

  if (input.carton.cartonWeightKg === undefined) {
    warnings.push(
      `Carton weight was not supplied, so freight is charged on volume. This flips to ` +
        `weight-based charging above ${anchorLandedUnitCost.freight.weightFlipThresholdKg} kg per carton.`
    );
  }

  const premium = breaks.filter((b) => b.smallOrderFactor > 1);
  if (premium.length) {
    warnings.push(
      `The factory's small-order premium is applied at ${premium
        .map((b) => `${b.quantity} (x${b.smallOrderFactor})`)
        .join(', ')} sets. The catalog states only "1.1 - 1.5 times price" without saying which ` +
        `quantity attracts which multiple — confirm the steps with the factory.`
    );
  }

  if (input.inlandChinaCostRmb > 0) {
    const perSetThb = round(input.inlandChinaCostRmb * input.exchangeRate, 2);
    warnings.push(
      `Inland China freight is included at ${input.inlandChinaCostRmb} RMB per set ` +
        `(${perSetThb} THB at ${input.exchangeRate}) — the factory-to-warehouse leg, which the old ` +
        `sheets left out entirely. Confirmed by the owner on 2026-08-11.`
    );
  }

  if (input.logo.method === 'none') {
    warnings.push(
      'No logo method was chosen, so no screening charge is included. The published price lists ' +
        'promise a full-colour logo on every piece plus the gift box and bag.'
    );
  } else if (logoMethodNeedsRate(input.logo.method) && !input.logo.uvRatePerPieceUsd) {
    warnings.push(
      'UV printing has no published rate — the catalog says to check colour printing with sales. ' +
        'It is currently costing nothing, which understates the price.'
    );
  }

  if (input.additionalUnitCostThb === 0 && input.additionalOrderCostThb === 0) {
    warnings.push(
      'No gift box, bag or domestic delivery cost was supplied beyond the factory logo charge. ' +
        'Profit shown is landed-cost gross profit only and is higher than the true figure.'
    );
  }

  return {
    sku: input.sku,
    asOf,
    policy,
    freight: input.freight,
    freightRateProvenance: FREIGHT_RATE_PROVENANCE,
    anchorLandedUnitCost,
    breaks,
    warnings,
  };
}
