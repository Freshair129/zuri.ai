import prisma from '@/lib/db'
import { assertMayView } from '@/modules/inventory'
import { calculatePrice, calculatePricingCustomization, validatePricingRules } from '../domain/pricing-engine'

// @req FR-252, FR-181 — the Inventory-authorized Agent read port uses the
// Commerce evaluator without disclosing the private rule document or widening
// the owner-only editor. Ledger cost is supplied by the trusted Inventory caller.
// @spec ADR-097; BR-027; SEC-001
// @tested tests/integration/fr181-smartgift-agent-tools.test.js, tests/integration/fr252-pricing-catalog.test.js

const fail = (status, message) => Object.assign(new Error(message), { status })
const METHODS = Object.freeze({ NONE: 'none', LASER_ENGRAVING: 'engrave', SILK_SCREEN: 'silk', UV_DIGITAL_PRINT: 'uv', HOT_STAMP_FOIL: 'hotstamp' })
const baht = (satang) => `${Math.trunc(satang / 100)}.${String(satang % 100).padStart(2, '0')}`
const money = (value) => Number.isSafeInteger(value) && value >= 0
const perUnitCeil = (total, quantity) => Number((BigInt(total) + BigInt(quantity) - 1n) / BigInt(quantity))

export async function priceLandedInventoryQuote({
  businessId, quantity, baseCostSatang, kind = 'single', customization = {},
  inboundTruckSatang, productId, sourceRefs,
}, { viewer, db = prisma, now = new Date() } = {}) {
  assertMayView(viewer, businessId)
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw fail(404, 'Business not found')
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !money(baseCostSatang)) throw fail(422, 'PRICING_INPUT_INVALID')
  const row = await db.pricingRuleSet.findFirst({
    where: { businessId, tenantId: business.tenantId, approvedAt: { not: null }, effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }, { id: 'desc' }],
  })
  if (!row || row.status !== 'APPROVED' || (row.expiresAt && row.expiresAt <= now)) throw fail(409, 'PRICING_RULE_NOT_ACTIVE')
  const rules = validatePricingRules(JSON.parse(row.rulesJson))
  const technique = customization.technique ?? 'NONE'
  const positions = technique === 'NONE' ? 0 : (customization.locationsCount ?? 1)
  if (!Number.isSafeInteger(positions) || positions < (technique === 'NONE' ? 0 : 1) || positions > 20) throw fail(422, 'PRICING_INPUT_INVALID')
  let logo
  if (customization.setupCostSatang !== undefined || customization.runCostSatang !== undefined) {
    if (!money(customization.setupCostSatang) || !money(customization.runCostSatang)) throw fail(422, 'PRICING_WORKSHOP_RATES_REQUIRED')
    const setupSatang = customization.setupCostSatang * positions
    const runSatang = customization.runCostSatang * positions
    const totalSatang = setupSatang + runSatang * quantity
    if (!money(totalSatang)) throw fail(422, 'PRICING_MONEY_OVERFLOW')
    logo = { setupSatang, runSatang: runSatang * quantity, perUnitSatang: perUnitCeil(totalSatang, quantity), warnings: ['WORKSHOP_RATE_OVERRIDE'] }
  } else if (technique === 'NONE') {
    logo = { setupSatang: 0, runSatang: 0, perUnitSatang: 0, warnings: [] }
  } else {
    if (!METHODS[technique]) throw fail(422, 'PRICING_WORKSHOP_RATES_REQUIRED')
    logo = calculatePricingCustomization(rules, { quantity, method: METHODS[technique], positions, colors: 1 })
  }
  // Ledger receipts already include inbound freight. This legacy API argument
  // represents only an explicitly supplied additional order delivery cost.
  const hasAdditionalDelivery = inboundTruckSatang !== undefined
  const truck = hasAdditionalDelivery ? inboundTruckSatang : 0
  if (!money(truck)) throw fail(422, 'PRICING_INPUT_INVALID')
  const freightPerUnit = perUnitCeil(truck, quantity)
  const unitCostSatang = baseCostSatang + freightPerUnit + logo.perUnitSatang
  if (!money(unitCostSatang)) throw fail(422, 'PRICING_MONEY_OVERFLOW')
  const input = {
    costBasis: 'landed', landedUnitCostThb: baht(unitCostSatang),
    quantity, kind, profile: 'corporate', orderCostThb: '0',
    sourceRefs: sourceRefs ?? [{ kind: 'INVENTORY_LEDGER', ...(productId ? { productId } : {}) }],
  }
  const result = calculatePrice(rules, input)
  return {
    input, rulesHash: row.rulesHash, rulesJson: row.rulesJson,
    result, ruleSetId: row.id, ruleRevision: row.version, ruleExpiresAt: row.expiresAt,
    unitCostSatang, freightAbsorbedSatang: truck, freightPerUnit,
    freightCostBasis: hasAdditionalDelivery ? 'ADDITIONAL_DELIVERY' : 'INCLUDED_IN_LEDGER',
    embeddedFreightSatang: null,
    customization: { technique, positions, setupCostSatang: logo.setupSatang, runCostSatang: perUnitCeil(logo.runSatang, quantity), perUnitSatang: logo.perUnitSatang },
    warnings: [...logo.warnings, ...(hasAdditionalDelivery ? ['ADDITIONAL_DELIVERY_OVERRIDE: inboundTruckSatang is an additional order delivery cost; embedded ledger freight is not separately known'] : []), ...result.warnings].map((warning) => typeof warning === 'string' ? warning : `${warning.code}: ${warning.message}`),
  }
}
