#!/usr/bin/env node
// Writes contracts/v1/pricing-parity-cases.json — the pinned INPUT matrix of the
// pricing parity proof. Inputs only: the expected outputs are recorded from the
// legacy apps/server engine by apps/server/tests/unit/scm-pricing-parity.test.js
// (WRITE_SCM_PRICING_GOLDEN=1) into pricing-parity-golden.json, and both the
// legacy engine and the SCM kernel must reproduce that file exactly.
// Synthetic data only: every cost, carton and reference below is invented.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'contracts', 'v1', 'pricing-parity-cases.json')
const ref = [{ sourceId: 'synthetic-cost-sheet', sha256: 'b'.repeat(64) }]
const factory = (extra = {}) => ({
  costBasis: 'factory', quantity: 100, kind: 'set', profile: 'standard',
  factoryUnitCost: { amount: '32', currency: 'CNY' }, carton: { units: 20, cbm: '0.1', kg: null },
  shipping: { warehouse: 'guangzhou_shenzhen', mode: 'auto', month: 4, goodsType: 'general', tier: 'GOLD', domesticMode: 'none' },
  logo: { method: 'none', positions: 1, colors: 1 }, extraUnitCostThb: '0', orderCostThb: '0', sourceRefs: ref, ...extra,
})
const landed = (extra = {}) => ({ costBasis: 'landed', quantity: 100, kind: 'set', profile: 'corporate', landedUnitCostThb: '100', orderCostThb: '0', sourceRefs: [], ...extra })
const ship = (extra) => ({ ...factory().shipping, ...extra })
const logo = (extra) => ({ method: 'none', positions: 1, colors: 1, ...extra })
const formula = (expression) => [{ path: ['formulas'], value: [{ name: 'candidatePrice', expression, unit: 'THB/unit' }] }]

const cases = []
const add = (id, input, { fn = 'calculatePrice', ruleOverrides = [] } = {}) => cases.push({ id, fn, ruleOverrides, input })

for (const q of [10, 20, 50, 100, 300, 500, 1000]) add(`standard-cny-q${q}`, factory({ quantity: q }))
for (const q of [100, 300, 500, 1000]) add(`corporate-landed-q${q}`, landed({ quantity: q }))
add('standard-usd', factory({ factoryUnitCost: { amount: '4.75', currency: 'USD' } }))
add('standard-thb', factory({ factoryUnitCost: { amount: '155.5', currency: 'THB' } }))
add('weight-charged-dense-carton', factory({ carton: { units: 10, cbm: '0.05', kg: '40' } }))
add('volume-charged-light-carton', factory({ carton: { units: 10, cbm: '0.2', kg: '5' } }))
add('auto-sea-above-threshold', factory({ quantity: 1000, carton: { units: 5, cbm: '0.2', kg: null } }))
add('auto-truck-peak-month', factory({ quantity: 1000, carton: { units: 5, cbm: '0.2', kg: null }, shipping: ship({ month: 10 }) }))
add('forced-sea', factory({ shipping: ship({ mode: 'sea' }) }))
add('forced-truck-yiwu-electronic-elite', factory({ shipping: ship({ mode: 'truck', warehouse: 'yiwu', goodsType: 'electronic_tisi', tier: 'ELITE' }) }))
add('member-tier-single-drop', factory({ shipping: ship({ tier: 'MEMBER', domesticMode: 'single_drop' }) }))
add('logo-flat', factory({ logo: logo({ method: 'flat', positions: 2 }) }))
add('logo-flat-custom-rate', factory({ logo: logo({ method: 'flat', positions: 1, rateThb: '7.5' }) }))
add('logo-hotstamp-q500', factory({ quantity: 500, logo: logo({ method: 'hotstamp', positions: 2 }) }))
add('logo-hotstamp-text', factory({ logo: logo({ method: 'hotstamp_text', positions: 1 }) }))
add('logo-engrave-q300', factory({ quantity: 300, logo: logo({ method: 'engrave', positions: 1 }) }))
add('logo-silk-flat-small-qty', factory({ quantity: 50, logo: logo({ method: 'silk', positions: 1, colors: 2 }) }))
add('logo-silk-per-piece-large-qty', factory({ quantity: 1000, logo: logo({ method: 'silk', positions: 2, colors: 3 }) }))
add('logo-uv-with-evidenced-rate', factory({ logo: logo({ method: 'uv', positions: 1, uvRateUsd: '0.35' }) }))
add('logo-uv-missing-rate-is-not-zero', factory({ logo: logo({ method: 'uv', positions: 1 }) }))
add('logo-positions-from-code-digit', factory({ productCode: 'SYN-SET-3', logo: logo({ method: 'flat', positions: null }) }))
add('logo-positions-code-without-digit', factory({ productCode: 'SYN-SET-X', logo: logo({ method: 'flat', positions: null }) }))
add('extra-and-order-cost', factory({ extraUnitCostThb: '12.345', orderCostThb: '1500' }))
add('rush-with-deadline-risk', factory({ rush: true, deadlineDays: 5 }))
add('deadline-comfortable', factory({ deadlineDays: 120 }))
add('no-source-references', factory({ sourceRefs: [] }))
add('kind-single-q1000', factory({ quantity: 1000, kind: 'single' }))
add('corporate-single-drop-order-cost', landed({ quantity: 300, orderCostThb: '2500' }))
add('corporate-cheap-floor-driven', landed({ landedUnitCostThb: '1' }))
add('boundary-landed-whole-satang', landed({ landedUnitCostThb: '0.01' }))
add('refuse-landed-fraction-of-satang', landed({ landedUnitCostThb: '100.001' }))
add('refuse-unsupported-tier', factory({ quantity: 150 }))
add('refuse-landed-on-factory-profile', landed({ profile: 'standard' }))
add('refuse-unknown-input-field', { ...factory(), discount: '10' })
add('refuse-negative-cost', factory({ factoryUnitCost: { amount: '-1', currency: 'CNY' } }))
add('refuse-float-noise-decimal', factory({ extraUnitCostThb: '0.1234567890123' }))
add('refuse-price-overflow', landed({ landedUnitCostThb: '999999999999999999' }))
add('formula-floor-dominates', landed(), { ruleOverrides: formula('landedCost * 0') })
add('formula-min-max-ceil', landed({ quantity: 300 }), { ruleOverrides: formula('ceilToStep(max(anchorPrice * factor / anchorFactor, landedCost), priceStep)') })
add('formula-quantity-band', landed({ quantity: 500 }), { ruleOverrides: formula('anchorPrice * quantityBand(quantity)') })
add('refuse-formula-negative', landed(), { ruleOverrides: formula('-landedCost') })
add('refuse-formula-division-by-variable-zero', landed(), { ruleOverrides: formula('anchorPrice / (factor - factor)') })
add('refuse-formula-injection', landed(), { ruleOverrides: formula('process.exit()') })
add('refuse-formula-member-access', landed(), { ruleOverrides: formula('anchorPrice.constructor') })
add('refuse-formula-unit-mismatch', landed(), { ruleOverrides: formula('landedCost + quantity') })
add('refuse-formula-depth', landed(), { ruleOverrides: formula(`${'('.repeat(40)}anchorPrice${')'.repeat(40)}`) })
add('rules-fx-override', factory(), { ruleOverrides: [{ path: ['fx', 'cnyToThb'], value: '5.25' }] })
add('refuse-rules-unknown-field', factory(), { ruleOverrides: [{ path: ['eval'], value: 'x' }] })
for (const [method, extra] of [['none', {}], ['flat', { positions: 2 }], ['hotstamp', { positions: 1 }], ['engrave', { positions: 3 }], ['silk', { positions: 1, colors: 4 }], ['uv', { positions: 1, uvRateUsd: '0.2' }]]) {
  add(`customization-${method}`, { quantity: 300, method, positions: 1, colors: 1, ...extra }, { fn: 'calculatePricingCustomization' })
}
add('refuse-customization-null-positions', { quantity: 100, method: 'flat', positions: null, colors: 1 }, { fn: 'calculatePricingCustomization' })

writeFileSync(out, `${JSON.stringify({ schema: 'scm.pricing-parity-cases.v1', cases }, null, 2)}\n`)
process.stdout.write(`wrote ${cases.length} cases\n`)
