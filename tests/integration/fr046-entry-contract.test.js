import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { buildViewerEntry, zEntryResponse } from '@/modules/identity/entry-read-model'

// @req FR-046 — the entry read model never returns a Business outside viewer Membership scope.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/integration/fr046-entry-contract.test.js

describe('FR-046 viewer-scoped entry integration', () => {
  it('returns only the member Business and its own Tenant/Portfolio ancestry', async () => {
    const portfolio = await createPortfolio({ name: 'Entry Group', code: 'PF-F46' })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: 'Entry Tenant A', code: 'TNT-F46-A' })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: 'Entry Tenant B', code: 'TNT-F46-B' })
    const businessA = await createBusiness({ tenantId: tenantA.id, name: 'Entry Business A', code: 'BUS-F46-A' })
    const businessB = await createBusiness({ tenantId: tenantB.id, name: 'Entry Business B', code: 'BUS-F46-B' })
    const person = await prisma.person.create({
      data: { code: 'PER-F46-MEMBER', displayName: 'FR046 Member' },
    })
    await prisma.membership.create({
      data: {
        personId: person.id,
        tenantId: tenantA.id,
        businessId: businessA.id,
        role: 'MEMBER',
        domainKeysJson: JSON.stringify(['Development']),
      },
    })

    const viewer = await resolveViewer({
      principalId: person.id,
      allowDevelopmentFallback: false,
      db: prisma,
    })
    const entry = await buildViewerEntry({ viewer, db: prisma })

    expect(zEntryResponse.parse(entry)).toEqual(entry)
    expect(entry.businesses.map((business) => business.id)).toEqual([businessA.id])
    expect(entry.businesses[0].tenant.id).toBe(tenantA.id)
    expect(entry.businesses[0].portfolio.id).toBe(portfolio.id)
    expect(JSON.stringify(entry)).not.toContain(businessB.id)
    expect(entry.viewer).not.toHaveProperty('visibleBusinessIds')
  })
})
