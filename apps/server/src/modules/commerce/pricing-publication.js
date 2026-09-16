import prisma from '@/lib/db'

// @req FR-252 — a computed sell-side source remains usable only while its
// pinned approved policy is the current effective policy for the Business.
// Public Commerce read port: returns no rules, costs, margins or source evidence.
// @spec ADR-097; SEC-001
// @tested tests/unit/pricing-publication.test.js
const CATALOG_CODE = /^PCAT-([a-f0-9]{64})$/
const unavailable = () => Object.assign(new Error('Computed catalog price is no longer current'), { status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })

export async function assertPricingCatalogCurrent(asset, { db = prisma, now = new Date() } = {}) {
  if (!asset?.code?.startsWith('PCAT-')) return
  const match = CATALOG_CODE.exec(asset.code)
  if (!match || !asset.businessId || !asset.tenantId) throw unavailable()
  const rows = await db.pricingCalculation.findMany({
    where: { businessId: asset.businessId, tenantId: asset.tenantId, idempotencyKey: { startsWith: `catalog:${match[1]}:` } },
    select: { ruleSetId: true, ruleVersion: true, rulesHash: true, inputProvenance: true },
  })
  const current = await db.pricingRuleSet.findFirst({
    where: { businessId: asset.businessId, tenantId: asset.tenantId, approvedAt: { not: null }, effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }, { id: 'desc' }],
  })
  if (!rows.length || !current || current.status !== 'APPROVED' ||
      (current.expiresAt && current.expiresAt <= now) ||
      rows.some((row) => row.inputProvenance !== 'INVENTORY_LEDGER' ||
        row.ruleSetId !== current.id || row.rulesHash !== current.rulesHash || row.ruleVersion !== current.version)) {
    throw unavailable()
  }
}
