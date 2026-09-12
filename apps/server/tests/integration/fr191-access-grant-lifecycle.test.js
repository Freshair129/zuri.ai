import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import {
  suspendMembership,
  reinstateMembership,
  revokeMembership,
  offboardPerson,
  listPersonAccess,
} from '@/modules/identity/membership-lifecycle-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'

// @req FR-191, FR-192 — the lifecycle against real rows, because the defect this
//   closes was invisible to unit tests by construction: every reader filtered on
//   `status === 'ACTIVE'` and passed, while no writer existed to produce any
//   other value (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
//   What is asserted here is the round trip — a grant written by one service and
//   read by `resolveViewer`, which is the pair a mocked db cannot prove.
// @spec ADR-077 D2/D3/D6, BR-033, SEC-026, NFR-019

const suffix = randomUUID().slice(0, 6)
const ids = {}

async function scope() {
  const portfolio = await prisma.portfolio.create({ data: { code: `PF-L${suffix}`, name: 'Lifecycle' } })
  const tenant = await prisma.tenant.create({ data: { code: `TNT-L${suffix}`, name: 'Lifecycle', portfolioId: portfolio.id } })
  const businessA = await prisma.business.create({ data: { code: `BUS-LA${suffix}`, name: 'A', tenantId: tenant.id } })
  const businessB = await prisma.business.create({ data: { code: `BUS-LB${suffix}`, name: 'B', tenantId: tenant.id } })
  const person = await prisma.person.create({ data: { code: `PSN-L${suffix}`, displayName: 'Staff', email: `staff.${suffix}@example.com` } })
  const owner = await prisma.person.create({ data: { code: `PSN-LO${suffix}`, displayName: 'Owner', email: `owner.${suffix}@example.com` } })
  return { tenant, businessA, businessB, person, owner }
}

const ownerViewer = () => makeViewer({
  principal: { id: ids.owner.id, code: ids.owner.code, displayName: ids.owner.displayName },
  visibleBusinessIds: [ids.businessA.id, ids.businessB.id],
  ownedBusinessIds: [ids.businessA.id, ids.businessB.id],
  ownedTenantIds: [ids.tenant.id],
})

beforeAll(async () => {
  Object.assign(ids, await scope())
})

describe('FR-192 — scope is a declared value', () => {
  it('a tenant-wide grant reaches every Business; a business-scoped one reaches only its own', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-TW${suffix}`, displayName: 'Wide' } })
    await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: null, scopeType: 'TENANT',
      role: 'MEMBER', domainKeys: ['projects'], grantSource: 'SEED', actorId: ids.owner.id,
    })
    const wide = await resolveViewer({ principalId: person.id })
    expect(wide.visibleBusinessIds.sort()).toEqual([ids.businessA.id, ids.businessB.id].sort())

    const narrowPerson = await prisma.person.create({ data: { code: `PSN-NW${suffix}`, displayName: 'Narrow' } })
    await grantBusinessMembership({
      personId: narrowPerson.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: ['projects'], actorId: ids.owner.id,
    })
    const narrow = await resolveViewer({ principalId: narrowPerson.id })
    expect(narrow.visibleBusinessIds).toEqual([ids.businessA.id])
  })

  it('refuses a scope whose shape disagrees with itself', async () => {
    await expect(grantBusinessMembership({
      personId: ids.person.id, tenantId: ids.tenant.id, businessId: null, scopeType: 'BUSINESS',
    })).rejects.toMatchObject({ status: 400 })
    await expect(grantBusinessMembership({
      personId: ids.person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id, scopeType: 'TENANT',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a second live grant for the same scope, and allows one after revocation', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-D${suffix}`, displayName: 'Dup' } })
    const first = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessB.id,
      role: 'MEMBER', domainKeys: [], actorId: ids.owner.id,
    })
    await expect(grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessB.id,
    })).rejects.toMatchObject({ status: 409 })

    await revokeMembership({ membershipId: first.id, reason: 'left' }, { resolve: async () => ownerViewer() })
    // The partial unique index excludes REVOKED precisely so this is possible:
    // the old grant stays as evidence and the new one is its own row.
    const second = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessB.id,
      role: 'MEMBER', domainKeys: [], actorId: ids.owner.id,
    })
    expect(second.id).not.toBe(first.id)
    expect(await prisma.membership.findUnique({ where: { id: first.id } })).toMatchObject({ status: 'REVOKED' })
  })
})

describe('FR-191 — a withdrawn grant stops granting', () => {
  it('suspension denies the next resolve, and reinstatement restores it', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-S${suffix}`, displayName: 'Susp' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: ['projects'], actorId: ids.owner.id,
    })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([ids.businessA.id])

    // This is FR-095's promise, reachable for the first time.
    await suspendMembership({ membershipId: grant.id, reason: 'on leave' }, { resolve: async () => ownerViewer() })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([])

    await reinstateMembership({ membershipId: grant.id, reason: 'returned' }, { resolve: async () => ownerViewer() })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([ids.businessA.id])
  })

  it('an expired grant is denied without any row being written', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-X${suffix}`, displayName: 'Exp' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: ['projects'], actorId: ids.owner.id,
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([ids.businessA.id])

    // Time moves, not the row: expiry is recomputed per request (NFR-019).
    const after = await resolveViewer({ principalId: person.id, now: Date.now() + 120_000 })
    expect(after.visibleBusinessIds).toEqual([])
    expect(await prisma.membership.findUnique({ where: { id: grant.id } })).toMatchObject({ status: 'ACTIVE' })
  })

  it('offboarding withdraws every grant in the Tenant at once', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-O${suffix}`, displayName: 'Leaver' } })
    await grantBusinessMembership({ personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id, role: 'MEMBER', domainKeys: [], actorId: ids.owner.id })
    await grantBusinessMembership({ personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessB.id, role: 'MEMBER', domainKeys: [], actorId: ids.owner.id })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toHaveLength(2)

    const result = await offboardPerson(
      { personId: person.id, tenantId: ids.tenant.id, reason: 'resigned' },
      { resolve: async () => ownerViewer() },
    )
    expect(result.revokedMemberships).toHaveLength(2)
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([])

    // The evidence survives the withdrawal — that is the whole difference
    // between this and the hard delete it replaces.
    const access = await listPersonAccess({ personId: person.id, tenantId: ids.tenant.id }, { resolve: async () => ownerViewer() })
    expect(access.memberships).toHaveLength(2)
    expect(access.memberships.every((m) => m.status === 'REVOKED' && m.revokeReason === 'resigned')).toBe(true)
    expect(access.memberships.every((m) => m.revokedByPersonId === ids.owner.id)).toBe(true)
  })

  it('records provenance on the row, not only in the audit stream', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-P${suffix}`, displayName: 'Prov' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: [], grantSource: 'INVITE', reason: 'joined marketing',
      actorId: ids.owner.id,
    })
    const row = await prisma.membership.findUnique({ where: { id: grant.id } })
    expect(row).toMatchObject({
      grantedByPersonId: ids.owner.id,
      grantReason: 'joined marketing',
      grantSource: 'INVITE',
      scopeType: 'BUSINESS',
    })
  })
})

describe('SEC-026 — erasure is downstream of offboarding', () => {
  it('refuses while a live grant remains, and proceeds once offboarded', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-E${suffix}`, displayName: 'Erase', email: `erase.${suffix}@example.com` } })
    await prisma.personCredential.create({ data: { personId: person.id, passwordHash: 'x'.repeat(40) } })
    await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: [], actorId: ids.owner.id,
    })

    await expect(erasePrincipal({ tenantId: ids.tenant.id, personId: person.id, reason: 'pdpa request' }))
      .rejects.toMatchObject({ status: 409, message: 'PRINCIPAL_HAS_LIVE_GRANTS' })

    await offboardPerson({ personId: person.id, tenantId: ids.tenant.id, reason: 'left' }, { resolve: async () => ownerViewer() })
    await erasePrincipal({ tenantId: ids.tenant.id, personId: person.id, reason: 'pdpa request' })

    const erased = await prisma.person.findUnique({ where: { id: person.id } })
    expect(erased.email).toBeNull()
    // A redacted person whose password still works is not erased.
    expect(erased.accessDisabledAt).not.toBeNull()
    expect(await prisma.personCredential.findUnique({ where: { personId: person.id } })).toBeNull()
  })
})
