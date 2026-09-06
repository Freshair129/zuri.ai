import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_PRICING_POLICY,
  buildPriceQuote,
  calculateFreight,
  getFreightRate,
  CORPORATE_VOLUME_POLICY,
  markupFactorFor,
  resolveFreightMode,
  resolveGoodsClass,
  roundUpTo,
  screenPositionsForItemCode,
  logoCostThb,
  leadTimeFor,
  modeForDeadline,
  productionDays,
  SMARTGIFT_FREIGHT_ACCOUNT,
} from '../../src/pricing/index.js';
import { logoSpecSchema, pricingInputSchema, pricingPolicySchema } from '../../src/pricing/types.js';
import { runPriceQuote } from '../../src/cli/price.js';

// @tested SDD-014 — the SmartGift quote calculation.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * A light, bulky SKU shipped by sea at MEMBER tier: 5,400 THB/CBM. Landed cost lands well under
 * the point where the ladder alone clears 3,000 THB per order, so the floor binds at the small
 * breaks — which is the case the whole exercise exists to handle.
 */
const CHEAP_SKU = {
  sku: 'TEST-CHEAP',
  factoryCostRmb: 15,
  exchangeRate: 5,
  carton: { unitsPerCarton: 50, cartonCbm: 0.05, cartonWeightKg: 6 },
  freight: {
    warehouse: 'guangzhou_shenzhen',
    mode: 'sea',
    membershipTier: 'member',
    goodsClass: 'general',
  },
} as const;

/** A mid-priced SKU where the published ladder already clears the floor at every break. */
const NORMAL_SKU = {
  sku: 'TEST-NORMAL',
  factoryCostRmb: 45,
  exchangeRate: 5,
  carton: { unitsPerCarton: 20, cartonCbm: 0.09, cartonWeightKg: 10 },
  freight: {
    warehouse: 'guangzhou_shenzhen',
    mode: 'sea',
    membershipTier: 'member',
    goodsClass: 'general',
  },
} as const;

describe('LK freight rate card', () => {
  it("reads SmartGift's own cell: Guangzhou, SILVER, Electronic มอก., truck", () => {
    // Confirmed by the owner 2026-08-11 as 7,400 THB/CBM.
    assert.deepStrictEqual(
      getFreightRate(
        { ...SMARTGIFT_FREIGHT_ACCOUNT, goodsClass: 'electronic_tisi', shipMonth: undefined },
        'truck'
      ),
      { thbPerCbm: 7400, thbPerKg: 19 }
    );
  });

  it('reads the documented cell for each axis', () => {
    assert.deepStrictEqual(
      getFreightRate(
        { warehouse: 'guangzhou_shenzhen', membershipTier: 'member', goodsClass: 'general', shipMonth: undefined },
        'sea'
      ),
      { thbPerCbm: 5400, thbPerKg: 14 }
    );

    assert.deepStrictEqual(
      getFreightRate(
        { warehouse: 'guangzhou_shenzhen', membershipTier: 'elite', goodsClass: 'general', shipMonth: undefined },
        'truck'
      ),
      { thbPerCbm: 5900, thbPerKg: 15 }
    );

    assert.deepStrictEqual(
      getFreightRate(
        { warehouse: 'yiwu', membershipTier: 'member', goodsClass: 'other', shipMonth: undefined },
        'truck'
      ),
      { thbPerCbm: 11000, thbPerKg: 28 }
    );
  });

  it('prices Yiwu truck above Guangzhou truck for the same goods and tier', () => {
    const base = { membershipTier: 'gold', goodsClass: 'general', shipMonth: undefined } as const;
    const yiwu = getFreightRate({ ...base, warehouse: 'yiwu' }, 'truck');
    const guangzhou = getFreightRate({ ...base, warehouse: 'guangzhou_shenzhen' }, 'truck');
    assert.ok(yiwu.thbPerCbm > guangzhou.thbPerCbm);
  });

  it('charges 500 THB/CBM less for a box with nothing electrical in it', () => {
    const base = { ...SMARTGIFT_FREIGHT_ACCOUNT, shipMonth: undefined } as const;
    const electronic = getFreightRate({ ...base, goodsClass: resolveGoodsClass(true) }, 'truck');
    const general = getFreightRate({ ...base, goodsClass: resolveGoodsClass(false) }, 'truck');

    assert.strictEqual(electronic.thbPerCbm, 7400);
    assert.strictEqual(general.thbPerCbm, 6900);
  });
});

describe('Freight mode routing', () => {
  it('sends everything by truck during the Sep–Jan selling season', () => {
    for (const month of [9, 10, 11, 12, 1]) {
      assert.strictEqual(resolveFreightMode(month, 0.5).mode, 'truck');
      assert.strictEqual(
        resolveFreightMode(month, 40).mode,
        'truck',
        'even a large shipment goes by road in season — customers are rushing'
      );
    }
  });

  it('sends off-season shipments over 5 CBM by sea', () => {
    for (const month of [2, 5, 8]) {
      assert.strictEqual(resolveFreightMode(month, 5.01).mode, 'sea');
      assert.strictEqual(resolveFreightMode(month, 5).mode, 'truck', '5 CBM exactly is not "over"');
      assert.strictEqual(resolveFreightMode(month, 0.5).mode, 'truck');
    }
  });

  it('explains the routing decision', () => {
    assert.match(resolveFreightMode(11, 20).reason, /selling season/);
    assert.match(resolveFreightMode(4, 20).reason, /exceeds/);
  });

  it('can resolve to different modes at different breaks of one quote', () => {
    // Off season, 0.11 CBM per 20-set carton: 500 sets is 25 cartons = 2.75 CBM (truck),
    // but 5,000 sets would be 27.5 CBM (sea). Within the standard ladder, check the boundary.
    const quote = buildPriceQuote({
      ...NORMAL_SKU,
      carton: { unitsPerCarton: 5, cartonCbm: 0.25 },
      freight: { ...SMARTGIFT_FREIGHT_ACCOUNT, mode: 'auto', shipMonth: 4, goodsClass: 'general' },
    });

    const byQty = new Map(quote.breaks.map((b) => [b.quantity, b.freightMode]));
    assert.strictEqual(byQty.get(10), 'truck', '2 cartons = 0.5 CBM');
    assert.strictEqual(byQty.get(500), 'sea', '100 cartons = 25 CBM');
    assert.ok(quote.warnings.some((w) => w.includes('Freight mode is not the same at every break')));
  });

  it('requires a ship month when the mode is auto', () => {
    assert.throws(
      () =>
        buildPriceQuote({
          ...NORMAL_SKU,
          freight: { ...SMARTGIFT_FREIGHT_ACCOUNT, mode: 'auto', goodsClass: 'general' },
        }),
      /shipMonth is required/
    );
  });

  /*
   * The owner gave this as "2 RMB per set", not as a THB figure. Held in THB it is right only at
   * 5 THB/RMB and drifts silently the day the rate moves — a number that can no longer be traced
   * back to the rule it came from. These pin the conversion rather than the coincidence.
   */
  it('charges inland China freight at 2 RMB per set, converted at the day rate', () => {
    const atFive = buildPriceQuote({ ...NORMAL_SKU, exchangeRate: 5 });
    assert.strictEqual(atFive.anchorLandedUnitCost.inlandChinaCostThb, 10);

    const atSixFour = buildPriceQuote({ ...NORMAL_SKU, exchangeRate: 6.4 });
    assert.strictEqual(atSixFour.anchorLandedUnitCost.inlandChinaCostThb, 12.8);
  });

  it('states the figure in the currency the rule was given in', () => {
    const quote = buildPriceQuote({ ...NORMAL_SKU, exchangeRate: 5 });
    const note = quote.warnings.find((w) => w.includes('Inland China freight'));
    assert.ok(note?.includes('2 RMB per set'));
    assert.ok(note?.includes('10 THB'), 'and what that comes to at the rate in use');
  });

  it('takes a different inland rate, so a renegotiated leg needs no code change', () => {
    const quote = buildPriceQuote({ ...NORMAL_SKU, inlandChinaCostRmb: 3, exchangeRate: 5 });
    assert.strictEqual(quote.anchorLandedUnitCost.inlandChinaCostThb, 15);
  });
});

describe('Freight calculation', () => {
  it('charges by volume below the 400 kg/CBM density switch', () => {
    const input = pricingInputSchema.parse(CHEAP_SKU);
    const freight = calculateFreight(input, 10);

    assert.strictEqual(freight.chargedBy, 'volume');
    assert.strictEqual(freight.densityKgPerCbm, 120);
    assert.strictEqual(freight.cartons, 1, 'ten units out of a fifty-unit carton still ship one carton');
    assert.strictEqual(freight.volumeCbm, 0.05);
    assert.strictEqual(freight.orderFreightThb, 270);
  });

  it('charges by weight at or above the density switch', () => {
    const input = pricingInputSchema.parse({
      ...CHEAP_SKU,
      carton: { unitsPerCarton: 50, cartonCbm: 0.01, cartonWeightKg: 10 },
    });
    const freight = calculateFreight(input, 100);

    assert.strictEqual(freight.chargedBy, 'weight');
    assert.strictEqual(freight.cartons, 2);
    assert.strictEqual(freight.weightKg, 20);
    assert.strictEqual(freight.orderFreightThb, 280, '20 kg x 14 THB/kg');
  });

  it('falls back to volume when the carton weight is unknown, and says what would flip it', () => {
    const input = pricingInputSchema.parse({
      ...CHEAP_SKU,
      carton: { unitsPerCarton: 20, cartonCbm: 0.11 },
    });
    const freight = calculateFreight(input, 20);

    assert.strictEqual(freight.chargedBy, 'volume');
    assert.strictEqual(freight.weightKg, null);
    assert.strictEqual(freight.densityKgPerCbm, null);
    assert.strictEqual(freight.weightFlipThresholdKg, 44, '0.11 CBM x 400 kg/CBM');
    assert.strictEqual(freight.orderFreightThb, 594, '0.11 CBM x 5400 THB/CBM');
  });

  it('applies the 0.01 CBM per-package minimum', () => {
    const input = pricingInputSchema.parse({
      ...CHEAP_SKU,
      carton: { unitsPerCarton: 50, cartonCbm: 0.005, cartonWeightKg: 1 },
    });
    const freight = calculateFreight(input, 50);

    assert.strictEqual(freight.chargedBy, 'volume');
    assert.strictEqual(freight.volumeCbm, 0.01, 'billed at the 0.01 CBM floor, not 0.005');
    assert.strictEqual(freight.orderFreightThb, 54);
  });

  it('spreads freight over more units as quantity grows within a carton', () => {
    const input = pricingInputSchema.parse(CHEAP_SKU);
    const atTen = calculateFreight(input, 10);
    const atFifty = calculateFreight(input, 50);

    assert.strictEqual(atTen.orderFreightThb, atFifty.orderFreightThb, 'same single carton');
    assert.strictEqual(atTen.cartons, atFifty.cartons);
  });
});

describe('Screening positions from the item code', () => {
  it('reads the component count off the last digit and adds the box and the bag', () => {
    // Confirmed by the owner: a seven-piece set screens in nine places.
    assert.strictEqual(screenPositionsForItemCode('TDR0--7'), 9);
    // TTT02-3 is umbrella + flask + glass cup; TCZ0036 is a six-piece IT set.
    assert.strictEqual(screenPositionsForItemCode('TTT02-3'), 5);
    assert.strictEqual(screenPositionsForItemCode('TCZ0036'), 8);
    assert.strictEqual(screenPositionsForItemCode('TJS23-2'), 4);
    assert.strictEqual(screenPositionsForItemCode('TAB01-1'), 3);
  });

  it('treats a code ending in zero as a single stock item, not a zero-piece set', () => {
    assert.strictEqual(screenPositionsForItemCode('DQL00'), 3);
  });

  it('falls back to one component when the code carries no digit', () => {
    assert.strictEqual(screenPositionsForItemCode('CUSTOM'), 3);
  });
});

describe('Logo charges', () => {
  const spec = (over: Record<string, unknown> = {}) =>
    logoSpecSchema.parse({ positions: 9, ...over });

  it('defaults to the house rate: 10 THB per position per piece', () => {
    // A nine-position set at 100 sets: 100 x 9 x 10.
    assert.strictEqual(logoCostThb(spec(), 100, 32.5), 9000);
    assert.strictEqual(logoCostThb(spec({ flatRatePerPositionThb: 12 }), 100, 32.5), 10800);
  });

  it('charges the hot-stamp mould once per position, and only per piece above 100', () => {
    // 1-100 pcs is the mould alone: $11.3 x 9 positions.
    assert.strictEqual(logoCostThb(spec({ method: 'hotstamp' }), 100, 1), round2(11.3 * 9));
    // 101-499 adds $0.081 for each piece past the hundredth.
    assert.strictEqual(
      round2(logoCostThb(spec({ method: 'hotstamp' }), 300, 1)),
      round2((11.3 + 200 * 0.081) * 9)
    );
    // The per-piece rate drops again past 500 and past 1000.
    assert.ok(
      logoCostThb(spec({ method: 'hotstamp', positions: 1 }), 1000, 1) <
        11.3 + 900 * 0.065,
      'the >1000 band should be cheaper per piece than the 500-999 one'
    );
  });

  it('prices engraving per piece with no mould, on a falling scale', () => {
    const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
    const at = (q: number) => logoCostThb(spec({ method: 'engrave', positions: 1 }), q, 1) / q;
    assert.strictEqual(round3(at(5)), 0.17);
    assert.strictEqual(round3(at(50)), 0.081);
    assert.strictEqual(round3(at(200)), 0.05);
    assert.strictEqual(round3(at(400)), 0.035);
    assert.strictEqual(round3(at(1000)), 0.02);
  });

  it('multiplies silk printing by both position and colour', () => {
    const one = logoCostThb(spec({ method: 'silk', positions: 1, colors: 1 }), 200, 1);
    assert.strictEqual(one, 13, 'flat $13 up to 350 pieces');
    assert.strictEqual(logoCostThb(spec({ method: 'silk', positions: 9, colors: 3 }), 200, 1), 13 * 27);
    // Above 350 it switches to a per-piece rate.
    assert.strictEqual(logoCostThb(spec({ method: 'silk', positions: 1, colors: 1 }), 500, 1), 20);
  });

  it('costs UV printing at nothing until a rate is supplied, and says so', () => {
    assert.strictEqual(logoCostThb(spec({ method: 'uv' }), 100, 1), 0);
    assert.strictEqual(logoCostThb(spec({ method: 'uv', uvRatePerPieceUsd: 0.05 }), 100, 1), 45);

    const quote = buildPriceQuote({ ...NORMAL_SKU, logo: { method: 'uv', positions: 9 } });
    assert.ok(quote.warnings.some((w) => w.includes('UV printing has no published rate')));
  });

  it('amortises a mould across the order but bills the flat rate on every piece', () => {
    const flat = buildPriceQuote({ ...NORMAL_SKU, logo: { positions: 9 } });
    const stamp = buildPriceQuote({ ...NORMAL_SKU, logo: { method: 'hotstamp', positions: 9 } });

    const flatPer = (q: number) => flat.breaks.find((b) => b.quantity === q)!.logoCostThb / q;
    const stampPer = (q: number) => stamp.breaks.find((b) => b.quantity === q)!.logoCostThb / q;

    assert.strictEqual(round2(flatPer(10)), round2(flatPer(1000)), 'a flat rate does not amortise');
    assert.ok(stampPer(10) > stampPer(1000) * 5, 'a mould fee spread over ten sets is punishing');
  });
});

describe('Cost-band markup', () => {
  it('applies a lower multiple as the item gets dearer, per the fitted bands', () => {
    const cheap = markupFactorFor(200, DEFAULT_PRICING_POLICY);
    const mid = markupFactorFor(400, DEFAULT_PRICING_POLICY);
    const dear = markupFactorFor(900, DEFAULT_PRICING_POLICY);

    assert.strictEqual(cheap, 3.0);
    assert.strictEqual(mid, 2.62);
    assert.strictEqual(dear, 2.14);
    assert.ok(cheap > mid && mid > dear);
  });

  it('takes the band at its inclusive upper bound', () => {
    assert.strictEqual(markupFactorFor(250, DEFAULT_PRICING_POLICY), 3.0);
    assert.strictEqual(markupFactorFor(250.01, DEFAULT_PRICING_POLICY), 2.73);
  });

  it('reproduces published 500-set prices within the fitted error', () => {
    /*
     * Four SKUs from the customer price list, with the factory RMB cost recovered from the
     * catalog's own `RMB/6.5` formula. The published list was priced SKU by SKU rather than
     * generated, so the band table is expected to be close, not exact — the fit reports 4.6% mean
     * absolute error and these sit inside 15%.
     */
    const matched = [
      { sku: 'TSQ02-2', rmb: 46.5, published500: 700 },
      { sku: 'TBG00-3', rmb: 48, published500: 720 },
      { sku: 'TDS02-2', rmb: 72, published500: 950 },
      { sku: 'TDR0--3', rmb: 140, published500: 1540 },
    ];

    for (const { sku, rmb, published500 } of matched) {
      const factoryCostThb = rmb * 5;
      const modelled = factoryCostThb * markupFactorFor(factoryCostThb, DEFAULT_PRICING_POLICY);
      const errorPct = Math.abs(modelled - published500) / published500 * 100;
      assert.ok(
        errorPct < 15,
        `${sku}: band table gave ${modelled.toFixed(0)} against a published ${published500} (${errorPct.toFixed(1)}% off)`
      );
    }
  });

  it('rejects a band table that does not end at Infinity', () => {
    assert.throws(
      () =>
        pricingPolicySchema.parse({
          ...DEFAULT_PRICING_POLICY,
          markupBands: [{ maxBasisCostThb: 500, factor: 2.5 }],
        }),
      /must end at Infinity/
    );
  });

  it('rejects bands that are not ascending', () => {
    assert.throws(
      () =>
        pricingPolicySchema.parse({
          ...DEFAULT_PRICING_POLICY,
          markupBands: [
            { maxBasisCostThb: 500, factor: 2.5 },
            { maxBasisCostThb: 250, factor: 3.0 },
            { maxBasisCostThb: Infinity, factor: 2.1 },
          ],
        }),
      /ascending by maxBasisCostThb/
    );
  });
});

describe('Price quote — ladder and minimum-profit floor', () => {
  it('keeps the published ladder shape when it already clears the floor', () => {
    const quote = buildPriceQuote(NORMAL_SKU);

    assert.deepStrictEqual(
      quote.breaks.map((b) => b.quantity),
      [10, 20, 50, 100, 300, 500, 1000]
    );
    // Once the factory's small-order premium, inland freight and screening are all counted, even
    // a mid-priced SKU needs the floor at ten sets. The volume breaks stay on the ladder.
    assert.ok(
      quote.breaks.filter((b) => b.quantity >= 50).every((b) => b.basis === 'ladder'),
      'the volume breaks should still be decided by the published ladder'
    );

    const byQty = new Map(quote.breaks.map((b) => [b.quantity, b.unitPriceThb]));
    // Ladder steps are ~0.90 / 0.85 / 0.80 / 0.75 of the 10-set price, matching the published lists.
    const ten = byQty.get(10)!;
    assert.ok(Math.abs(byQty.get(20)! / ten - 0.9) < 0.02);
    assert.ok(Math.abs(byQty.get(50)! / ten - 0.85) < 0.02);
    assert.ok(Math.abs(byQty.get(100)! / ten - 0.8) < 0.02);
    assert.ok(Math.abs(byQty.get(500)! / ten - 0.75) < 0.02);
  });

  it('raises small-quantity prices to protect the minimum order profit', () => {
    const quote = buildPriceQuote(CHEAP_SKU);
    const byQty = new Map(quote.breaks.map((b) => [b.quantity, b]));

    // At ten sets the factory charges its 1.5x small-order premium, so landed cost is well above
    // the 500-set figure the ladder is anchored on and the floor takes over.
    assert.strictEqual(byQty.get(10)!.basis, 'min_profit_floor');
    assert.strictEqual(byQty.get(10)!.smallOrderFactor, 1.5);
    assert.strictEqual(
      byQty.get(10)!.unitPriceThb,
      roundUpTo(byQty.get(10)!.landedUnitCostThb + 5000 / 10, 10),
      'the ten-set price is the floor: landed cost plus the 5,000 THB minimum spread over ten sets'
    );
    assert.strictEqual(byQty.get(500)!.basis, 'ladder');
    assert.strictEqual(byQty.get(500)!.smallOrderFactor, 1, 'the catalog price is a 500-set price');

    for (const b of quote.breaks) {
      if (b.basis === 'min_profit_floor') {
        assert.ok(
          b.orderGrossProfitThb >= b.minOrderGrossProfitThb,
          `break at ${b.quantity} units returned ${b.orderGrossProfitThb} THB, below its ${b.minOrderGrossProfitThb} floor`
        );
      }
    }
  });

  it('applies the higher 5,000 THB floor only to orders of 20 sets or fewer', () => {
    const quote = buildPriceQuote(CHEAP_SKU);
    const byQty = new Map(quote.breaks.map((b) => [b.quantity, b]));

    assert.strictEqual(byQty.get(10)!.minOrderGrossProfitThb, 5000);
    assert.strictEqual(byQty.get(20)!.minOrderGrossProfitThb, 5000);
    assert.strictEqual(byQty.get(50)!.minOrderGrossProfitThb, 3000);
    assert.strictEqual(byQty.get(1000)!.minOrderGrossProfitThb, 3000);
  });

  it('keeps the ladder in charge at 1,000 sets on the standard profile', () => {
    // The 1.45x corporate multiple lives in its own profile precisely so it cannot leak into a
    // catalog quote and make a bigger order earn less.
    const byQty = new Map(buildPriceQuote(NORMAL_SKU).breaks.map((b) => [b.quantity, b]));
    assert.strictEqual(byQty.get(1000)!.basis, 'ladder');
    assert.ok(
      byQty.get(1000)!.orderGrossProfitThb > byQty.get(500)!.orderGrossProfitThb,
      'a 1,000-set order must earn more than a 500-set one'
    );
  });

  it('holds the corporate price when the freight class changes, so the saving becomes margin', () => {
    /*
     * The whole point of the 1.47 multiple: a cost-plus price would have handed the ทั่วไป freight
     * saving to the customer. The price must stay put and the margin must widen.
     */
    const base = {
      ...NORMAL_SKU,
      factoryCostRmb: 85,
      carton: { unitsPerCarton: 10, cartonCbm: 0.1061 },
      additionalUnitCostThb: 60,
    };
    const account = { ...SMARTGIFT_FREIGHT_ACCOUNT, mode: 'auto' as const, shipMonth: 11 };

    const tisi = buildPriceQuote(
      { ...base, freight: { ...account, goodsClass: 'electronic_tisi' } },
      CORPORATE_VOLUME_POLICY
    );
    const general = buildPriceQuote(
      { ...base, freight: { ...account, goodsClass: 'general' } },
      CORPORATE_VOLUME_POLICY
    );

    const at1000 = (q: typeof tisi) => q.breaks.find((b) => b.quantity === 1000)!;
    assert.strictEqual(
      at1000(general).unitPriceThb,
      at1000(tisi).unitPriceThb,
      'the published price must not move with the freight class'
    );
    assert.ok(
      at1000(general).orderGrossProfitThb > at1000(tisi).orderGrossProfitThb,
      'the freight saving must land in margin instead'
    );
  });

  it('steps the corporate profile down by quantity, like the standard one', () => {
    const quote = buildPriceQuote({ ...NORMAL_SKU, factoryCostRmb: 100 }, CORPORATE_VOLUME_POLICY);

    assert.deepStrictEqual(
      quote.breaks.map((b) => b.quantity),
      [100, 300, 500, 1000]
    );

    // A ladder, not one flat price: each larger break is cheaper per set than the last.
    for (let i = 1; i < quote.breaks.length; i++) {
      assert.ok(
        quote.breaks[i].unitPriceThb < quote.breaks[i - 1].unitPriceThb,
        `${quote.breaks[i].quantity} sets should undercut ${quote.breaks[i - 1].quantity}`
      );
    }

    // Every break still has to clear its own floor, whichever rule set the price.
    for (const b of quote.breaks) {
      assert.ok(
        b.orderGrossProfitThb >= b.minOrderGrossProfitThb,
        `${b.quantity} sets returned ${b.orderGrossProfitThb} against a ${b.minOrderGrossProfitThb} floor`
      );
    }
  });

  it('reports a profit inversion rather than leaving it for the reader to spot', () => {
    // Force the contradiction: the corporate multiple inside the standard ladder.
    const quote = buildPriceQuote(
      { ...NORMAL_SKU, factoryCostRmb: 125 },
      {
        ...DEFAULT_PRICING_POLICY,
        volumeMarkupOverrides: [{ quantity: 1000, markupFactor: 1.45, minBasisCostThb: 0 }],
      }
    );

    const at500 = quote.breaks.find((b) => b.quantity === 500)!;
    const at1000 = quote.breaks.find((b) => b.quantity === 1000)!;
    assert.ok(at1000.orderGrossProfitThb < at500.orderGrossProfitThb, 'the inversion is real');
    assert.ok(quote.warnings.some((w) => w.includes('earns LESS than one of')));
  });

  it('never publishes a price below the floor it just computed', () => {
    for (const sku of [CHEAP_SKU, NORMAL_SKU]) {
      const quote = buildPriceQuote(sku);
      for (const b of quote.breaks) {
        assert.ok(
          b.unitPriceThb >= b.floorPriceThb,
          `${quote.sku} @ ${b.quantity}: published ${b.unitPriceThb} < floor ${b.floorPriceThb}`
        );
      }
    }
  });

  it('never publishes a higher unit price at a larger quantity', () => {
    for (const sku of [CHEAP_SKU, NORMAL_SKU]) {
      const quote = buildPriceQuote(sku);
      for (let i = 1; i < quote.breaks.length; i++) {
        assert.ok(
          quote.breaks[i].unitPriceThb <= quote.breaks[i - 1].unitPriceThb,
          `${quote.sku}: price rose from ${quote.breaks[i - 1].quantity} to ${quote.breaks[i].quantity} units`
        );
      }
    }
  });

  it('subtracts per-order costs before checking the profit floor', () => {
    const withSetup = buildPriceQuote({ ...CHEAP_SKU, additionalOrderCostThb: 1500 });
    const floored = withSetup.breaks.filter((b) => b.basis === 'min_profit_floor');

    assert.ok(floored.length > 0);
    for (const b of floored) {
      assert.ok(
        b.orderGrossProfitThb >= 3000,
        `${b.quantity} units returned ${b.orderGrossProfitThb} THB net of the 1,500 THB setup cost`
      );
    }
  });

  it('warns when the carton weight is missing', () => {
    const quote = buildPriceQuote({
      ...NORMAL_SKU,
      carton: { unitsPerCarton: 20, cartonCbm: 0.11 },
    });
    assert.ok(quote.warnings.some((w) => w.includes('Carton weight was not supplied')));
    assert.ok(!buildPriceQuote(NORMAL_SKU).warnings.some((w) => w.includes('Carton weight')));
  });

  it('records which markup band decided the anchor price', () => {
    const quote = buildPriceQuote(NORMAL_SKU); // 45 RMB x 5 = 225 THB factory cost
    assert.ok(quote.breaks.every((b) => b.markupFactor === 3.0));

    const dear = buildPriceQuote({ ...NORMAL_SKU, factoryCostRmb: 180 }); // 900 THB
    assert.ok(dear.breaks.every((b) => b.markupFactor === 2.14));
  });

  it('does not double-count freight: factory_cost basis ignores it, landed_cost basis does not', () => {
    const onFactory = buildPriceQuote(NORMAL_SKU);
    const onLanded = buildPriceQuote(NORMAL_SKU, {
      ...DEFAULT_PRICING_POLICY,
      markupBasis: 'landed_cost',
    });

    const anchorFactory = onFactory.breaks[onFactory.breaks.length - 1].unitPriceThb;
    const anchorLanded = onLanded.breaks[onLanded.breaks.length - 1].unitPriceThb;
    assert.ok(
      anchorLanded > anchorFactory,
      'multiplying a landed cost must give more than multiplying the factory cost alone'
    );
  });

  it('warns when packaging or setup cost was left out', () => {
    const bare = buildPriceQuote(NORMAL_SKU);
    assert.ok(bare.warnings.some((w) => w.includes('No gift box, bag or domestic delivery')));

    const complete = buildPriceQuote({
      ...NORMAL_SKU,
      additionalUnitCostThb: 35,
      additionalOrderCostThb: 800,
    });
    assert.ok(!complete.warnings.some((w) => w.includes('No gift box, bag')));
  });

  it('warns when no logo method is chosen at all', () => {
    const none = buildPriceQuote({ ...NORMAL_SKU, logo: { method: 'none' } });
    assert.ok(none.warnings.some((w) => w.includes('No logo method was chosen')));
    assert.ok(none.breaks.every((b) => b.logoCostThb === 0));

    const flat = buildPriceQuote(NORMAL_SKU);
    assert.ok(!flat.warnings.some((w) => w.includes('No logo method was chosen')));
  });

  it('warns about the unconfirmed small-order premium wherever it applies', () => {
    const quote = buildPriceQuote(NORMAL_SKU);
    assert.ok(quote.warnings.some((w) => w.includes('small-order premium')));
    assert.ok(quote.warnings.some((w) => w.includes('1.1 - 1.5 times price')));
  });

  it('carries freight-rate provenance on every quote', () => {
    const quote = buildPriceQuote(NORMAL_SKU, DEFAULT_PRICING_POLICY, '2026-08-11T00:00:00.000Z');

    assert.strictEqual(quote.asOf, '2026-08-11T00:00:00.000Z');
    assert.match(quote.freightRateProvenance.source, /LK-กวางโจว/);
    assert.strictEqual(quote.freightRateProvenance.asOf, '2026-07-27');
  });
});

describe('Rounding', () => {
  it('always rounds up, so a floored price cannot slip back below the floor', () => {
    assert.strictEqual(roundUpTo(402, 10), 410);
    assert.strictEqual(roundUpTo(405, 10), 410);
    assert.strictEqual(roundUpTo(401, 10), 410);
    assert.strictEqual(roundUpTo(400, 10), 400, 'an exact multiple stays put');
  });

  it('does not round an exact multiple up a whole step on floating-point drift', () => {
    // 4.35 / 0.05 is 86.99999... in binary floating point; a naive Math.ceil would return 4.40.
    assert.strictEqual(roundUpTo(4.35, 0.05), 4.35);
    assert.strictEqual(roundUpTo(573.4 * 100, 10), 57340);
  });
});

describe('Policy validation', () => {
  it('rejects a ladder with the wrong number of factors', () => {
    assert.throws(
      () => pricingPolicySchema.parse({ ...DEFAULT_PRICING_POLICY, ladderFactors: [1.0, 0.8] }),
      /one entry per quantity break/
    );
  });

  it('rejects quantity breaks that are not ascending', () => {
    assert.throws(
      () => pricingPolicySchema.parse({ ...DEFAULT_PRICING_POLICY, quantityBreaks: [10, 500, 50, 100, 20] }),
      /strictly ascending/
    );
  });

  it('rejects a carton spec with zero units', () => {
    assert.throws(() =>
      buildPriceQuote({ ...CHEAP_SKU, carton: { ...CHEAP_SKU.carton, unitsPerCarton: 0 } })
    );
  });
});

describe('CLI price quote', () => {
  it('builds a quote from flags', () => {
    const quote = runPriceQuote({
      sku: 'TEST-CLI',
      rmb: '15',
      fx: '5',
      'units-per-carton': '50',
      'carton-cbm': '0.05',
      'carton-kg': '6',
    });

    assert.strictEqual(quote.sku, 'TEST-CLI');
    assert.strictEqual(quote.freight.mode, 'auto', 'defaults to the seasonal routing rule');
    assert.strictEqual(quote.freight.warehouse, 'guangzhou_shenzhen');
    assert.strictEqual(quote.freight.membershipTier, 'silver');
    assert.strictEqual(
      quote.freight.goodsClass,
      'electronic_tisi',
      'gift sets carry electronics unless --no-electronics says otherwise'
    );
    assert.strictEqual(quote.breaks.length, 7);
  });

  it('takes the cheaper general rate with --no-electronics', () => {
    const flags = {
      sku: 'TEST-CLI',
      rmb: '15',
      fx: '5',
      'units-per-carton': '50',
      'carton-cbm': '0.05',
      'ship-month': '11',
    };
    const withElectronics = runPriceQuote(flags);
    const without = runPriceQuote({ ...flags, 'no-electronics': true });

    assert.strictEqual(without.freight.goodsClass, 'general');
    assert.ok(
      without.anchorLandedUnitCost.freight.orderFreightThb <
        withElectronics.anchorLandedUnitCost.freight.orderFreightThb
    );
  });

  it('names every missing required flag at once', () => {
    assert.throws(
      () => runPriceQuote({ sku: 'X' }),
      /--rmb, --fx, --units-per-carton, --carton-cbm/
    );
  });

  it('rejects an unknown enum value instead of falling back to a default', () => {
    assert.throws(
      () =>
        runPriceQuote({
          sku: 'X',
          rmb: '15',
          fx: '5',
          'units-per-carton': '50',
          'carton-cbm': '0.05',
          'carton-kg': '6',
          warehouse: 'bangkok',
        }),
      /--warehouse must be one of/
    );
  });

  it('rejects a non-numeric cost', () => {
    assert.throws(
      () =>
        runPriceQuote({
          sku: 'X',
          rmb: 'cheap',
          fx: '5',
          'units-per-carton': '50',
          'carton-cbm': '0.05',
          'carton-kg': '6',
        }),
      /--rmb must be a number/
    );
  });
});

describe('Lead time and the mode it forces', () => {
  it('reproduces the owner\'s own rule of thumb: 15-20 days by road, 40 by sea', () => {
    // A rush order by road, 500 sets: 2 artwork + 7 production + 7-10 freight.
    const rushTruck = leadTimeFor(500, 'truck', true);
    assert.deepStrictEqual([rushTruck.minDays, rushTruck.maxDays], [16, 19]);

    // The full path by sea, 500 sets: 2 + 3-5 sample + 7 + 21-30.
    const sea = leadTimeFor(500, 'sea', false);
    assert.deepStrictEqual([sea.minDays, sea.maxDays], [33, 44]);
  });

  it('runs production longer past 500 sets', () => {
    assert.deepStrictEqual(productionDays(500), [7, 7]);
    assert.deepStrictEqual(productionDays(501), [15, 15]);
    assert.ok(leadTimeFor(1000, 'truck').maxDays > leadTimeFor(500, 'truck').maxDays);
  });

  it('drops the sample stage on a rush order', () => {
    assert.ok(leadTimeFor(200, 'truck', false).stages.some((s) => s.key === 'sample'));
    assert.ok(!leadTimeFor(200, 'truck', true).stages.some((s) => s.key === 'sample'));
  });

  it('picks the cheapest mode the deadline still allows', () => {
    // Plenty of time: sea, because it is cheaper.
    assert.strictEqual(modeForDeadline(500, 60).mode, 'sea');
    // 30 days rules sea out but the full road path fits.
    const road = modeForDeadline(500, 30);
    assert.strictEqual(road.mode, 'truck');
    assert.match(road.reason, /ไม่พอสำหรับทางเรือ/);
  });

  it('offers the rush path before declaring a deadline impossible', () => {
    const rush = modeForDeadline(500, 20);
    assert.strictEqual(rush.mode, 'truck');
    assert.strictEqual(rush.leadTime.rush, true);
    assert.match(rush.reason, /งานเร่ง/);
  });

  it('says plainly when no route can make the date', () => {
    const impossible = modeForDeadline(1000, 10);
    assert.strictEqual(impossible.mode, null);
    assert.match(impossible.reason, /ต้องขยับกำหนดส่งหรือลดจำนวน/);
  });

  it('judges a deadline on the worst case, not the optimistic end', () => {
    // 33 days is inside sea's 33-44 range at its fastest, but promising that would miss.
    assert.strictEqual(modeForDeadline(500, 33).mode, 'truck');
    assert.strictEqual(modeForDeadline(500, 44).mode, 'sea');
  });
});
