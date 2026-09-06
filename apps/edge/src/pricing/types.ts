import { z } from 'zod';

/**
 * Freight rate-card axes, transcribed from the LK (ชิปปิ้ง) rate sheets. The four axes below are
 * exactly the four the sheet prices on — warehouse, mode, membership tier, and goods class — so a
 * quote cannot be produced without stating all four.
 */
export const WAREHOUSES = ['guangzhou_shenzhen', 'yiwu'] as const;
export type Warehouse = (typeof WAREHOUSES)[number];

export const FREIGHT_MODES = ['truck', 'sea'] as const;
export type FreightMode = (typeof FREIGHT_MODES)[number];

/** LK membership tiers, cheapest (ELITE, highest volume) to dearest (MEMBER). */
export const MEMBERSHIP_TIERS = ['elite', 'gold', 'silver', 'member'] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

/** Goods classes on the sheet: ทั่วไป / Electronic มอก. / Cosmetic อย. / อื่นๆ. */
export const GOODS_CLASSES = ['general', 'electronic_tisi', 'cosmetic_fda', 'other'] as const;
export type GoodsClass = (typeof GOODS_CLASSES)[number];

/** One cell of the rate card: THB per CBM and THB per kg. */
export interface FreightRate {
  thbPerCbm: number;
  thbPerKg: number;
}

/**
 * Where a number came from and when it was true. AGENTS.md requires every output to be traceable
 * to a source and an `as_of` time, so provenance travels with the rate card and the quote rather
 * than living only in a commit message.
 */
export interface Provenance {
  source: string;
  asOf: string;
  note?: string;
}

/**
 * Physical carton facts needed to price freight. The LK sheet charges the greater-of volume and
 * weight via a density switch, so both are mandatory — a quote that guesses either one is wrong,
 * not merely imprecise.
 */
export const cartonSpecSchema = z.object({
  /** Sellable units packed in one carton as shipped from the factory. */
  unitsPerCarton: z.number().int().positive(),
  /** Outer carton volume in cubic metres. */
  cartonCbm: z.number().positive(),
  /**
   * Gross carton weight in kilograms. Optional because the factory catalogs almost never state it
   * — of 1,017 gift-set SKUs, exactly one carries a weight. When it is absent the shipment is
   * charged on volume and the quote says so, along with the weight at which that would flip.
   */
  cartonWeightKg: z.number().positive().optional(),
});
export type CartonSpec = z.infer<typeof cartonSpecSchema>;

/**
 * `auto` applies SmartGift's own routing rule (see `resolveFreightMode`) instead of pinning the
 * mode. Because the rule keys off shipment volume, the resolved mode can differ between quantity
 * breaks of the same quote — a 10-set order may go by truck while a 500-set order goes by sea.
 */
export const freightSelectionSchema = z
  .object({
    warehouse: z.enum(WAREHOUSES).default('guangzhou_shenzhen'),
    mode: z.union([z.enum(FREIGHT_MODES), z.literal('auto')]).default('auto'),
    membershipTier: z.enum(MEMBERSHIP_TIERS).default('silver'),
    goodsClass: z.enum(GOODS_CLASSES).default('electronic_tisi'),
    /** Calendar month of shipment, 1–12. Required when `mode` is `auto`. */
    shipMonth: z.number().int().min(1).max(12).optional(),
  })
  .superRefine((sel, ctx) => {
    if (sel.mode === 'auto' && sel.shipMonth === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shipMonth'],
        message:
          'shipMonth is required when mode is "auto": the truck/sea rule depends on whether the ' +
          'shipment falls in the Sep–Jan selling season.',
      });
    }
  });
export type FreightSelection = z.infer<typeof freightSelectionSchema>;
export type FreightSelectionInput = z.input<typeof freightSelectionSchema>;

/**
 * `flat` is how SmartGift actually costs screening today — a fixed rate per position, no method
 * breakdown — and is the default for that reason. The remaining methods reproduce the factory's
 * published schedules, for checking a real quote against the rule of thumb.
 */
export const LOGO_METHODS = [
  'flat',
  'none',
  'hotstamp',
  'hotstamp_text',
  'engrave',
  'silk',
  'uv',
] as const;
export type LogoMethod = (typeof LOGO_METHODS)[number];

export const logoSpecSchema = z.object({
  method: z.enum(LOGO_METHODS).default('flat'),
  /** `flat` only: THB per screening position per piece. The house rate is 10. */
  flatRatePerPositionThb: z.number().nonnegative().default(10),
  /**
   * Places the logo is applied on one set. Derived from the item code by
   * `screenPositionsForItemCode`, but always overridable — the code is a convention, not a
   * guarantee about a particular order.
   */
  positions: z.number().int().positive().default(1),
  /** Silk printing only: a separate mould per colour. */
  colors: z.number().int().positive().default(1),
  /** UV printing only: the factory publishes no rate, so it has to be supplied. */
  uvRatePerPieceUsd: z.number().nonnegative().optional(),
});
export type LogoSpec = z.infer<typeof logoSpecSchema>;

/**
 * Everything needed to price one SKU. Costs are split into per-unit and per-order buckets because
 * the minimum-profit floor divides order costs across the quantity while per-unit costs do not.
 */
export const pricingInputSchema = z.object({
  sku: z.string().min(1),
  /** Factory quote in RMB per sellable unit. */
  factoryCostRmb: z.number().nonnegative(),
  /** THB per 1 RMB on the day the quote is built. */
  exchangeRate: z.number().positive(),
  carton: cartonSpecSchema,
  freight: freightSelectionSchema,
  /**
   * Per-unit costs added after landing: logo screening, gift box, inner bag, domestic delivery
   * per piece. Defaults to 0 so an incomplete cost picture is visible rather than silently padded.
   */
  additionalUnitCostThb: z.number().nonnegative().default(0),
  /**
   * Per-order costs that do not scale with quantity: sample, artwork/plate setup, customs
   * clearance paperwork, one-off domestic freight. Logo charges are NOT included here — they
   * follow the factory's own schedule and are computed per break.
   */
  additionalOrderCostThb: z.number().nonnegative().default(0),
  /**
   * Inland freight inside China — factory gate to the forwarder's warehouse, left out of every
   * quote until now.
   *
   * Held in RMB because that is the currency the rule was given in. The owner first put it at
   * "5-10 THB" (2026-08-11 12:30) and then gave the actual figure half an hour later: **2 RMB per
   * set** (13:05). The two agree only at 5 THB/RMB. Storing the THB number would be storing one
   * day's exchange rate as though it were the rule, and it would drift silently the moment the
   * rate moved — so the rate is applied here, exactly as it is to the factory cost itself.
   */
  inlandChinaCostRmb: z.number().nonnegative().default(2),
  /** Logo decoration, priced from the factory's published schedule. */
  logo: logoSpecSchema.default({}),
  /**
   * THB per 1 USD, for the factory's logo charges. Defaults to the workbook's own arithmetic:
   * it converts RMB to USD at 6.5, so one USD is 6.5 x the THB/RMB rate.
   */
  usdToThb: z.number().positive().optional(),
});
export type PricingInput = z.input<typeof pricingInputSchema>;
export type ResolvedPricingInput = z.output<typeof pricingInputSchema>;

export const pricingPolicySchema = z
  .object({
  /**
   * Quantity breaks printed on the price list, ascending. The last break is the anchor the markup
   * is applied to — the customer-facing sheet states its list price is "based on more than 500
   * pcs", so 500 anchors and smaller quantities step up from it.
   */
  quantityBreaks: z.array(z.number().int().positive()).min(1),
  /**
   * Multiplier per break, index-aligned with `quantityBreaks` and expressed relative to the
   * anchor. Fitted to the published price lists — see PRICING-ENGINE-SPEC.md §3.
   */
  ladderFactors: z.array(z.number().positive()).min(1),
    /**
     * Which cost the markup multiplies.
     *
     * `factory_cost` reproduces how the published lists were actually built: the observed
     * multiples were taken over factory cost alone, with freight absorbed inside them. Applying
     * those same multiples to a landed cost would count freight twice.
     *
     * `landed_cost` is the cost-plus alternative for SKUs where carton data is known and a true
     * landed cost can be computed.
     *
     * Either way the minimum-profit floor always uses the real landed cost, so freight can never
     * be priced out of the deal.
     */
    markupBasis: z.enum(['factory_cost', 'landed_cost']),
    /**
     * Price the markup off a landed cost computed at this goods class, whatever the shipment
     * actually ships as.
     *
     * Needed because a cost-plus price otherwise moves with the freight rate: when a box with no
     * electronics drops to the cheaper ทั่วไป rate, the published price would fall and hand the
     * saving to the customer — the opposite of the owner's decision to keep it as margin. Pinning
     * the basis holds the price still while the real, cheaper cost flows through to profit.
     */
    pricingReferenceGoodsClass: z.enum(GOODS_CLASSES).optional(),
    /**
     * Markup by cost band, ascending by threshold. SmartGift's published prices do not use one
     * multiplier — the multiple falls as the item gets dearer. `maxBasisCostThb` is the top of the
     * band; the last entry should be `Infinity`.
     */
    markupBands: z
      .array(
        z.object({
          maxBasisCostThb: z.number().positive(),
          factor: z.number().positive(),
        })
      )
      .min(1),
    /** The break the markup is applied to. Smaller breaks step up from it, larger ones step down. */
    anchorQuantity: z.number().int().positive(),
    /**
     * Quantities priced on a target markup instead of the ladder. Big-volume deals are negotiated
     * against a margin the owner will accept rather than derived from the published sheet — at
     * 1,000 sets that is 1.4–1.5x cost, far below anything the ladder reaches.
     */
    volumeMarkupOverrides: z
      .array(
        z.object({
          quantity: z.number().int().positive(),
          markupFactor: z.number().positive(),
          /**
           * Cheapest basis cost the override applies to. A thin volume multiple was agreed for a
           * fixed customer price point, so applying it to a cheap SKU would price below what
           * anyone asked for and earn less on a bigger order.
           */
          minBasisCostThb: z.number().nonnegative().default(0),
        })
      )
      .default([]),
    /**
     * Minimum gross profit per order, by order size. Small orders clear a higher bar because they
     * cost about the same to service as large ones. Ascending by `maxQuantity`, last entry
     * `Infinity`. "Gross" means before VAT and before any cost not supplied in
     * `additionalUnitCostThb` / `additionalOrderCostThb`.
     */
    profitFloors: z
      .array(
        z.object({
          maxQuantity: z.number().positive(),
          minOrderGrossProfitThb: z.number().nonnegative(),
        })
      )
      .min(1),
    /** Published prices are rounded up to this step, in THB. */
    roundingStepThb: z.number().positive(),
  })
  .superRefine((policy, ctx) => {
    if (policy.ladderFactors.length !== policy.quantityBreaks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ladderFactors'],
        message:
          `ladderFactors must have one entry per quantity break ` +
          `(got ${policy.ladderFactors.length} factors for ${policy.quantityBreaks.length} breaks).`,
      });
    }
    const ascending = policy.quantityBreaks.every(
      (q, i) => i === 0 || q > policy.quantityBreaks[i - 1]
    );
    if (!ascending) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantityBreaks'],
        message: 'quantityBreaks must be strictly ascending; the last break is the markup anchor.',
      });
    }
    const bandsAscending = policy.markupBands.every(
      (b, i) => i === 0 || b.maxBasisCostThb > policy.markupBands[i - 1].maxBasisCostThb
    );
    if (!bandsAscending) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['markupBands'],
        message: 'markupBands must be ascending by maxBasisCostThb.',
      });
    }
    const last = policy.markupBands[policy.markupBands.length - 1];
    if (last && Number.isFinite(last.maxBasisCostThb)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['markupBands'],
        message:
          'The last markup band must end at Infinity, otherwise a SKU above the top threshold ' +
          'would have no markup at all.',
      });
    }
    if (!policy.quantityBreaks.includes(policy.anchorQuantity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchorQuantity'],
        message: `anchorQuantity ${policy.anchorQuantity} is not one of the quantity breaks.`,
      });
    }
    for (const o of policy.volumeMarkupOverrides) {
      if (!policy.quantityBreaks.includes(o.quantity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['volumeMarkupOverrides'],
          message: `volumeMarkupOverrides references quantity ${o.quantity}, which is not a break.`,
        });
      }
    }
    const floorsAscending = policy.profitFloors.every(
      (f, i) => i === 0 || f.maxQuantity > policy.profitFloors[i - 1].maxQuantity
    );
    if (!floorsAscending) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profitFloors'],
        message: 'profitFloors must be ascending by maxQuantity.',
      });
    }
    const lastFloor = policy.profitFloors[policy.profitFloors.length - 1];
    if (lastFloor && Number.isFinite(lastFloor.maxQuantity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profitFloors'],
        message: 'The last profit floor must end at Infinity, or large orders would have no floor.',
      });
    }
  });
export type PricingPolicy = z.infer<typeof pricingPolicySchema>;

/** Which rule decided the published price at a given break. */
export type PriceBasis = 'ladder' | 'volume_markup' | 'min_profit_floor';


/** Factory premium for ordering below the 500-set price basis. */
export interface SmallOrderFactor {
  maxQuantity: number;
  factor: number;
}

export interface LandedUnitCost {
  factoryCostThb: number;
  /** Factory premium applied for ordering below the 500-set price basis. 1.0 at 500 and above. */
  smallOrderFactor: number;
  freightPerUnitThb: number;
  /** Screening cost per set at this quantity — mould fees amortise as the order grows. */
  logoPerUnitThb: number;
  /** Factory-to-warehouse freight inside China, per set. */
  inlandChinaCostThb: number;
  /** Screening cost for the whole order at this quantity, in THB. */
  orderLogoThb: number;
  additionalUnitCostThb: number;
  totalThb: number;
  freight: {
    cartons: number;
    volumeCbm: number;
    /** Null when the carton weight is unknown. */
    weightKg: number | null;
    densityKgPerCbm: number | null;
    /** The mode actually used, after `auto` routing. */
    mode: FreightMode;
    modeReason: string;
    /** Which side of the 400 kg/CBM switch the shipment fell on. */
    chargedBy: 'volume' | 'weight';
    /**
     * Carton weight above which this shipment would flip to weight-based charging. Reported so an
     * unknown weight is a checkable assumption rather than a silent one.
     */
    weightFlipThresholdKg: number;
    rate: FreightRate;
    orderFreightThb: number;
  };
}

export interface PriceBreak {
  quantity: number;
  unitPriceThb: number;
  basis: PriceBasis;
  landedUnitCostThb: number;
  /** The markup band that applied, for auditability. */
  markupFactor: number;
  /** Resolved freight mode at this break — `auto` routing can differ break to break. */
  freightMode: FreightMode;
  /** Unrounded price the ladder — or a volume-markup override — alone would have produced. */
  ladderPriceThb: number;
  /** Unrounded price the minimum-profit floor alone would have required. */
  floorPriceThb: number;
  /** The profit floor that applied at this order size, in THB. */
  minOrderGrossProfitThb: number;
  /** Factory logo charge for the whole order at this break, in THB. */
  logoCostThb: number;
  /** Factory small-order premium in force at this break. */
  smallOrderFactor: number;
  orderGrossProfitThb: number;
  grossMarginPct: number;
}

export interface PriceQuote {
  sku: string;
  asOf: string;
  policy: PricingPolicy;
  freight: FreightSelection;
  freightRateProvenance: Provenance;
  /**
   * Landed cost at the anchor break. Freight per unit varies with quantity because cartons are
   * whole, so each break carries its own landed cost in `breaks[].landedUnitCostThb`.
   */
  anchorLandedUnitCost: LandedUnitCost;
  breaks: PriceBreak[];
  /** Conditions the caller should see stated rather than inferred from the numbers. */
  warnings: string[];
}
