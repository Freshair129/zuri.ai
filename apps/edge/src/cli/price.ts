import {
  CORPORATE_VOLUME_MARKUP,
  LOGO_METHODS,
  screenPositionsForItemCode,
  FREIGHT_MODES,
  GOODS_CLASSES,
  MEMBERSHIP_TIERS,
  PRICING_PROFILES,
  PriceQuote,
  PricingPolicy,
  PricingProfile,
  SEA_THRESHOLD_CBM,
  SMARTGIFT_FREIGHT_ACCOUNT,
  WAREHOUSES,
  buildPriceQuote,
  resolveGoodsClass,
} from '../pricing/index.js';

export type CliFlags = Record<string, string | boolean>;

const REQUIRED_FLAGS = ['sku', 'rmb', 'fx', 'units-per-carton', 'carton-cbm'] as const;

const MARKUP_BASES = ['factory_cost', 'landed_cost'] as const;

function requireString(flags: CliFlags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`--${name} is required and must have a value.`);
  }
  return value.trim();
}

function requireNumber(flags: CliFlags, name: string): number {
  const raw = requireString(flags, name);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} must be a number (got "${raw}").`);
  }
  return value;
}

function optionalNumber(flags: CliFlags, name: string, fallback: number): number {
  if (flags[name] === undefined) return fallback;
  return requireNumber(flags, name);
}

function requireEnum<T extends readonly string[]>(
  flags: CliFlags,
  name: string,
  allowed: T,
  fallback?: T[number]
): T[number] {
  if (flags[name] === undefined && fallback !== undefined) return fallback;
  const value = requireString(flags, name);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`--${name} must be one of: ${allowed.join(', ')} (got "${value}").`);
  }
  return value as T[number];
}

/**
 * `zuri-agent price quote --sku ... ` — builds a price list for one SKU from factory cost and
 * carton facts. This is a local calculation only: it reads no tenant data, opens no DuckDB query,
 * and creates no Zuri command, so it needs no lease or policy snapshot.
 */
export function runPriceQuote(flags: CliFlags, basePolicy?: PricingPolicy): PriceQuote {
  const missing = REQUIRED_FLAGS.filter((name) => flags[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.map((f) => `--${f}`).join(', ')}.`);
  }

  const profile = requireEnum(
    flags,
    'profile',
    Object.keys(PRICING_PROFILES) as PricingProfile[],
    'standard'
  );
  const policy = basePolicy ?? PRICING_PROFILES[profile];

  const effectivePolicy: PricingPolicy = {
    ...policy,
    markupBasis: requireEnum(flags, 'markup-basis', MARKUP_BASES, policy.markupBasis),
    // A single --markup overrides the fitted band table outright, for a one-off quote.
    markupBands:
      flags.markup === undefined
        ? policy.markupBands
        : [{ maxBasisCostThb: Infinity, factor: requireNumber(flags, 'markup') }],
    // --min-profit flattens the by-size schedule to one value, for a one-off quote.
    profitFloors:
      flags['min-profit'] === undefined
        ? policy.profitFloors
        : [
            {
              maxQuantity: Infinity,
              minOrderGrossProfitThb: requireNumber(flags, 'min-profit'),
            },
          ],
    roundingStepThb: optionalNumber(flags, 'round-to', policy.roundingStepThb),
  };

  return buildPriceQuote(
    {
      sku: requireString(flags, 'sku'),
      factoryCostRmb: requireNumber(flags, 'rmb'),
      exchangeRate: requireNumber(flags, 'fx'),
      carton: {
        unitsPerCarton: requireNumber(flags, 'units-per-carton'),
        cartonCbm: requireNumber(flags, 'carton-cbm'),
        cartonWeightKg: flags['carton-kg'] === undefined ? undefined : requireNumber(flags, 'carton-kg'),
      },
      freight: {
        warehouse: requireEnum(flags, 'warehouse', WAREHOUSES, SMARTGIFT_FREIGHT_ACCOUNT.warehouse),
        mode: requireEnum(flags, 'mode', [...FREIGHT_MODES, 'auto'] as const, 'auto'),
        membershipTier: requireEnum(
          flags,
          'tier',
          MEMBERSHIP_TIERS,
          SMARTGIFT_FREIGHT_ACCOUNT.membershipTier
        ),
        // --class wins if given; otherwise --no-electronics picks the cheaper general rate.
        goodsClass:
          flags.class !== undefined
            ? requireEnum(flags, 'class', GOODS_CLASSES)
            : resolveGoodsClass(flags['no-electronics'] === undefined),
        shipMonth: optionalNumber(flags, 'ship-month', new Date().getMonth() + 1),
      },
      logo: {
        method: requireEnum(flags, 'logo', LOGO_METHODS, 'flat'),
        flatRatePerPositionThb: optionalNumber(flags, 'screen-rate', 10),
        // The item code says how many pieces are in the set; box and bag add two more.
        positions: optionalNumber(flags, 'positions', screenPositionsForItemCode(requireString(flags, 'sku'))),
        colors: optionalNumber(flags, 'colors', 1),
        uvRatePerPieceUsd: flags['uv-rate'] === undefined ? undefined : requireNumber(flags, 'uv-rate'),
      },
      usdToThb: flags['usd-rate'] === undefined ? undefined : requireNumber(flags, 'usd-rate'),
      inlandChinaCostRmb: optionalNumber(flags, 'inland-cn-rmb', 2),
      additionalUnitCostThb: optionalNumber(flags, 'unit-cost', 0),
      additionalOrderCostThb: optionalNumber(flags, 'order-cost', 0),
    },
    effectivePolicy
  );
}

export const PRICE_QUOTE_USAGE = {
  usage:
    'zuri-agent price quote --sku <code> --rmb <n> --fx <n> --units-per-carton <n> ' +
    '--carton-cbm <n> [options]',
  required: {
    '--sku': 'SKU code as printed on the price list',
    '--rmb': 'factory cost per unit in RMB (the catalog EXW column is a `RMB/6.5` formula)',
    '--fx': 'THB per 1 RMB on the quote date',
    '--units-per-carton': 'sellable units per outer carton',
    '--carton-cbm': 'outer carton volume in cubic metres (L x W x H cm / 1,000,000)',
  },
  optional: {
    '--profile':
      `standard | corporate — "corporate" is the 300-1,000 set enterprise segment priced at a flat ` +
      `${CORPORATE_VOLUME_MARKUP}x landed cost. The two profiles contradict each other by design; ` +
      `pick the one that matches the deal.`,
    '--inland-cn-rmb':
      'factory-to-warehouse freight inside China, RMB per set (default: 2, confirmed by the owner)',
    '--carton-kg': 'gross carton weight; without it freight is charged on volume',
    '--logo': `${LOGO_METHODS.join(' | ')} (default: flat — the house rate of 10 THB per position)`,
    '--positions':
      'screening positions; defaults to the last digit of the item code plus 2 for box and bag',
    '--screen-rate': 'THB per position per piece for the flat method (default: 10)',
    '--colors': 'silk printing only: a separate mould per colour (default: 1)',
    '--uv-rate': 'UV printing only: USD per piece per position — the factory publishes no rate',
    '--usd-rate': 'THB per USD for factory logo charges (default: the FX rate x 6.5)',
    '--markup-basis': `${MARKUP_BASES.join(' | ')} (default: factory_cost, matching how the published lists were built)`,
    '--no-electronics': 'nothing electrical in the box — takes the cheaper ทั่วไป rate',
    '--ship-month': '1-12, month of shipment; drives the auto truck/sea rule (default: this month)',
    '--mode': `${FREIGHT_MODES.join(' | ')} | auto (default: auto — truck in the Sep–Jan season, sea off-season above ${SEA_THRESHOLD_CBM} CBM)`,
    '--warehouse': `${WAREHOUSES.join(' | ')} (default: ${SMARTGIFT_FREIGHT_ACCOUNT.warehouse})`,
    '--tier': `${MEMBERSHIP_TIERS.join(' | ')} — LK membership level (default: ${SMARTGIFT_FREIGHT_ACCOUNT.membershipTier})`,
    '--class': `${GOODS_CLASSES.join(' | ')} — overrides --no-electronics`,
    '--unit-cost': 'per-unit cost added after landing: screening, gift box, bag (default: 0)',
    '--order-cost': 'per-order cost: sample, artwork setup, clearance (default: 0)',
    '--markup': 'override the fitted cost-band markup table with one flat multiple',
    '--min-profit':
      'one flat minimum gross profit per order in THB, replacing the by-size schedule ' +
      '(default: 5,000 up to 20 sets, 3,000 above)',
    '--round-to': `round published prices up to this step (default: ${PRICING_PROFILES.standard.roundingStepThb})`,
  },
};
