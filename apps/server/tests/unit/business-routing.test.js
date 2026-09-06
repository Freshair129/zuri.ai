import { describe, expect, it } from 'vitest'
import { buildBusinessRouting } from '@/lib/business-routing'

// @req FR-044 — Business Routing is the viewer-authorized pre-shell selection boundary.
// @spec ADR-015, SDD-022
// @tested tests/unit/business-routing.test.js

const portfolios = [
  { id: 'portfolio-a', code: 'PF-A', name: 'Portfolio A' },
  { id: 'portfolio-b', code: 'PF-B', name: 'Portfolio B' },
]
const tenants = [
  { id: 'tenant-a', code: 'TNT-A', name: 'Tenant A', portfolioId: 'portfolio-a' },
  { id: 'tenant-b', code: 'TNT-B', name: 'Tenant B', portfolioId: 'portfolio-b' },
]
const businesses = [
  { id: 'business-a', code: 'BUS-A', name: 'Business A', tenantId: 'tenant-a' },
  { id: 'business-b', code: 'BUS-B', name: 'Business B', tenantId: 'tenant-b' },
]

describe('FR-044 Business Routing', () => {
  it('filters the scope inventory by viewer-visible Business IDs', () => {
    const result = buildBusinessRouting({
      viewer: { visibleBusinessIds: ['business-b'] },
      portfolios,
      tenants,
      businesses,
    })

    expect(result.map((item) => item.business.id)).toEqual(['business-b'])
  })

  it('keeps Portfolio and Tenant as ancestry labels for each Business', () => {
    const [result] = buildBusinessRouting({
      viewer: { visibleBusinessIds: ['business-a'] },
      portfolios,
      tenants,
      businesses,
    })

    expect(result.portfolio).toMatchObject({ id: 'portfolio-a', name: 'Portfolio A' })
    expect(result.tenant).toMatchObject({ id: 'tenant-a', name: 'Tenant A' })
  })

  it('does not infer access from a parent Portfolio or Tenant', () => {
    expect(buildBusinessRouting({ portfolios, tenants, businesses })).toEqual([])
  })

  it('keeps a single authorized Business visible for explicit selection', () => {
    const result = buildBusinessRouting({
      viewer: { visibleBusinessIds: ['business-a'] },
      portfolios,
      tenants,
      businesses,
    })

    expect(result).toHaveLength(1)
    expect(result[0].business.id).toBe('business-a')
  })
})
