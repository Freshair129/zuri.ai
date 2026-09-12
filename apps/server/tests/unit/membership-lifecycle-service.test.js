import { describe, expect, it, vi } from 'vitest'
import {
  suspendMembership,
  reinstateMembership,
  revokeMembership,
  offboardPerson,
} from '@/modules/identity/membership-lifecycle-service'
import { makeViewer } from '../factories/viewer'

// @req FR-191 — the writer that did not exist. Before ADR-077, `Membership.status`
// had no writer anywhere in the repository, so every assertion in this file
// describes behaviour that was previously unreachable
// (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-077 D2, BR-033, SEC-001, NFR-019

const businessOwner = async () => makeViewer({
  principal: { id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' },
  visibleBusinessIds: ['business-a'],
  ownedBusinessIds: ['business-a'],
})

const tenantOwner = async () => makeViewer({
  principal: { id: 'owner-t', code: 'PSN-OWNER-T', displayName: 'Tenant Owner' },
  visibleBusinessIds: ['business-a', 'business-b'],
  ownedBusinessIds: ['business-a', 'business-b'],
  ownedTenantIds: ['tenant-1'],
})

const GRANT = {
  id: 'm-1',
  personId: 'person-1',
  tenantId: 'tenant-1',
  businessId: 'business-a',
  scopeType: 'BUSINESS',
  role: 'MEMBER',
  status: 'ACTIVE',
}

/**
 * A db double whose `$transaction` runs the callback against itself, which is
 * what the services assume. Counts default to values that make the happy path
 * pass; a test that cares overrides the one it is about.
 */
function makeDb(over = {}) {
  const db = {
    membership: {
      findUnique: vi.fn().mockResolvedValue(GRANT),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(async ({ data }) => ({ ...GRANT, ...data })),
      count: vi.fn().mockResolvedValue(1),
      ...over.membership,
    },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...over.roleBinding,
    },
    session: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), ...over.session },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  }
  db.$transaction = async (fn) => fn(db)
  return db
}

const auditActions = (db) => db.auditEvent.create.mock.calls.map(([{ data }]) => data.action)

describe('membership lifecycle — authority', () => {
  it('refuses a business owner a grant in a Business they do not own, 404-shaped', async () => {
    const db = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue({ ...GRANT, businessId: 'business-z' }) } })
    await expect(
      suspendMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers a missing membership with the SAME status as an unowned one', async () => {
    // SEC-001: if these differed, the route would confirm which ids exist in
    // other tenants. Asserted together on purpose — the pair is the control.
    const missing = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue(null) } })
    const unowned = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue({ ...GRANT, businessId: 'business-z' }) } })

    const a = await suspendMembership({ membershipId: 'm-1', reason: 'x' }, { db: missing, resolve: businessOwner }).catch((e) => e)
    const b = await suspendMembership({ membershipId: 'm-1', reason: 'x' }, { db: unowned, resolve: businessOwner }).catch((e) => e)
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
    expect(a.message).toBe(b.message)
  })

  it('requires TENANT authority for a tenant-wide grant, not Business ownership', async () => {
    const tenantWide = { ...GRANT, scopeType: 'TENANT', businessId: null }
    const db = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue(tenantWide) } })
    // A business owner owns every Business the tenant-wide grant covers and
    // still may not touch it — the grant is at a scope above them.
    await expect(
      suspendMembership({ membershipId: 'm-1', reason: 'x' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })

    const ok = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue(tenantWide) } })
    await expect(
      suspendMembership({ membershipId: 'm-1', reason: 'x' }, { db: ok, resolve: tenantOwner }),
    ).resolves.toMatchObject({ status: 'SUSPENDED' })
  })

  it('refuses every transition without a reason', async () => {
    for (const run of [suspendMembership, reinstateMembership, revokeMembership]) {
      await expect(run({ membershipId: 'm-1' }, { db: makeDb(), resolve: businessOwner })).rejects.toThrow()
      await expect(run({ membershipId: 'm-1', reason: '   ' }, { db: makeDb(), resolve: businessOwner })).rejects.toThrow()
    }
  })
})

describe('membership lifecycle — transitions', () => {
  it('suspends, stamps suspendedAt and writes MEMBERSHIP_SUSPENDED', async () => {
    const db = makeDb()
    const result = await suspendMembership({ membershipId: 'm-1', reason: 'on leave' }, { db, resolve: businessOwner })
    expect(result.status).toBe('SUSPENDED')
    expect(db.membership.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUSPENDED', suspendedAt: expect.any(Date) }),
    }))
    expect(auditActions(db)).toContain('MEMBERSHIP_SUSPENDED')
  })

  it('records who revoked and why, on the row rather than only in the stream', async () => {
    const db = makeDb()
    await revokeMembership({ membershipId: 'm-1', reason: 'left the company' }, { db, resolve: businessOwner })
    expect(db.membership.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'REVOKED',
        revokedAt: expect.any(Date),
        revokedByPersonId: 'owner-a',
        revokeReason: 'left the company',
      }),
    }))
  })

  it('never deletes a revoked grant', async () => {
    const db = makeDb()
    db.membership.delete = vi.fn()
    await revokeMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner })
    expect(db.membership.delete).not.toHaveBeenCalled()
  })

  it('treats REVOKED as terminal — reinstating is refused, not silently accepted', async () => {
    const db = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue({ ...GRANT, status: 'REVOKED' }) } })
    await expect(
      reinstateMembership({ membershipId: 'm-1', reason: 'came back' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 409, message: 'REVOKED_IS_TERMINAL' })
  })

  it('refuses a transition to the state the grant is already in', async () => {
    const suspended = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue({ ...GRANT, status: 'SUSPENDED' }) } })
    await expect(
      suspendMembership({ membershipId: 'm-1', reason: 'x' }, { db: suspended, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 409, message: 'ALREADY_SUSPENDED' })
  })
})

describe('membership lifecycle — last owner', () => {
  const ownerGrant = { ...GRANT, role: 'OWNER' }

  it('refuses to leave a Business with no live owner', async () => {
    const db = makeDb({
      membership: {
        findUnique: vi.fn().mockResolvedValue(ownerGrant),
        count: vi.fn().mockResolvedValue(0), // no sibling owner
      },
    })
    await expect(
      revokeMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 409, message: 'LAST_OWNER' })
  })

  it('allows it when another live owner remains', async () => {
    const db = makeDb({
      membership: { findUnique: vi.fn().mockResolvedValue(ownerGrant), count: vi.fn().mockResolvedValue(1) },
    })
    await expect(
      revokeMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner }),
    ).resolves.toMatchObject({ status: 'REVOKED' })
  })

  it('lets a tenant owner override, and does not let a business owner', async () => {
    const dbBusiness = makeDb({
      membership: { findUnique: vi.fn().mockResolvedValue(ownerGrant), count: vi.fn().mockResolvedValue(0) },
    })
    await expect(
      revokeMembership({ membershipId: 'm-1', reason: 'x', allowLast: true }, { db: dbBusiness, resolve: businessOwner }),
    ).rejects.toMatchObject({ message: 'LAST_OWNER' })

    const dbTenant = makeDb({
      membership: { findUnique: vi.fn().mockResolvedValue(ownerGrant), count: vi.fn().mockResolvedValue(0) },
    })
    await expect(
      revokeMembership({ membershipId: 'm-1', reason: 'x', allowLast: true }, { db: dbTenant, resolve: tenantOwner }),
    ).resolves.toMatchObject({ status: 'REVOKED' })
  })

  it('does not apply the guard to a MEMBER grant', async () => {
    const db = makeDb({ membership: { findUnique: vi.fn().mockResolvedValue(GRANT), count: vi.fn().mockResolvedValue(0) } })
    await expect(
      revokeMembership({ membershipId: 'm-1', reason: 'x' }, { db, resolve: businessOwner }),
    ).resolves.toMatchObject({ status: 'REVOKED' })
  })
})

describe('membership lifecycle — role binding cascade', () => {
  const bindings = [{ id: 'rb-1', roleKey: 'INVENTORY_MANAGER', businessId: 'business-a' }]

  it('suspends the bindings that depend on the grant, tagged with its id', async () => {
    const db = makeDb({ roleBinding: { findMany: vi.fn().mockResolvedValue(bindings) } })
    const result = await suspendMembership({ membershipId: 'm-1', reason: 'leave' }, { db, resolve: businessOwner })
    expect(result.cascadedBindings).toEqual(['rb-1'])
    expect(db.roleBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUSPENDED', cascadeOfMembershipId: 'm-1' }),
    }))
    expect(auditActions(db)).toContain('ROLE_BINDING_SUSPENDED')
  })

  it('restores only the bindings this membership took down', async () => {
    // The tag is the whole point: without it, reinstating a person would
    // re-grant a capability someone had deliberately removed.
    const db = makeDb({
      membership: { findUnique: vi.fn().mockResolvedValue({ ...GRANT, status: 'SUSPENDED' }) },
      roleBinding: { findMany: vi.fn().mockResolvedValue([{ id: 'rb-1', roleKey: 'INVENTORY_MANAGER' }]) },
    })
    await reinstateMembership({ membershipId: 'm-1', reason: 'back' }, { db, resolve: businessOwner })
    expect(db.roleBinding.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cascadeOfMembershipId: 'm-1', status: 'SUSPENDED' }),
    }))
    expect(db.roleBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ACTIVE', cascadeOfMembershipId: null }),
    }))
  })

  it('revokes bindings when the grant is revoked', async () => {
    const db = makeDb({ roleBinding: { findMany: vi.fn().mockResolvedValue(bindings) } })
    await revokeMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner })
    expect(db.roleBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REVOKED' }),
    }))
    expect(auditActions(db)).toContain('ROLE_BINDING_REVOKED')
  })
})

describe('membership lifecycle — sessions', () => {
  it('revokes sessions once no live grant remains', async () => {
    const db = makeDb({ membership: { count: vi.fn().mockResolvedValue(0) }, session: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } })
    // `count` is used by both the last-owner guard and the stranded check; a
    // MEMBER grant skips the first, so this exercises only the second.
    await revokeMembership({ membershipId: 'm-1', reason: 'left' }, { db, resolve: businessOwner })
    expect(db.session.updateMany).toHaveBeenCalled()
  })

  it('leaves sessions alone while another grant is live', async () => {
    const db = makeDb({ membership: { count: vi.fn().mockResolvedValue(1) } })
    await revokeMembership({ membershipId: 'm-1', reason: 'left one business' }, { db, resolve: businessOwner })
    expect(db.session.updateMany).not.toHaveBeenCalled()
  })
})

describe('offboard', () => {
  it('needs tenant authority, not Business ownership', async () => {
    await expect(
      offboardPerson({ personId: 'person-1', tenantId: 'tenant-1', reason: 'left' }, { db: makeDb(), resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('revokes every live grant and writes both shapes of audit event', async () => {
    const db = makeDb({
      membership: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'm-1', businessId: 'business-a', scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' },
          { id: 'm-2', businessId: 'business-b', scopeType: 'BUSINESS', role: 'OWNER', status: 'SUSPENDED' },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      roleBinding: { findMany: vi.fn().mockResolvedValue([{ id: 'rb-1', roleKey: 'SALES_REP', businessId: 'business-a' }]) },
    })
    const result = await offboardPerson(
      { personId: 'person-1', tenantId: 'tenant-1', reason: 'resigned 2026-09-03' },
      { db, resolve: tenantOwner },
    )
    expect(result.revokedMemberships).toEqual(['m-1', 'm-2'])
    expect(result.revokedBindings).toEqual(['rb-1'])
    // One event answers "what happened to this person", the per-grant events
    // answer "what happened to this grant". Both, deliberately.
    expect(auditActions(db)).toContain('OFFBOARDED')
    expect(auditActions(db).filter((a) => a === 'MEMBERSHIP_REVOKED')).toHaveLength(2)
  })

  it('does not apply the last-owner guard — offboarding is deliberate', async () => {
    const db = makeDb({
      membership: {
        findMany: vi.fn().mockResolvedValue([{ id: 'm-1', businessId: 'business-a', scopeType: 'BUSINESS', role: 'OWNER', status: 'ACTIVE' }]),
        count: vi.fn().mockResolvedValue(0),
      },
    })
    await expect(
      offboardPerson({ personId: 'person-1', tenantId: 'tenant-1', reason: 'left' }, { db, resolve: tenantOwner }),
    ).resolves.toMatchObject({ revokedMemberships: ['m-1'] })
  })
})
