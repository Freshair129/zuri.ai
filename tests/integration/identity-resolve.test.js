import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import { resolveLineIdentity, revokeLineIdentity } from '@/modules/identity/resolve-line-identity'

// @req FR-021 — LINE ↔ Person identity resolution: the guarantees the whole
// identity layer (ADR-007 P3) rests on.

let tenantA, tenantB

describe('resolveLineIdentity (FR-021)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Identity Group', code: 'PF-IDN' })
    tenantA = await createTenant({ portfolioId: pf.id, name: 'Idn Tenant A', code: 'TNT-IDN-A' })
    tenantB = await createTenant({ portfolioId: pf.id, name: 'Idn Tenant B', code: 'TNT-IDN-B' })
  })

  it('refuses to mint identity without a resolved tenant', async () => {
    await expect(resolveLineIdentity({ tenantId: 'does-not-exist', lineUserId: 'U1' })).rejects.toThrow(/tenant/i)
  })

  it('first contact creates a Person + mapping; a repeat is idempotent (same personId)', async () => {
    const first = await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Uaaa', displayName: 'สมชาย' })
    expect(first.created).toBe(true)
    expect(first.personId).toBeTruthy()
    const second = await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Uaaa' })
    expect(second.created).toBe(false)
    expect(second.personId).toBe(first.personId)
    // The Person carries the display name captured on first contact.
    const person = await prisma.person.findUnique({ where: { id: first.personId } })
    expect(person.displayName).toBe('สมชาย')
  })

  it('is tenant-scoped: the same LINE id in another tenant is a different Person', async () => {
    const a = await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Ushared' })
    const b = await resolveLineIdentity({ tenantId: tenantB.id, lineUserId: 'Ushared' })
    expect(b.personId).not.toBe(a.personId)
    // And two separate mapping rows exist, one per tenant.
    const rows = await prisma.externalIdentity.findMany({ where: { provider: 'LINE', providerSubject: 'Ushared' } })
    expect(rows).toHaveLength(2)
  })

  it('audits the link on first contact', async () => {
    const r = await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Uaudit' })
    const events = await prisma.auditEvent.findMany({ where: { entityId: r.externalIdentityId, action: 'LINKED' } })
    expect(events).toHaveLength(1)
    expect(events[0].actorType).toBe('LINE')
  })

  it('a revoked identity refuses to resolve until re-linked', async () => {
    await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Urevoke' })
    await revokeLineIdentity(tenantA.id, 'Urevoke')
    await expect(resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Urevoke' })).rejects.toThrow(/revoked/i)
  })

  it('never lets a bare providerSubject leak across tenants (explicit scoping)', async () => {
    // Resolving in tenant B must not return tenant A's person for the same LINE id.
    const inA = await resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'Uleak' })
    const inB = await resolveLineIdentity({ tenantId: tenantB.id, lineUserId: 'Uleak' })
    const personA = await prisma.person.findUnique({ where: { id: inA.personId } })
    const membershipCrossCheck = inB.personId !== personA.id
    expect(membershipCrossCheck).toBe(true)
  })
})
