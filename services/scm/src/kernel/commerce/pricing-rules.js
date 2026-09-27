import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { Decimal, pricingError, validatePricingFormula } from './pricing-formula.js'
import { SOURCE_RULES, SOURCE_SHA256 } from './pricing-source.js'

// @req FR-253 — strict rules import, all supported variable groups and source lineage.
// @spec ADR-098
// @tested tests/unit/pricing-engine.test.js

const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
export function plainJson(value, field = 'rules', depth = 0) {
  if (depth > 20) throw pricingError('JSON depth limit exceeded', field)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (value.length > 200) throw pricingError('Array limit exceeded', field)
    return value.map((v, i) => plainJson(v, `${field}.${i}`, depth + 1))
  }
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw pricingError('Expected plain JSON', field)
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (forbidden.has(key)) throw pricingError('Forbidden property name', `${field}.${key}`)
    out[key] = plainJson(value[key], `${field}.${key}`, depth + 1)
  }
  return out
}
export const pricingHash = (value) => createHash('sha256').update(JSON.stringify(plainJson(value))).digest('hex')
export function exact(value, keys, field, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw pricingError('Expected object', field)
  for (const key of Object.keys(value)) if (!keys.includes(key) && !optional.includes(key)) throw pricingError(`Unknown field ${key}`, `${field}.${key}`)
  for (const key of keys) if (!Object.hasOwn(value, key)) throw pricingError(`Missing field ${key}`, `${field}.${key}`)
  return value
}
export function decimal(value, field, positive = false) {
  let d
  try { d = Decimal.from(value) } catch { throw pricingError('Expected a finite decimal with at most 12 places', field) }
  if (d.cmp(0) < 0 || (positive && d.cmp(0) === 0)) throw pricingError(positive ? 'Must be positive' : 'Must be nonnegative', field)
  // Normalize spelling without rounding any configured precision.
  return d.text(12).replace(/\.?0+$/, '') || '0'
}
export function integer(value, field, min = 1, max = 1000000) {
  if (!Number.isInteger(value) || value < min || value > max) throw pricingError(`Expected integer ${min}–${max}`, field)
  return value
}
export function choice(value, values, field) {
  if (!values.includes(value)) throw pricingError(`Expected one of ${values.join(', ')}`, field)
  return value
}
function bool(value, field) { if (typeof value !== 'boolean') throw pricingError('Expected boolean', field); return value }
function text(value, field, max = 300) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw pricingError('Expected nonempty bounded text', field); return value }
function table(rows, bound, key, field, costBound = false) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 32) throw pricingError('Expected 1–32 ordered tiers', field)
  let previous = Decimal.from(0)
  return rows.map((row, i) => {
    exact(row, [bound, key], `${field}.${i}`)
    if (row[bound] === null) { if (i !== rows.length - 1) throw pricingError('Unbounded tier must be last', field) }
    else {
      const b = Decimal.from(costBound ? decimal(row[bound], field, true) : integer(row[bound], field))
      if (b.cmp(previous) <= 0) throw pricingError('Tier bounds must increase', field)
      previous = b
    }
    if (i === rows.length - 1 && row[bound] !== null) throw pricingError('Final tier must be unbounded (null)', field)
    return { [bound]: row[bound] === null ? null : costBound ? decimal(row[bound], field, true) : row[bound], [key]: decimal(row[key], `${field}.${i}.${key}`, key !== 'thb' && key !== 'usd') }
  })
}
function days(value, field) {
  exact(value, ['min', 'max'], field)
  integer(value.min, `${field}.min`, 0, 365); integer(value.max, `${field}.max`, value.min, 365)
  return value
}

export function validatePricingRules(input) {
  const r = plainJson(input)
  if (JSON.stringify(r).length > 64000) throw pricingError('Rules size limit exceeded')
  exact(r, ['schemaVersion', 'version', 'provenance', 'fx', 'logistics', 'rounding', 'quantityFloors', 'kindFloors', 'smallOrderFactors', 'markupBands', 'profiles', 'logo', 'logoPositions', 'leadTime', 'formulas'], 'rules')
  choice(r.schemaVersion, ['pricing-rules.v1'], 'schemaVersion'); text(r.version, 'version', 100)
  exact(r.provenance, ['sourcePath', 'sourceSha256', 'sourceVersion', 'sourceContext', 'sources', 'importNotes'], 'provenance')
  text(r.provenance.sourcePath, 'provenance.sourcePath'); text(r.provenance.sourceVersion, 'provenance.sourceVersion', 100)
  if (!/^[a-f0-9]{64}$/.test(r.provenance.sourceSha256)) throw pricingError('Expected SHA-256', 'provenance.sourceSha256')
  for (const k of ['sourceContext', 'sources']) if (!r.provenance[k] || typeof r.provenance[k] !== 'object' || Array.isArray(r.provenance[k])) throw pricingError('Expected provenance object', `provenance.${k}`)
  if (!Array.isArray(r.provenance.importNotes) || r.provenance.importNotes.some((v) => typeof v !== 'string' || v.length > 1000)) throw pricingError('Expected bounded import notes', 'provenance.importNotes')
  exact(r.fx, ['cnyToThb', 'usdToThb'], 'fx')
  for (const k of Object.keys(r.fx)) r.fx[k] = decimal(r.fx[k], `fx.${k}`, true)
  exact(r.rounding, ['priceStepThb'], 'rounding')
  r.rounding.priceStepThb = decimal(r.rounding.priceStepThb, 'rounding.priceStepThb', true)
  if (Decimal.from(r.rounding.priceStepThb).mul(100).d !== 1n) throw pricingError('Price step must be whole satang', 'rounding.priceStepThb')
  const l = r.logistics
  exact(l, ['densityThreshold', 'minCbm', 'seaThresholdCbm', 'peakMonths', 'forceTruckInPeak', 'inlandCnyPerUnit', 'domesticSingleDropThb', 'rates'], 'logistics')
  for (const k of ['densityThreshold', 'minCbm', 'seaThresholdCbm', 'inlandCnyPerUnit', 'domesticSingleDropThb']) l[k] = decimal(l[k], `logistics.${k}`, !['inlandCnyPerUnit', 'domesticSingleDropThb'].includes(k))
  bool(l.forceTruckInPeak, 'logistics.forceTruckInPeak')
  if (!Array.isArray(l.peakMonths) || new Set(l.peakMonths).size !== l.peakMonths.length) throw pricingError('Expected unique months', 'logistics.peakMonths')
  l.peakMonths.forEach((m) => integer(m, 'logistics.peakMonths', 1, 12))
  exact(l.rates, ['guangzhou_shenzhen', 'yiwu'], 'logistics.rates')
  for (const [warehouse, modes] of Object.entries(l.rates)) {
    exact(modes, ['truck', 'sea'], `logistics.rates.${warehouse}`)
    for (const [mode, goods] of Object.entries(modes)) {
      exact(goods, ['general', 'electronic_tisi'], `logistics.rates.${warehouse}.${mode}`)
      for (const [type, tiers] of Object.entries(goods)) {
        exact(tiers, ['ELITE', 'GOLD', 'SILVER', 'MEMBER'], `logistics.rates.${warehouse}.${mode}.${type}`)
        for (const [tier, rate] of Object.entries(tiers)) {
          const path = `logistics.rates.${warehouse}.${mode}.${type}.${tier}`
          exact(rate, ['cbm', 'kg'], path)
          rate.cbm = decimal(rate.cbm, `${path}.cbm`, true); rate.kg = decimal(rate.kg, `${path}.kg`, true)
        }
      }
    }
  }
  r.quantityFloors = table(r.quantityFloors, 'maxQty', 'thb', 'quantityFloors')
  r.smallOrderFactors = table(r.smallOrderFactors, 'maxQty', 'factor', 'smallOrderFactors')
  r.markupBands = table(r.markupBands, 'maxCostThb', 'multiplier', 'markupBands', true)
  exact(r.kindFloors, ['set', 'single'], 'kindFloors')
  for (const [kind, rows] of Object.entries(r.kindFloors)) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 32) throw pricingError('Expected nonempty kind floors', `kindFloors.${kind}`)
    let previous = 0
    rows.forEach((row, i) => {
      exact(row, ['minQty', 'thb'], `kindFloors.${kind}.${i}`)
      integer(row.minQty, `kindFloors.${kind}.${i}.minQty`, previous + 1); previous = row.minQty
      row.thb = decimal(row.thb, `kindFloors.${kind}.${i}.thb`)
    })
  }
  exact(r.profiles, ['standard', 'corporate'], 'profiles')
  for (const [key, profile] of Object.entries(r.profiles)) {
    const p = `profiles.${key}`
    exact(profile, ['name', 'basis', 'anchorQty', 'breaks', 'factors', 'flatMarkup', 'referenceGoodsType', 'targetProfitThb', 'marginWarningBand'], p)
    text(profile.name, `${p}.name`, 100); choice(profile.basis, ['factory', 'landed'], `${p}.basis`)
    integer(profile.anchorQty, `${p}.anchorQty`)
    if (!Array.isArray(profile.breaks) || !profile.breaks.length || profile.breaks.length > 32 || !Array.isArray(profile.factors) || profile.factors.length !== profile.breaks.length || !profile.breaks.includes(profile.anchorQty)) throw pricingError('Profile needs matching tiers and factors including anchor', p)
    profile.breaks.forEach((q, i) => integer(q, `${p}.breaks.${i}`, i ? profile.breaks[i - 1] + 1 : 1))
    profile.factors = profile.factors.map((f, i) => decimal(f, `${p}.factors.${i}`, true))
    if (profile.flatMarkup !== null) profile.flatMarkup = decimal(profile.flatMarkup, `${p}.flatMarkup`, true)
    choice(profile.referenceGoodsType, [null, 'general', 'electronic_tisi'], `${p}.referenceGoodsType`)
    if (profile.targetProfitThb !== null) profile.targetProfitThb = decimal(profile.targetProfitThb, `${p}.targetProfitThb`)
    exact(profile.marginWarningBand, ['minPercent', 'maxPercent'], `${p}.marginWarningBand`)
    for (const k of ['minPercent', 'maxPercent']) profile.marginWarningBand[k] = decimal(profile.marginWarningBand[k], `${p}.marginWarningBand.${k}`)
    if (Decimal.from(profile.marginWarningBand.maxPercent).cmp(100) > 0 || Decimal.from(profile.marginWarningBand.minPercent).cmp(profile.marginWarningBand.maxPercent) > 0) throw pricingError('Invalid margin warning band', `${p}.marginWarningBand`)
  }
  const logo = r.logo
  exact(logo, ['flatThbPerPosition', 'hotstampSetupUsd', 'hotstampBaseQty', 'hotstampTiers', 'hotstampTextUsd', 'engraveTiers', 'silkFlatUpToQty', 'silkFlatUsd', 'silkPerPieceUsd', 'uvPerPieceUsd'], 'logo')
  for (const k of ['flatThbPerPosition', 'hotstampSetupUsd', 'hotstampTextUsd', 'silkFlatUsd', 'silkPerPieceUsd']) logo[k] = decimal(logo[k], `logo.${k}`)
  integer(logo.hotstampBaseQty, 'logo.hotstampBaseQty'); integer(logo.silkFlatUpToQty, 'logo.silkFlatUpToQty')
  if (logo.uvPerPieceUsd !== null) logo.uvPerPieceUsd = decimal(logo.uvPerPieceUsd, 'logo.uvPerPieceUsd', true)
  logo.hotstampTiers = table(logo.hotstampTiers, 'maxQty', 'usd', 'logo.hotstampTiers')
  logo.engraveTiers = table(logo.engraveTiers, 'maxQty', 'usd', 'logo.engraveTiers')
  exact(r.logoPositions, ['piecesFromCodeLastDigit', 'extraPositions', 'minPositions'], 'logoPositions')
  bool(r.logoPositions.piecesFromCodeLastDigit, 'logoPositions.piecesFromCodeLastDigit')
  integer(r.logoPositions.extraPositions, 'logoPositions.extraPositions', 0, 100); integer(r.logoPositions.minPositions, 'logoPositions.minPositions', 1, 100)
  exact(r.leadTime, ['artwork', 'sample', 'production', 'freight'], 'leadTime')
  days(r.leadTime.artwork, 'leadTime.artwork'); days(r.leadTime.sample, 'leadTime.sample')
  exact(r.leadTime.freight, ['truck', 'sea'], 'leadTime.freight')
  for (const k of ['truck', 'sea']) days(r.leadTime.freight[k], `leadTime.freight.${k}`)
  if (!Array.isArray(r.leadTime.production) || !r.leadTime.production.length) throw pricingError('Missing production lead time', 'leadTime.production')
  table(r.leadTime.production.map(({ maxQty }) => ({ maxQty, factor: '1' })), 'maxQty', 'factor', 'leadTime.production')
  r.leadTime.production.forEach((row, i) => { exact(row, ['maxQty', 'min', 'max'], `leadTime.production.${i}`); days({ min: row.min, max: row.max }, `leadTime.production.${i}`) })
  validatePricingFormula(r.formulas)
  return r
}

const cap = (n) => n === Infinity || n === null ? null : n
function sourceRules(source, sha) {
  // Import is a translation, not an alternative runtime fallback. Only the
  // reviewed source schema is accepted; unmapped source policy is preserved as
  // explicitly inactive evidence instead of being exposed as working controls.
  const s = source
  exact(s, ['version', 'contract_reference', 'last_updated', 'updated_by', 'tenant_id', 'business_id', 'vault_id', 'currency_exchange_rates', 'logistics_density_and_freight', 'price_rounding', 'profit_floors_thb', 'profit_floors', 'profit_floors_by_kind', 'small_order_factors', 'markup_bands_standard', 'standard_quote_profile', 'corporate_quote_profile', 'logo_methods', 'logo_positions_rule', 'lead_time_working_days', 'srp_benchmark_rules', 'shipping_rate_matrix', 'sources'], 'source')
  const sourceShape = (value, template, path) => {
    if (Array.isArray(template)) {
      if (!Array.isArray(value) || !value.length || value.length > 32) throw pricingError('Invalid source table', path)
      value.forEach((row, i) => sourceShape(row, template[0], `${path}.${i}`))
    } else if (template && typeof template === 'object') {
      exact(value, Object.keys(template), path)
      for (const key of Object.keys(template)) sourceShape(value[key], template[key], `${path}.${key}`)
    } else if (typeof template === 'number') {
      if ((value === null || value === Infinity) && /\.(max_qty|max_cost_thb)$/.test(path)) return
      if (typeof value !== 'number' || !Number.isFinite(value)) throw pricingError('Invalid source numeric field', path)
    } else if (typeof template === 'string' || typeof template === 'boolean') {
      if (typeof value !== typeof template) throw pricingError('Invalid source field type', path)
    } else if (template === null && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw pricingError('Expected null or numeric source field', path)
    }
  }
  for (const key of Object.keys(s)) if (!['sources', 'version', 'last_updated', 'updated_by'].includes(key)) sourceShape(s[key], SOURCE_RULES[key], `source.${key}`)
  const l = s.logistics_density_and_freight, m = s.logo_methods, lead = s.lead_time_working_days
  const tier = (rows, key, name) => rows.map((row) => ({ maxQty: cap(row.max_qty), [name]: String(row[key]) }))
  const profile = (p, corporate) => ({ name: p.name, basis: p.basis, anchorQty: p.anchor_qty, breaks: p.breaks, factors: p.factors.map(String), flatMarkup: p.flat_markup === undefined ? null : String(p.flat_markup), referenceGoodsType: p.reference_goods_type || null, targetProfitThb: corporate ? String(p.package_profit_guardrails.target_package_profit_thb) : null, marginWarningBand: corporate ? { minPercent: '20', maxPercent: '35' } : { minPercent: '39', maxPercent: '52' } })
  const rules = {
    schemaVersion: 'pricing-rules.v1', version: s.version,
    provenance: { sourcePath: 'config/pricing_rules_formula.yaml', sourceSha256: sha, sourceVersion: s.version,
      sourceContext: { contract: s.contract_reference, tenant: s.tenant_id, business: s.business_id, updatedBy: s.updated_by, updatedAt: s.last_updated, inactive: { srpBenchmark: s.srp_benchmark_rules, inlandCbm: { rate: l.inland_china_freight.rate_cny_per_cbm, minimum: l.inland_china_freight.min_charge_cny } }, legacyPackageGuardrails: s.corporate_quote_profile.package_profit_guardrails },
      sources: s.sources, importNotes: ['Corporate single-drop policy: SmartGift ADR-009, THB 2500/order.', 'Kind floors and independent USD FX are enforced; legacy omission is not copied.', 'Approved 20260913 Q5: kind floor THB 20000; corporate target THB 30000 is a warning, not a clamp.', 'Source SRP benchmark and inland CBM are inactive; separate policy scope is required.'] },
    fx: { cnyToThb: String(s.currency_exchange_rates.cny_to_thb), usdToThb: String(s.currency_exchange_rates.usd_to_thb) },
    logistics: { densityThreshold: String(l.density_threshold_kg_per_cbm), minCbm: String(l.min_chargeable_cbm), seaThresholdCbm: String(l.sea_threshold_cbm), peakMonths: l.seasonality_peak_months, forceTruckInPeak: l.auto_force_truck_in_peak, inlandCnyPerUnit: String(l.inland_china_freight.default_rate_cny_per_set), domesticSingleDropThb: '2500', rates: s.shipping_rate_matrix },
    rounding: { priceStepThb: String(s.price_rounding.ladder_price_step_thb) },
    quantityFloors: tier(s.profit_floors, 'thb', 'thb'),
    kindFloors: Object.fromEntries(Object.entries(s.profit_floors_by_kind).map(([k, rows]) => [k, rows.map((row) => ({ minQty: row.min_qty, thb: String(row.thb) }))])),
    smallOrderFactors: tier(s.small_order_factors, 'sof', 'factor'), markupBands: s.markup_bands_standard.map((row) => ({ maxCostThb: cap(row.max_cost_thb) === null ? null : String(row.max_cost_thb), multiplier: String(row.markup_multiplier) })),
    profiles: { standard: profile(s.standard_quote_profile, false), corporate: profile(s.corporate_quote_profile, true) },
    logo: { flatThbPerPosition: String(m.flat.default_rate_thb), hotstampSetupUsd: String(m.hotstamp.setup_usd), hotstampBaseQty: 100, hotstampTiers: tier(m.hotstamp.per_piece_over_100_usd, 'usd', 'usd'), hotstampTextUsd: String(m.hotstamp_text.flat_usd), engraveTiers: tier(m.engrave.per_piece_usd, 'usd', 'usd'), silkFlatUpToQty: m.silk.flat_usd_up_to_qty, silkFlatUsd: String(m.silk.flat_usd), silkPerPieceUsd: String(m.silk.per_piece_usd_above), uvPerPieceUsd: m.uv.per_piece_usd === null ? null : String(m.uv.per_piece_usd) },
    logoPositions: { piecesFromCodeLastDigit: s.logo_positions_rule.pieces_from_code_last_digit, extraPositions: s.logo_positions_rule.extra_positions, minPositions: s.logo_positions_rule.min_positions },
    leadTime: { artwork: lead.artwork_confirm, sample: lead.sample, production: lead.production.map((row) => ({ maxQty: cap(row.max_qty), min: row.min, max: row.max })), freight: lead.freight },
    formulas: [{ name: 'candidatePrice', expression: 'anchorPrice * factor / anchorFactor', unit: 'THB/unit' }],
  }
  if (l.inland_china_freight.implemented_basis !== 'per_set') throw pricingError('Only per_set inland costing is supported', 'source.logistics_density_and_freight.inland_china_freight.implemented_basis')
  if (s.standard_quote_profile.markup_source !== 'markup_bands_standard') throw pricingError('Unsupported markup source', 'source.standard_quote_profile.markup_source')
  return validatePricingRules(rules)
}

export function importPricingRulesYaml(yamlText) {
  if (typeof yamlText !== 'string' || yamlText.length > 64000) throw pricingError('Expected YAML up to 64KB', 'source')
  try {
    const doc = parseDocument(yamlText, { uniqueKeys: true, version: '1.2' })
    if (doc.errors.length || doc.warnings.length) throw new Error('Invalid YAML')
    const source = doc.toJS({ maxAliasCount: 0 })
    return sourceRules(source, createHash('sha256').update(yamlText).digest('hex'))
  } catch (e) { if (e.status === 422) throw e; throw pricingError('Malformed or unsupported YAML', 'source') }
}
export function defaultPricingRules() { return sourceRules(structuredClone(SOURCE_RULES), SOURCE_SHA256) }
