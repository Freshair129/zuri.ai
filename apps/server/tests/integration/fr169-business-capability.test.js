// @req FR-169 — updateBusinessCapability is the only writer of
//   Business.capabilitiesJson: OWNER-scoped, expected-version CAS, one
//   AuditEvent per real change, a no-op patch bumps neither.
// @spec BR-001, SEC-003
// @tested tests/integration/fr169-business-capability.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { updateBusinessCapability } from '@/modules/business/application/business-capability-service'
import { businessHasCapability } from '@/lib/business-capabilities'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

describe('FR-169 Business capability toggle', () => {
  let business

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR169 ${suffix}`, code: `PF-F169-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `FR169 T ${suffix}`, code: `TNT-F169-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `FR169 Biz ${suffix}`, code: `BUS-F169-${suffix}` })
  })

  const owner = () => makeViewer({ ownedBusinessIds: [business.id], visibleBusinessIds: [business.id] })

  it('a new Business reads physicalStock true even though the column has never been set', () => {
    expect(businessHasCapability(business, 'physicalStock')).toBe(true)
  })

  it('an OWNER turns physicalStock off, bumps version, and records one AuditEvent', async () => {
    const result = await updateBusinessCapability(
      business.id,
      { version: business.version, capability: 'physicalStock', enabled: false },
      { viewer: owner() },
    )
    expect(result.capabilities.physicalStock).toBe(false)
    expect(result.version).toBe(business.version + 1)

    const row = await prisma.business.findUnique({ where: { id: business.id } })
    expect(businessHasCapability(row, 'physicalStock')).toBe(false)
    expect(row.version).toBe(business.version + 1)

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: 'BUSINESS', entityId: business.id, action: 'CAPABILITY_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(event).toBeTruthy()
    expect(JSON.parse(event.payloadJson)).toMatchObject({ capability: 'physicalStock', from: true, to: false })

    business = row
  })

  it('the stale version is refused with 409, and nothing changes', async () => {
    await expect(
      updateBusinessCapability(business.id, { version: business.version - 1, capability: 'physicalStock', enabled: true }, { viewer: owner() }),
    ).rejects.toMatchObject({ status: 409 })
    const row = await prisma.business.findUnique({ where: { id: business.id } })
    expect(businessHasCapability(row, 'physicalStock')).toBe(false)
  })

  it('setting the same value again is a no-op: no version bump, no new AuditEvent', async () => {
    const before = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS', entityId: business.id, action: 'CAPABILITY_CHANGED' } })
    const result = await updateBusinessCapability(business.id, { version: business.version, capability: 'physicalStock', enabled: false }, { viewer: owner() })
    expect(result.version).toBe(business.version)
    const after = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS', entityId: business.id, action: 'CAPABILITY_CHANGED' } })
    expect(after).toBe(before)
  })

  it('refuses a viewer who does not own this Business', async () => {
    await expect(
      updateBusinessCapability(business.id, { version: business.version, capability: 'physicalStock', enabled: true }, { viewer: ownsElsewhere() }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('refuses an unknown capability name and a non-boolean enabled', async () => {
    await expect(
      updateBusinessCapability(business.id, { version: business.version, capability: 'notReal', enabled: true }, { viewer: owner() }),
    ).rejects.toThrow()
    await expect(
      updateBusinessCapability(business.id, { version: business.version, capability: 'physicalStock', enabled: 'yes' }, { viewer: owner() }),
    ).rejects.toThrow()
  })

  it('a Business that does not exist is refused with 404', async () => {
    await expect(
      updateBusinessCapability('does-not-exist', { version: 1, capability: 'physicalStock', enabled: true }, { viewer: owner() }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
