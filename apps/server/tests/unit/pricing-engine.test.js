// @req FR-253 — exact money, source import, typed formulas and floor enforcement.
// @spec ADR-098
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { calculatePrice, calculatePricingCustomization, validatePricingRules, validatePricingFormula, pricingHash, Decimal } from '../../src/modules/commerce/domain/pricing-engine'
import { fixtureRules } from '../../../../services/scm/test/support/pricing-rules-fixture.js'

const vectorsPath = fileURLToPath(new URL('../fixtures/pricing-engine-vectors.json', import.meta.url))

const factory = (extra = {}) => ({ costBasis: 'factory', quantity: 100, kind: 'set', profile: 'standard', factoryUnitCost: { amount: '32', currency: 'CNY' }, carton: { units: 20, cbm: '0.1', kg: null }, shipping: { warehouse: 'guangzhou_shenzhen', mode: 'auto', month: 4, goodsType: 'general', tier: 'GOLD', domesticMode: 'none' }, logo: { method: 'none', positions: 1, colors: 1 }, extraUnitCostThb: '0', orderCostThb: '0', sourceRefs: [{ sourceId: 'test-cost', sha256: 'a'.repeat(64) }], ...extra })
const landed = (extra = {}) => ({ costBasis: 'landed', quantity: 100, kind: 'set', profile: 'corporate', landedUnitCostThb: '100', orderCostThb: '0', sourceRefs: [], ...extra })
const failure = (fn, field) => { try { fn(); throw new Error('Expected rejection') } catch (e) { expect(e.status).toBe(422); if (field) expect(e.field).toContain(field) } }

describe('pricing rule schema', () => {
  it('validates the invented fixture, keeps independent currencies and never aliases the template', () => {
    const r = fixtureRules()
    expect(validatePricingRules(structuredClone(r)).fx).toEqual({ cnyToThb: '2', usdToThb: '10' })
    expect(r.provenance.sources.fixture.level).toBe('undocumented')
    r.fx.usdToThb = '99'
    expect(fixtureRules().fx.usdToThb).toBe('10')
  })
  it('fails closed on unknown fields, malformed rates, tables, missing config and unsafe JSON', () => {
    failure(() => validatePricingRules(null))
    failure(() => validatePricingRules({ ...fixtureRules(), eval: 'bad' }), 'eval')
    const r = fixtureRules(); delete r.logistics.rates.yiwu.sea.general.GOLD.kg
    failure(() => validatePricingRules(r), 'kg')
    r.logistics.rates.yiwu.sea.general.GOLD.kg = '-1'
    failure(() => validatePricingRules(r), 'kg')
    const bad = fixtureRules(); bad.quantityFloors.reverse()
    failure(() => validatePricingRules(bad), 'quantityFloors')
    failure(() => validatePricingRules(JSON.parse('{"__proto__":{}}')))
  })
})

describe('bounded typed formula language', () => {
  const step = (expression) => [{ name: 'candidatePrice', expression, unit: 'THB/unit' }]
  it('orders a DAG, evaluates safe functions and protects the mandatory floor', () => {
    const r = fixtureRules()
    r.formulas = [{ name: 'candidatePrice', expression: 'ceilToStep(max(subprice, landedCost), priceStep)', unit: 'THB/unit' }, { name: 'subprice', expression: 'anchorPrice * quantityBand(quantity)', unit: 'THB/unit' }]
    expect(validatePricingFormula(r.formulas).map((s) => s.name)).toEqual(['subprice', 'candidatePrice'])
    expect(calculatePrice(r, landed()).unitPriceSatang).toBeGreaterThanOrEqual(15000)
    r.formulas = step('landedCost * 0')
    const result = calculatePrice(r, landed())
    expect(result.unitPriceSatang).toBe(15000)
    expect(result.grossProfitSatang).toBe(500000)
    expect(result.priceDriver).toBe('FLOOR')
  })
  it.each(['process.exit()', 'fetch(1)', 'anchorPrice[0]', 'anchorPrice.constructor', 'new Function(1)', 'anchorPrice; 1', '`${anchorPrice}`', 'unknownPrice * 2', 'landedCost + quantity', 'landedCost + fxUsd', 'Math.max(landedCost, anchorPrice)', 'min(landedCost)', 'anchorPrice ** 2'])('rejects %s', (s) => failure(() => validatePricingFormula(step(s))))
  it('rejects cycles, duplicate/reserved variables, oversized expressions and division by zero', () => {
    failure(() => validatePricingFormula([{ name: 'candidatePrice', expression: 'other', unit: 'THB/unit' }, { name: 'other', expression: 'candidatePrice', unit: 'THB/unit' }]), 'formulas')
    failure(() => validatePricingFormula([{ name: 'quantity', expression: '1', unit: 'ratio' }]))
    failure(() => validatePricingFormula(step('('.repeat(40) + 'anchorPrice' + ')'.repeat(40))))
    failure(() => validatePricingFormula(step('anchorPrice' + ' * 1'.repeat(300))))
    failure(() => validatePricingFormula(step('anchorPrice / (1 - 1)')), 'formulas')
    failure(() => validatePricingFormula([{ name: 'constructor', expression: 'anchorPrice', unit: 'THB/unit' }, ...step('anchorPrice')]))
    const r = fixtureRules(); r.formulas = step('anchorPrice / (factor - factor)')
    failure(() => calculatePrice(r, landed()), 'formulas')
    r.formulas = step('-landedCost')
    failure(() => calculatePrice(r, landed()))
  })
  it('uses exact decimals and ceil at real satang boundaries', () => {
    expect(Decimal.from('0.1').add('0.2').text(2)).toBe('0.30')
    expect(Decimal.from('0.125').satang()).toBe(13)
    expect(Decimal.from('420.000000000001').ceilStep('10').text(2)).toBe('430.00')
    failure(() => Decimal.from(Infinity))
  })
})

describe('factory and trusted landed paths', () => {
  it('produces reproducible hashes, exact floors, provenance, and no mutation', () => {
    const rules = fixtureRules(), input = factory(), before = JSON.stringify({ rules, input })
    const result = calculatePrice(rules, input)
    expect(result).toEqual(calculatePrice(rules, input))
    expect(result.ruleHash).toBe(pricingHash(validatePricingRules(rules)))
    expect(result.provenance.sourceRefs).toEqual(input.sourceRefs)
    expect(JSON.stringify({ rules, input })).toBe(before)
    expect(result.breakdown.profitFloorSatang).toBe(500000)
    expect(result.grossProfitSatang).toBeGreaterThanOrEqual(500000)
    expect(result.unitPriceSatang % 500).toBe(0)
  })
  it('never double-adds freight on already-landed input or silently changes basis', () => {
    const result = calculatePrice(fixtureRules(), landed())
    expect(result.unitLandedCostSatang).toBe(10000)
    expect(result.breakdown.freightUnitSatang).toBe(0)
    expect(result.breakdown.domesticUnitSatang).toBe(0)
    expect(result.warnings.map((w) => w.code)).toContain('TRUSTED_LANDED_INPUT')
    failure(() => calculatePrice(fixtureRules(), landed({ shipping: factory().shipping })), 'shipping')
    failure(() => calculatePrice(fixtureRules(), landed({ profile: 'standard' })), 'profile')
  })
  it('absorbs explicit single-drop costs rounded up and rejects missing inputs', () => {
    const i = factory({ quantity: 300 }); i.shipping.domesticMode = 'single_drop'
    const result = calculatePrice(fixtureRules(), i)
    expect(result.breakdown.domesticUnitSatang).toBe(334)
    for (const value of [0, -1, 1.5, null]) failure(() => calculatePrice(fixtureRules(), factory({ quantity: value })), 'quantity')
    failure(() => calculatePrice(fixtureRules(), factory({ quantity: 11 })), 'quantity')
    failure(() => calculatePrice(fixtureRules(), factory({ factoryUnitCost: { amount: '0', currency: 'CNY' } })), 'factoryUnitCost')
    const missing = factory(); delete missing.shipping.domesticMode
    failure(() => calculatePrice(fixtureRules(), missing), 'domesticMode')
  })
  it('selects rate cells, density switch, volume threshold and seasonal auto mode', () => {
    const r = fixtureRules(), i = factory({ quantity: 1000, carton: { units: 10, cbm: '0.1', kg: '50' } })
    let result = calculatePrice(r, i)
    expect(result.breakdown.shipping.mode).toBe('sea')
    expect(result.breakdown.shipping.chargedBy).toBe('weight')
    expect(result.breakdown.freightUnitSatang).toBe(4000)
    i.shipping.month = 11
    result = calculatePrice(r, i)
    expect(result.breakdown.shipping.mode).toBe('truck')
    expect(result.breakdown.freightUnitSatang).toBe(3000)
    r.logistics.forceTruckInPeak = false
    expect(calculatePrice(r, i).breakdown.shipping.mode).toBe('sea')
    i.carton.kg = '10'
    expect(calculatePrice(r, i).breakdown.shipping.chargedBy).toBe('weight')
    i.carton.kg = '9.999'
    expect(calculatePrice(r, i).breakdown.shipping.chargedBy).toBe('volume')
  })
  it('uses independent FX and enforces kind floor (intentional legacy corrections)', () => {
    const r = fixtureRules(), i = factory({ factoryUnitCost: { amount: '1', currency: 'USD' }, quantity: 500 })
    expect(calculatePrice(r, i).breakdown.factoryUnitSatang).toBe(1000)
    r.fx.cnyToThb = '9'
    expect(calculatePrice(r, i).breakdown.factoryUnitSatang).toBe(1000)
    expect(calculatePrice(r, landed()).breakdown.profitFloorSatang).toBe(500000)
    expect(calculatePrice(r, landed({ kind: 'single' })).breakdown.profitFloorSatang).toBe(70000)
  })
})

describe('customization and lead times', () => {
  it.each([
    ['none', 100, 0, 0], ['flat', 100, 0, 50000], ['hotstamp', 100, 2000, 0],
    ['hotstamp', 300, 2000, 20000], ['hotstamp_text', 100, 1000, 0],
    ['engrave', 100, 0, 10000], ['silk', 100, 3000, 0], ['silk', 500, 0, 25000],
  ])('%s costs at quantity %i preserve setup and run', (method, quantity, setupSatang, runSatang) => {
    const result = calculatePricingCustomization(fixtureRules(), { quantity, method, positions: 1, colors: 1 })
    expect(result.setupSatang).toBe(setupSatang); expect(result.runSatang).toBe(runSatang)
    expect(result.perUnitSatang).toBe(Math.ceil((setupSatang + runSatang) / quantity))
  })
  it('does not fabricate UV rates and applies explicit overrides', () => {
    failure(() => calculatePricingCustomization(fixtureRules(), { quantity: 100, method: 'uv', positions: 1, colors: 1 }), 'uvRateUsd')
    expect(calculatePricingCustomization(fixtureRules(), { quantity: 100, method: 'uv', positions: 2, colors: 1, uvRateUsd: '.1' }).totalSatang).toBe(20000)
    failure(() => calculatePricingCustomization(fixtureRules(), { quantity: 100, method: 'invented', positions: 1, colors: 1 }))
  })
  it('derives logo positions only from provided code and reports working-day risks', () => {
    const i = factory({ productCode: 'TMS06-4', logo: { method: 'flat', positions: null, colors: 1 }, deadlineDays: 1 })
    const r = fixtureRules()
    expect(calculatePrice(r, i).breakdown.logoUnitSatang).toBe(3000)
    r.logoPositions.extraPositions = 3
    expect(calculatePrice(r, i).breakdown.logoUnitSatang).toBe(3500)
    expect(calculatePrice(r, i).warnings.map((w) => w.code)).toContain('DEADLINE_RISK')
    const standard = calculatePrice(r, i).breakdown.leadTimeWorkingDays
    expect(calculatePrice(r, { ...i, rush: true }).breakdown.leadTimeWorkingDays.max).toBe(standard.max - r.leadTime.sample.max)
    delete i.productCode
    failure(() => calculatePrice(r, i), 'productCode')
  })
})

const VECTOR_CASES = [
  { name: 'volume_truck', profile: 'standard', method: 'none', month: 11, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'volume_sea', profile: 'corporate', method: 'none', month: 4, cbm: 0.2, kg: null, quantities: [100, 300, 500, 1000] },
  { name: 'weight', profile: 'standard', method: 'flat', month: 4, cbm: 0.1, kg: 50, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'hotstamp', profile: 'standard', method: 'hotstamp', month: 4, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'hotstamp_text', profile: 'standard', method: 'hotstamp_text', month: 4, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'engrave', profile: 'standard', method: 'engrave', month: 4, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'silk', profile: 'standard', method: 'silk', month: 4, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
  { name: 'uv', profile: 'standard', method: 'uv', month: 4, cbm: 0.1, kg: null, quantities: [10, 20, 50, 100, 300, 500, 1000] },
]
const vectorInput = (c, quantity) => {
  const i = factory({ quantity, kind: 'single', profile: c.profile, carton: { units: 20, cbm: String(c.cbm), kg: c.kg === null ? null : String(c.kg) }, logo: { method: c.method, positions: 1, colors: 1, rateThb: '10', uvRateUsd: '.1' } })
  i.shipping.month = c.month
  return i
}
const computeVectors = () => VECTOR_CASES.map((c) => ({
  ...c,
  rows: c.quantities.map((quantity) => {
    const r = calculatePrice(fixtureRules(), vectorInput(c, quantity))
    return { quantity, unitPriceSatang: r.unitPriceSatang, unitLandedCostSatang: r.unitLandedCostSatang }
  }),
}))

describe('engine regression vectors (generated from the invented fixture)', () => {
  // WRITE_PRICING_VECTORS=1 re-records tests/fixtures/pricing-engine-vectors.json from this engine.
  if (process.env.WRITE_PRICING_VECTORS === '1') writeFileSync(vectorsPath, JSON.stringify({ schema: 'pricing-engine-vectors.v1', cases: computeVectors() }, null, 2) + '\n')
  const recorded = JSON.parse(readFileSync(vectorsPath, 'utf8'))
  it('covers every logo method, both profiles and both shipping modes', () => {
    expect(recorded.cases.map((c) => c.name)).toEqual(VECTOR_CASES.map((c) => c.name))
    expect(new Set(recorded.cases.map((c) => c.method))).toEqual(new Set(['none', 'flat', 'hotstamp', 'hotstamp_text', 'engrave', 'silk', 'uv']))
  })
  it.each(VECTOR_CASES.flatMap((c) => c.quantities.map((quantity) => ({ c, quantity }))))('$c.name at $quantity reproduces the recorded vector', ({ c, quantity }) => {
    const row = recorded.cases.find((x) => x.name === c.name).rows.find((x) => x.quantity === quantity)
    const result = calculatePrice(fixtureRules(), vectorInput(c, quantity))
    expect({ quantity, unitPriceSatang: result.unitPriceSatang, unitLandedCostSatang: result.unitLandedCostSatang }).toEqual(row)
  })
})

describe('rounding corrections are exact', () => {
  it('does not reproduce a floating-point step tolerance', () => {
    const r = fixtureRules(); r.formulas[0].expression = 'landedCost * 4.200000000001'
    const result = calculatePrice(r, landed({ kind: 'single', quantity: 1000 }))
    expect(result.unitPriceSatang).toBe(42500)
    // A float-tolerant ceil(round(value/step,6))*step would give 420 THB, discarding a real fraction.
  })
  it('ceils a fractional satang instead of rounding it down', () => {
    expect(Decimal.from('0.125').satang()).toBe(13)
  })
})

describe('editable variable groups are operative', () => {
  it('all 32 freight rate cells affect the selected shipment, without a fallback', () => {
    for (const warehouse of ['guangzhou_shenzhen', 'yiwu']) for (const mode of ['truck', 'sea']) for (const goodsType of ['general', 'electronic_tisi']) for (const membership of ['ELITE', 'GOLD', 'SILVER', 'MEMBER']) {
      const r = fixtureRules(), i = factory({ quantity: 1000 })
      Object.assign(i.shipping, { warehouse, mode, goodsType, tier: membership })
      const before = calculatePrice(r, i)
      r.logistics.rates[warehouse][mode][goodsType][membership].cbm = '9999'
      expect(calculatePrice(r, i).breakdown.freightUnitSatang).not.toBe(before.breakdown.freightUnitSatang)
      i.carton.kg = '50'
      const weightBefore = calculatePrice(r, i)
      r.logistics.rates[warehouse][mode][goodsType][membership].kg = '99'
      expect(calculatePrice(r, i).breakdown.freightUnitSatang).not.toBe(weightBefore.breakdown.freightUnitSatang)
    }
  })
  it('changes prices/costs when profiles, markup, floors, factors and rounding change', () => {
    const r = fixtureRules(), i = factory({ quantity: 500, kind: 'single' })
    const baseline = calculatePrice(r, i)
    r.markupBands[0].multiplier = '4'
    expect(calculatePrice(r, i).unitPriceSatang).toBeGreaterThan(baseline.unitPriceSatang)
    r.profiles.standard.flatMarkup = '5'
    expect(calculatePrice(r, i).breakdown.appliedMarkup).toBe('5.0000')
    r.profiles.standard.factors[5] = '.9'
    expect(calculatePrice(r, factory({ quantity: 1000, kind: 'single' })).unitPriceSatang).not.toBe(calculatePrice(fixtureRules(), factory({ quantity: 1000, kind: 'single' })).unitPriceSatang)
    r.quantityFloors[1].thb = '100000'
    expect(calculatePrice(r, i).grossProfitSatang).toBeGreaterThanOrEqual(10000000)
    r.rounding.priceStepThb = '7'
    expect(calculatePrice(r, i).unitPriceSatang % 700).toBe(0)
    r.smallOrderFactors[r.smallOrderFactors.length - 1].factor = '2'
    expect(calculatePrice(r, i).breakdown.factoryUnitSatang).toBe(12800)
  })
  it('updates cost, shipping, profit target and lead-time warnings from supported groups', () => {
    const r = fixtureRules(), i = factory()
    const baseline = calculatePrice(r, i)
    r.logistics.minCbm = '1'
    expect(calculatePrice(r, i).breakdown.freightUnitSatang).toBeGreaterThan(baseline.breakdown.freightUnitSatang)
    r.logistics.inlandCnyPerUnit = '3'
    expect(calculatePrice(r, i).breakdown.inlandUnitSatang).toBe(600)
    r.leadTime.artwork.max = 20
    expect(calculatePrice(r, i).breakdown.leadTimeWorkingDays.max).toBeGreaterThan(baseline.breakdown.leadTimeWorkingDays.max)
    const li = landed({ kind: 'single', quantity: 1000 })
    r.profiles.corporate.targetProfitThb = '10000000'
    r.profiles.corporate.marginWarningBand = { minPercent: '99', maxPercent: '100' }
    expect(calculatePrice(r, li).warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['BELOW_PROFIT_TARGET', 'MARGIN_OUTSIDE_PROFILE']))
    const ref = factory({ profile: 'corporate' })
    const oldPrice = calculatePrice(r, ref).breakdown.candidateUnitSatang
    r.profiles.corporate.referenceGoodsType = 'general'
    expect(calculatePrice(r, ref).breakdown.candidateUnitSatang).not.toBe(oldPrice)
  })
})
