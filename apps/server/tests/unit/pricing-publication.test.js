// @req FR-252 — stale computed catalogs cannot be disclosed as current prices.
// @spec ADR-097; SEC-001
import { describe, expect, it, vi } from 'vitest'
import { assertPricingCatalogCurrent } from '@/modules/commerce/pricing-publication'

const now = new Date('2026-09-17T01:00:00Z')
const asset = { code: `PCAT-${'a'.repeat(64)}`, businessId: 'business', tenantId: 'tenant' }
const calculation = { ruleSetId: 'rules', ruleVersion: 2, rulesHash: 'hash', inputProvenance: 'INVENTORY_LEDGER' }
const policy = { id: 'rules', version: 2, rulesHash: 'hash', status: 'APPROVED', expiresAt: null }
function database(row = policy, calculations = [calculation]) {
  return { pricingCalculation: { findMany: vi.fn().mockResolvedValue(calculations) }, pricingRuleSet: { findFirst: vi.fn().mockResolvedValue(row) } }
}

describe('computed catalog live authority', () => {
  it('leaves ordinary catalog files under existing Knowledge authorization', async () => {
    const db = database()
    await assertPricingCatalogCurrent({ ...asset, code: 'manufacturer-catalog' }, { db, now })
    expect(db.pricingCalculation.findMany).not.toHaveBeenCalled()
  })
  it('accepts only the exact current scoped approved policy and verified ledger snapshots', async () => {
    const db = database()
    await assertPricingCatalogCurrent(asset, { db, now })
    expect(db.pricingCalculation.findMany.mock.calls[0][0].where).toMatchObject({ businessId: 'business', tenantId: 'tenant' })
    expect(db.pricingRuleSet.findFirst.mock.calls[0][0].where).toMatchObject({ businessId: 'business', tenantId: 'tenant', effectiveFrom: { lte: now } })
  })
  it.each([
    ['revoked', { ...policy, status: 'REVOKED' }],
    ['expired at the exact boundary', { ...policy, expiresAt: now }],
    ['superseded', { ...policy, id: 'replacement' }],
    ['changed hash', { ...policy, rulesHash: 'changed' }],
    ['changed revision', { ...policy, version: 3 }],
    ['missing policy', null],
  ])('rejects %s', async (_label, row) => {
    await expect(assertPricingCatalogCurrent(asset, { db: database(row), now })).rejects.toMatchObject({ status: 409, code: 'PRICING_CATALOG_NOT_CURRENT' })
  })
  it.each([{ rows: [] }, { rows: [{ ...calculation, inputProvenance: 'USER_ENTERED' }] }])('rejects missing or trial-only calculation provenance', async ({ rows }) => {
    await expect(assertPricingCatalogCurrent(asset, { db: database(policy, rows), now })).rejects.toMatchObject({ status: 409 })
  })
  it('fails closed on malformed reserved identities', async () => {
    await expect(assertPricingCatalogCurrent({ ...asset, code: 'PCAT-invalid' }, { db: database(), now })).rejects.toMatchObject({ status: 409 })
  })
})
