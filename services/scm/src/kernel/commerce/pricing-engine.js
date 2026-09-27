import { Decimal, pricingError, validatePricingFormula, evaluatePricingFormula } from './pricing-formula.js'
import { validatePricingRules, pricingHash, plainJson, exact, decimal, integer, choice } from './pricing-rules.js'

// @req FR-253 — one deterministic Commerce calculator for preview and runtime.
// @spec ADR-098
// @tested tests/unit/pricing-engine.test.js

export { defaultPricingRules, importPricingRulesYaml, validatePricingRules, pricingHash } from './pricing-rules.js'
export { PRICING_VARIABLES, validatePricingFormula, Decimal } from './pricing-formula.js'
export const EVALUATOR_VERSION = 'pricing.v1'
export const PRICE_DRIVERS = Object.freeze({ LADDER: 'LADDER', FLOOR: 'FLOOR', MANUAL: 'MANUAL' })
export const decimalToSatang = (value) => Decimal.from(value).satang()
const D = Decimal.from
const moneyUp = (value) => D(value).ceilStep('0.01')
const max = (a, b) => D(a).cmp(b) >= 0 ? D(a) : D(b)
const tier = (rows, qty, key) => D(rows.find((row) => row.maxQty === null || D(qty).cmp(row.maxQty) <= 0)[key])
const warn = (code, message) => ({ code, message })

export function normalizePricingInput(input) {
  const i = plainJson(input, 'input')
  if (JSON.stringify(i).length > 32000) throw pricingError('Input size limit exceeded', 'input')
  const shared = ['costBasis', 'quantity', 'kind', 'profile', 'orderCostThb', 'sourceRefs']
  choice(i.costBasis, ['factory', 'landed'], 'input.costBasis')
  exact(i, [...shared, ...(i.costBasis === 'factory' ? ['factoryUnitCost', 'carton', 'shipping', 'logo', 'extraUnitCostThb'] : ['landedUnitCostThb'])], 'input', ['productCode', 'rush', 'deadlineDays'])
  integer(i.quantity, 'input.quantity'); choice(i.kind, ['set', 'single'], 'input.kind'); choice(i.profile, ['standard', 'corporate'], 'input.profile')
  i.orderCostThb = decimal(i.orderCostThb, 'input.orderCostThb')
  if (!Array.isArray(i.sourceRefs) || i.sourceRefs.length > 32) throw pricingError('Expected source reference array', 'input.sourceRefs')
  for (const [index, ref] of i.sourceRefs.entries()) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw pricingError('Expected source reference object', `input.sourceRefs.${index}`)
  }
  if (i.productCode !== undefined && (typeof i.productCode !== 'string' || !i.productCode.trim() || i.productCode.length > 100)) throw pricingError('Invalid product code', 'input.productCode')
  if (i.rush !== undefined && typeof i.rush !== 'boolean') throw pricingError('Expected boolean', 'input.rush')
  if (i.deadlineDays !== undefined && i.deadlineDays !== null) integer(i.deadlineDays, 'input.deadlineDays', 1, 365)
  if (i.costBasis === 'landed') {
    i.landedUnitCostThb = decimal(i.landedUnitCostThb, 'input.landedUnitCostThb', true)
    if (D(i.landedUnitCostThb).mul(100).d !== 1n) throw pricingError('Trusted ledger cost must be whole satang', 'input.landedUnitCostThb')
    return i
  }
  exact(i.factoryUnitCost, ['amount', 'currency'], 'input.factoryUnitCost')
  i.factoryUnitCost.amount = decimal(i.factoryUnitCost.amount, 'input.factoryUnitCost.amount', true)
  choice(i.factoryUnitCost.currency, ['CNY', 'USD', 'THB'], 'input.factoryUnitCost.currency')
  exact(i.carton, ['units', 'cbm', 'kg'], 'input.carton')
  integer(i.carton.units, 'input.carton.units')
  i.carton.cbm = decimal(i.carton.cbm, 'input.carton.cbm', true)
  if (i.carton.kg !== null) i.carton.kg = decimal(i.carton.kg, 'input.carton.kg', true)
  exact(i.shipping, ['warehouse', 'mode', 'month', 'goodsType', 'tier', 'domesticMode'], 'input.shipping')
  choice(i.shipping.warehouse, ['guangzhou_shenzhen', 'yiwu'], 'input.shipping.warehouse')
  choice(i.shipping.mode, ['auto', 'truck', 'sea'], 'input.shipping.mode')
  choice(i.shipping.goodsType, ['general', 'electronic_tisi'], 'input.shipping.goodsType')
  choice(i.shipping.tier, ['ELITE', 'GOLD', 'SILVER', 'MEMBER'], 'input.shipping.tier')
  choice(i.shipping.domesticMode, ['single_drop', 'none'], 'input.shipping.domesticMode')
  integer(i.shipping.month, 'input.shipping.month', 1, 12)
  i.extraUnitCostThb = decimal(i.extraUnitCostThb, 'input.extraUnitCostThb')
  exact(i.logo, ['method', 'positions', 'colors'], 'input.logo', ['rateThb', 'uvRateUsd'])
  validateLogoInput(i.logo)
  return i
}

function validateLogoInput(input) {
  choice(input.method, ['none', 'flat', 'hotstamp', 'hotstamp_text', 'engrave', 'silk', 'uv'], 'input.logo.method')
  if (input.positions !== null) integer(input.positions, 'input.logo.positions', 1, 100)
  integer(input.colors, 'input.logo.colors', 1, 100)
  if (input.rateThb !== undefined) input.rateThb = decimal(input.rateThb, 'input.logo.rateThb')
  if (input.uvRateUsd !== undefined) input.uvRateUsd = decimal(input.uvRateUsd, 'input.logo.uvRateUsd', true)
}

function logoCost(rules, input, quantity) {
  const m = rules.logo, p = input.positions, colors = input.colors, q = D(quantity)
  let setup = D(0), run = D(0)
  if (input.method === 'flat') run = moneyUp(input.rateThb ?? m.flatThbPerPosition).mul(q).mul(p)
  else if (input.method === 'hotstamp') {
    setup = moneyUp(D(m.hotstampSetupUsd).mul(rules.fx.usdToThb)).mul(p)
    run = moneyUp(tier(m.hotstampTiers, quantity, 'usd').mul(rules.fx.usdToThb)).mul(max(0, q.sub(m.hotstampBaseQty))).mul(p)
  } else if (input.method === 'hotstamp_text') setup = moneyUp(D(m.hotstampTextUsd).mul(rules.fx.usdToThb)).mul(p)
  else if (input.method === 'engrave') run = moneyUp(tier(m.engraveTiers, quantity, 'usd').mul(rules.fx.usdToThb)).mul(q).mul(p)
  else if (input.method === 'silk') {
    if (quantity <= m.silkFlatUpToQty) setup = moneyUp(D(m.silkFlatUsd).mul(rules.fx.usdToThb)).mul(p).mul(colors)
    else run = moneyUp(D(m.silkPerPieceUsd).mul(rules.fx.usdToThb)).mul(q).mul(p).mul(colors)
  } else if (input.method === 'uv') {
    const rate = input.uvRateUsd ?? m.uvPerPieceUsd
    if (rate === null || rate === undefined) throw pricingError('UV requires an evidenced rate; missing is not zero', 'input.logo.uvRateUsd', 'MISSING_PRICE_INPUT')
    run = moneyUp(D(rate).mul(rules.fx.usdToThb)).mul(q).mul(p)
  }
  return { setup, run, total: setup.add(run) }
}

export function calculatePricingCustomization(rulesInput, input) {
  const rules = validatePricingRules(rulesInput), i = plainJson(input, 'input')
  exact(i, ['quantity', 'method', 'positions', 'colors'], 'input', ['rateThb', 'uvRateUsd'])
  integer(i.quantity, 'input.quantity'); validateLogoInput(i)
  if (i.positions === null) throw pricingError('Explicit logo positions required', 'input.positions')
  const cost = logoCost(rules, i, i.quantity), per = moneyUp(cost.total.div(i.quantity))
  return { setupSatang: cost.setup.satang(), runSatang: cost.run.satang(), totalSatang: cost.total.satang(), perUnitSatang: per.satang(), perUnitThbExact: per.text(4), warnings: i.method === 'none' ? [warn('NO_LOGO', 'No logo cost included; confirm this is intentional.')] : [] }
}

function positionsFor(rules, input) {
  if (input.logo.positions !== null) return input.logo.positions
  const r = rules.logoPositions
  let pieces = 1
  if (r.piecesFromCodeLastDigit) {
    const match = /([0-9])$/.exec(input.productCode || '')
    if (!match) throw pricingError('Product code ending in a piece digit required to derive logo positions', 'input.productCode', 'MISSING_PRICE_INPUT')
    pieces = Number(match[1]) || 1
  }
  return Math.max(r.minPositions, pieces + r.extraPositions)
}

function costs(rules, input, quantity, referenceGoodsType) {
  if (input.costBasis === 'landed') return { landed: D(input.landedUnitCostThb), factory: D(input.landedUnitCostThb), freight: D(0), logo: D(0), inland: D(0), extra: D(0), domestic: D(0), sof: D(1), shipping: null }
  const { carton, shipping: s } = input, l = rules.logistics
  const cartons = Math.ceil(quantity / carton.units)
  const volume = max(carton.cbm, l.minCbm).mul(cartons)
  const weight = carton.kg === null ? null : D(carton.kg).mul(cartons)
  const byWeight = weight !== null && D(carton.kg).div(carton.cbm).cmp(l.densityThreshold) >= 0
  const mode = s.mode !== 'auto' ? s.mode : l.forceTruckInPeak && l.peakMonths.includes(s.month) ? 'truck' : volume.cmp(l.seaThresholdCbm) > 0 ? 'sea' : 'truck'
  const rate = l.rates[s.warehouse][mode][referenceGoodsType || s.goodsType][s.tier]
  const freightTotal = moneyUp(byWeight ? weight.mul(rate.kg) : volume.mul(rate.cbm))
  const freight = moneyUp(freightTotal.div(quantity))
  const sof = tier(rules.smallOrderFactors, quantity, 'factor')
  const fx = input.factoryUnitCost.currency === 'CNY' ? rules.fx.cnyToThb : input.factoryUnitCost.currency === 'USD' ? rules.fx.usdToThb : '1'
  const factory = moneyUp(D(input.factoryUnitCost.amount).mul(fx).mul(sof))
  const logo = moneyUp(logoCost(rules, { ...input.logo, positions: positionsFor(rules, input) }, quantity).total.div(quantity))
  const inland = moneyUp(D(l.inlandCnyPerUnit).mul(rules.fx.cnyToThb))
  const extra = moneyUp(input.extraUnitCostThb)
  const domestic = moneyUp((s.domesticMode === 'single_drop' ? D(l.domesticSingleDropThb) : D(0)).div(quantity))
  return { landed: factory.add(freight).add(logo).add(inland).add(extra).add(domestic), factory, freight, logo, inland, extra, domestic, sof,
    shipping: { cartons, volumeCbm: volume.text(12), weightKg: weight?.text(12) ?? null, chargedBy: byWeight ? 'weight' : 'volume', mode, freightTotalSatang: freightTotal.satang() } }
}

/** Caller owns Business authorization, cost provenance verification and activation. */
export function calculatePrice(rulesInput, input) {
  const rules = validatePricingRules(rulesInput), i = normalizePricingInput(input)
  const profile = rules.profiles[i.profile], index = profile.breaks.indexOf(i.quantity)
  if (index < 0) throw pricingError('Quantity must match a declared quote tier', 'input.quantity', 'UNSUPPORTED_PRICE_TIER')
  if (i.costBasis === 'landed' && profile.basis !== 'landed') throw pricingError('Trusted landed input requires a landed-basis profile', 'input.profile')
  const actual = costs(rules, i, i.quantity), anchor = costs(rules, i, profile.anchorQty, profile.referenceGoodsType)
  const anchorBasis = profile.basis === 'factory' ? anchor.factory : anchor.landed
  const markup = D(profile.flatMarkup ?? rules.markupBands.find((b) => b.maxCostThb === null || anchorBasis.cmp(b.maxCostThb) <= 0).multiplier)
  let floor = tier(rules.quantityFloors, i.quantity, 'thb')
  for (const row of rules.kindFloors[i.kind]) if (i.quantity >= row.minQty) floor = max(floor, row.thb)
  const values = { quantity: D(i.quantity), landedCost: actual.landed, factoryCost: actual.factory, anchorPrice: anchorBasis.mul(markup), factor: D(profile.factors[index]), anchorFactor: D(profile.factors[profile.breaks.indexOf(profile.anchorQty)]), markup, orderCost: D(i.orderCostThb), profitFloor: floor, priceStep: D(rules.rounding.priceStepThb), fxCny: D(rules.fx.cnyToThb), fxUsd: D(rules.fx.usdToThb) }
  const candidate = evaluatePricingFormula(validatePricingFormula(rules.formulas), values, (q) => {
    if (q.d !== 1n || q.cmp(0) <= 0 || q.cmp(1000000) > 0) throw pricingError('quantityBand requires a positive bounded integer quantity', 'formulas')
    return tier(rules.smallOrderFactors, q, 'factor')
  })
  if (candidate.cmp(0) < 0) throw pricingError('Formula returned a negative price', 'formulas', 'NEGATIVE_PRICE')
  const floorPrice = actual.landed.add(floor.add(i.orderCostThb).div(i.quantity))
  const final = max(candidate, floorPrice).ceilStep(rules.rounding.priceStepThb)
  const total = final.mul(i.quantity), gross = final.sub(actual.landed).mul(i.quantity).sub(i.orderCostThb)
  const warnings = []
  if (!i.sourceRefs.length) warnings.push(warn('MISSING_SOURCE_REFERENCES', 'Input has no source references; a calculation is not verification of cost evidence.'))
  if (i.costBasis === 'landed') warnings.push(warn('TRUSTED_LANDED_INPUT', 'Caller-supplied landed cost is used unchanged at every tier; this engine does not verify its source or add freight/logo.'))
  else {
    if (i.carton.kg === null) warnings.push(warn('MISSING_WEIGHT', 'Freight uses volume because carton weight is unknown.'))
    if (i.logo.method === 'none') warnings.push(warn('NO_LOGO', 'No logo cost included; confirm this is intentional.'))
    if (actual.sof.cmp(1) > 0) warnings.push(warn('SMALL_ORDER_FACTOR', 'Configured small-order premium applied; confirm factory evidence.'))
    if (i.shipping.domesticMode === 'none') warnings.push(warn('NO_DOMESTIC_FREIGHT', 'No domestic freight included; this is not a free-delivery approval.'))
  }
  if (floorPrice.cmp(candidate) > 0) warnings.push(warn('PROFIT_FLOOR_APPLIED', 'The mandatory total-order profit floor increased the quoted price.'))
  const marginPercent = gross.div(total).mul(100)
  if (marginPercent.cmp(profile.marginWarningBand.minPercent) < 0 || marginPercent.cmp(profile.marginWarningBand.maxPercent) > 0) warnings.push(warn('MARGIN_OUTSIDE_PROFILE', 'Calculated margin is outside the configured profile warning band; price was not clamped.'))
  if (profile.targetProfitThb !== null && gross.cmp(profile.targetProfitThb) < 0) warnings.push(warn('BELOW_PROFIT_TARGET', 'Order meets the mandatory floor but is below the profile profit target.'))
  const production = rules.leadTime.production.find((r) => r.maxQty === null || i.quantity <= r.maxQty)
  const lead = { min: rules.leadTime.artwork.min + (i.rush ? 0 : rules.leadTime.sample.min) + production.min, max: rules.leadTime.artwork.max + (i.rush ? 0 : rules.leadTime.sample.max) + production.max }
  if (actual.shipping) { lead.min += rules.leadTime.freight[actual.shipping.mode].min; lead.max += rules.leadTime.freight[actual.shipping.mode].max }
  else warnings.push(warn('LEAD_TIME_EXCLUDES_FREIGHT', 'Already-landed calculation lead time has no source shipping schedule.'))
  if (i.deadlineDays && lead.max > i.deadlineDays) warnings.push(warn('DEADLINE_RISK', 'Estimated maximum working days exceed requested deadline.'))
  const sourceWarnings = Object.entries(rules.provenance.sources).filter(([, s]) => ['undocumented', 'code_only', 'file_only'].includes(s?.level)).map(([key]) => key)
  if (sourceWarnings.length) warnings.push(warn('SOURCE_EVIDENCE_LIMITED', `Rule-source evidence needs review: ${sourceWarnings.join(', ')}.`))
  return {
    evaluatorVersion: EVALUATOR_VERSION, ruleVersion: rules.version, ruleHash: pricingHash(rules), inputHash: pricingHash(i), quantity: i.quantity, currency: 'THB',
    unitPriceSatang: final.satang(), totalPriceSatang: total.satang(), unitLandedCostSatang: actual.landed.satang(), grossProfitSatang: gross.satang(), priceDriver: floorPrice.cmp(candidate) > 0 ? PRICE_DRIVERS.FLOOR : PRICE_DRIVERS.LADDER,
    breakdown: { costBasis: i.costBasis, unitLandedCostThbExact: actual.landed.text(4), factoryUnitSatang: actual.factory.satang(), freightUnitSatang: actual.freight.satang(), logoUnitSatang: actual.logo.satang(), inlandUnitSatang: actual.inland.satang(), domesticUnitSatang: actual.domestic.satang(), extraUnitSatang: actual.extra.satang(), orderCostSatang: D(i.orderCostThb).satang(), profitFloorSatang: floor.satang(), candidateUnitSatang: candidate.satang(), grossMarginPercent: marginPercent.text(2), smallOrderFactor: actual.sof.text(4), appliedMarkup: markup.text(4), shipping: actual.shipping, leadTimeWorkingDays: lead },
    warnings, provenance: { rules: rules.provenance, sourceRefs: i.sourceRefs },
  }
}
