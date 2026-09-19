import { describe, expect, it, vi } from 'vitest'
import { listAccessHistory, listBusinessAccess } from '@/modules/identity/access-history-service'
import { makeViewer } from '../factories/viewer'

// @req FR-199 — the read models that did not exist: a Business owner could not
//   see who was granted access to their own Business, when, or by whom, even
//   though ADR-077 built an entire lifecycle assuming that review was possible
//   (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-080 D3/D4, BR-036, SEC-001

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

const operator = async () => makeViewer({ role: 'DEV', principal: { id: 'dev-1', code: 'PSN-DEV', displayName: 'Operator' } })

const plainPerson = async () => makeViewer({
  principal: { id: 'person-1', code: 'PSN-1', displayName: 'Staff' },
  visibleBusinessIds: [],
  ownedBusinessIds: [],
})

const EVENT = {
  id: 'ae-1',
  entityType: 'MEMBERSHIP',
  entityId: 'm-1',
  action: 'MEMBERSHIP_GRANTED',
  payloadJson: '{}',
  actorId: 'owner-a',
  actorType: 'LOCAL_USER',
  tenantId: 'tenant-1',
  businessId: 'business-a',
  reason: 'joined marketing',
  beforeJson: null,
  afterJson: JSON.stringify({ status: 'ACTIVE' }),
  occurredAt: new Date('2026-09-12T10:00:00Z'),
}

function makeDb(over = {}) {
  const db = {
    auditEvent: { findMany: vi.fn().mockResolvedValue([EVENT]), ...over.auditEvent },
    membership: {
      findMany: vi.fn().mockResolvedValue([]),
      ...over.membership,
    },
    roleBinding: { findMany: vi.fn().mockResolvedValue([]), ...over.roleBinding },
    // A person scope resolves invite ids the same relational way it resolves
    // Membership and RoleBinding ids — an ACCESS_INVITE row's entityId is the
    // invite's id, never the person's — so the mock needs this table too.
    accessInvite: { findMany: vi.fn().mockResolvedValue([]), ...over.accessInvite },
    person: {
      findMany: vi.fn().mockResolvedValue([{ id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' }]),
      ...over.person,
    },
  }
  return db
}

describe('listAccessHistory — scope authority', () => {
  it('refuses a business the caller does not own, 404-shaped', async () => {
    const db = makeDb()
    await expect(
      listAccessHistory({ businessId: 'business-z' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('answers the same 404 for an unowned business as for one that does not exist', async () => {
    const db = makeDb()
    const unowned = await listAccessHistory({ businessId: 'business-z' }, { db, resolve: businessOwner }).catch((e) => e)
    const missing = await listAccessHistory({ businessId: 'does-not-exist' }, { db, resolve: businessOwner }).catch((e) => e)
    expect(unowned.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(unowned.message).toBe(missing.message)
  })

  it('allows a business owner to read their own Business', async () => {
    const db = makeDb()
    const result = await listAccessHistory({ businessId: 'business-a' }, { db, resolve: businessOwner })
    expect(result.events).toHaveLength(1)
    expect(db.auditEvent.findMany).toHaveBeenCalled()
  })

  it('requires ownsTenant for a tenant scope — a business owner is refused', async () => {
    const db = makeDb()
    await expect(
      listAccessHistory({ tenantId: 'tenant-1' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      listAccessHistory({ tenantId: 'tenant-1' }, { db, resolve: tenantOwner }),
    ).resolves.toMatchObject({ tenantId: 'tenant-1' })
  })

  it('allows a caller to read their own personId scope, refuses another persons', async () => {
    const db = makeDb()
    await expect(
      listAccessHistory({ personId: 'person-1' }, { db, resolve: plainPerson }),
    ).resolves.toMatchObject({ personId: 'person-1' })
    await expect(
      listAccessHistory({ personId: 'someone-else' }, { db, resolve: plainPerson }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('lets the installation operator read any scope', async () => {
    const db = makeDb()
    await expect(
      listAccessHistory({ businessId: 'business-z' }, { db, resolve: operator }),
    ).resolves.toMatchObject({ businessId: 'business-z' })
  })

  it('refuses a query naming zero or more than one scope', async () => {
    const db = makeDb()
    await expect(listAccessHistory({}, { db, resolve: businessOwner })).rejects.toMatchObject({ status: 400 })
    await expect(
      listAccessHistory({ businessId: 'business-a', tenantId: 'tenant-1' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('listAccessHistory — shape', () => {
  it('joins the actor to {id, code, displayName}', async () => {
    const db = makeDb()
    const result = await listAccessHistory({ businessId: 'business-a' }, { db, resolve: businessOwner })
    expect(result.events[0].actor).toMatchObject({ id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' })
  })

  it('carries reason and before/after as top-level fields, not only inside payload', async () => {
    const db = makeDb()
    const result = await listAccessHistory({ businessId: 'business-a' }, { db, resolve: businessOwner })
    expect(result.events[0].reason).toBe('joined marketing')
    expect(result.events[0].after).toEqual({ status: 'ACTIVE' })
  })

  it('returns null actor rather than throwing when actorId has no matching Person', async () => {
    const db = makeDb({ person: { findMany: vi.fn().mockResolvedValue([]) } })
    const result = await listAccessHistory({ businessId: 'business-a' }, { db, resolve: businessOwner })
    expect(result.events[0].actor).toMatchObject({ id: 'owner-a' })
  })

  it('resolves a personId scope by joining through Membership/RoleBinding ids, not a personId column', async () => {
    const db = makeDb({
      membership: { findMany: vi.fn().mockResolvedValue([{ id: 'm-1' }]) },
      roleBinding: { findMany: vi.fn().mockResolvedValue([{ id: 'rb-1' }]) },
      accessInvite: { findMany: vi.fn().mockResolvedValue([{ id: 'inv-1' }]) },
    })
    await listAccessHistory({ personId: 'person-1' }, { db, resolve: plainPerson })
    const where = db.auditEvent.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'MEMBERSHIP', entityId: { in: ['m-1'] } }),
      expect.objectContaining({ entityType: 'ROLE_BINDING', entityId: { in: ['rb-1'] } }),
      // An invite is resolved the same way, and for the same reason: its
      // entityId is the INVITE's id. Matching it against `personId` — which is
      // what this did before — could never return a row, so the arm looked
      // present and answered nothing.
      expect.objectContaining({ entityType: 'ACCESS_INVITE', entityId: { in: ['inv-1'] } }),
    ]))
    expect(where.OR).not.toContainEqual(
      expect.objectContaining({ entityType: 'ACCESS_INVITE', entityId: 'person-1' }),
    )
    // Addressed-to or answered-by; both are how a person came to have access.
    expect(db.accessInvite.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ targetPersonId: 'person-1' }, { acceptedByPersonId: 'person-1' }],
    })
  })
})

describe('listBusinessAccess', () => {
  it('refuses a business the caller does not own, 404-shaped', async () => {
    const db = makeDb()
    await expect(
      listBusinessAccess({ businessId: 'business-z' }, { db, resolve: businessOwner }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('requires a businessId', async () => {
    const db = makeDb()
    await expect(listBusinessAccess({}, { db, resolve: businessOwner })).rejects.toMatchObject({ status: 400 })
  })

  it('returns every grant in every status, with provenance', async () => {
    const grants = [
      { id: 'm-1', personId: 'p-1', role: 'MEMBER', status: 'ACTIVE', scopeType: 'BUSINESS', domainKeysJson: '["projects"]', grantedByPersonId: 'owner-a', grantReason: 'joined', grantSource: 'ADMIN', expiresAt: null, suspendedAt: null, revokedAt: null, revokedByPersonId: null, revokeReason: null, createdAt: new Date(), person: { id: 'p-1', code: 'PSN-1', displayName: 'Staff' }, grantedBy: { id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' }, revokedBy: null },
      { id: 'm-2', personId: 'p-2', role: 'MEMBER', status: 'REVOKED', scopeType: 'BUSINESS', domainKeysJson: '[]', grantedByPersonId: 'owner-a', grantReason: null, grantSource: 'ADMIN', expiresAt: null, suspendedAt: null, revokedAt: new Date(), revokedByPersonId: 'owner-a', revokeReason: 'left the company', createdAt: new Date(), person: { id: 'p-2', code: 'PSN-2', displayName: 'Former Staff' }, grantedBy: { id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' }, revokedBy: { id: 'owner-a', code: 'PSN-OWNER-A', displayName: 'Owner A' } },
    ]
    const db = makeDb({ membership: { findMany: vi.fn().mockResolvedValue(grants) } })
    const result = await listBusinessAccess({ businessId: 'business-a' }, { db, resolve: businessOwner })
    expect(result.grants).toHaveLength(2)
    const revoked = result.grants.find((g) => g.status === 'REVOKED')
    expect(revoked.revokeReason).toBe('left the company')
    expect(revoked.revokedBy).toMatchObject({ displayName: 'Owner A' })
    expect(result.grants.find((g) => g.id === 'm-1').domainKeys).toEqual(['projects'])
  })

  it('lets a tenant-wide owner read a Business they own through the Tenant', async () => {
    const db = makeDb()
    await expect(
      listBusinessAccess({ businessId: 'business-a' }, { db, resolve: tenantOwner }),
    ).resolves.toMatchObject({ businessId: 'business-a' })
  })
})
