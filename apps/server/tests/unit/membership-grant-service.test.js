import { describe, expect, it, vi } from 'vitest'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'

// @req FR-191, FR-192 — the one creation path. Three services in two lanes used
// to write this row directly, which is why production carries twelve grants and
// six MEMBERSHIP_ADDED events
// (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-077 D1/D8, BR-033, SDD-092

const ARGS = { personId: 'p-1', tenantId: 't-1', businessId: 'b-1' }

function makeDb(existing = null) {
  return {
    membership: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'm-1', ...data })),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  }
}

const created = (db) => db.membership.create.mock.calls[0][0].data
const audited = (db) => db.auditEvent.create.mock.calls[0][0].data

describe('grant shape', () => {
  it('records provenance on the row, not only in the audit stream', async () => {
    const db = makeDb()
    await grantBusinessMembership({
      ...ARGS, role: 'MEMBER', domainKeys: ['projects'],
      grantSource: 'INVITE', reason: 'joined marketing', actorId: 'owner-1',
    }, { db })
    expect(created(db)).toMatchObject({
      grantedByPersonId: 'owner-1',
      grantReason: 'joined marketing',
      grantSource: 'INVITE',
      scopeType: 'BUSINESS',
      status: 'ACTIVE',
    })
  })

  it('defaults to MEMBER — an omitted role never mints an owner', async () => {
    const db = makeDb()
    await grantBusinessMembership(ARGS, { db })
    expect(created(db).role).toBe('MEMBER')
  })

  it('accepts a null reason, which is what a column carries when unset', async () => {
    // `.optional()` here would reject null and turn every forwarded column value
    // into a 400 — which is exactly what it did on first integration.
    const db = makeDb()
    await expect(grantBusinessMembership({ ...ARGS, reason: null }, { db })).resolves.toBeTruthy()
    expect(created(db).grantReason).toBeNull()
  })

  it('infers scope from businessId, and refuses a shape that contradicts itself', async () => {
    const tenantWide = makeDb()
    await grantBusinessMembership({ personId: 'p-1', tenantId: 't-1', businessId: null }, { db: tenantWide })
    expect(created(tenantWide).scopeType).toBe('TENANT')

    await expect(grantBusinessMembership(
      { personId: 'p-1', tenantId: 't-1', businessId: null, scopeType: 'BUSINESS' }, { db: makeDb() },
    )).rejects.toMatchObject({ status: 400, message: 'BUSINESS_SCOPE_REQUIRES_BUSINESS_ID' })

    await expect(grantBusinessMembership(
      { ...ARGS, scopeType: 'TENANT' }, { db: makeDb() },
    )).rejects.toMatchObject({ status: 400, message: 'TENANT_SCOPE_TAKES_NO_BUSINESS_ID' })
  })

  it('refuses a domain key that is not in the registry', async () => {
    // `crm` is a DOMAIN_GROUPS key. One such value sits on a live production row
    // and resolves to zero domains silently; this is the boundary that stops the
    // next one (FR-192).
    await expect(grantBusinessMembership(
      { ...ARGS, domainKeys: ['crm'] }, { db: makeDb() },
    )).rejects.toThrow()
  })
})

describe('duplicate refusal', () => {
  it('refuses a second grant while a live one exists — including a suspended one', async () => {
    // A SUSPENDED row is still this person's grant for this scope. A second row
    // beside it would leave two grants for one scope, and `resolveViewer` reads
    // both.
    const db = makeDb({ id: 'm-existing' })
    await expect(grantBusinessMembership(ARGS, { db })).rejects.toMatchObject({ status: 409 })
    expect(db.membership.create).not.toHaveBeenCalled()
    expect(db.membership.findFirst.mock.calls[0][0].where.status).toEqual({ in: ['PENDING', 'ACTIVE', 'SUSPENDED'] })
  })

  it('allows a new grant when only a revoked one remains', async () => {
    // The query excludes REVOKED, which is what lets the old grant stay as
    // evidence while the new one is its own row with its own provenance.
    const db = makeDb(null)
    await expect(grantBusinessMembership(ARGS, { db })).resolves.toMatchObject({ id: 'm-1' })
  })
})

describe('audit', () => {
  it('writes exactly one event, under the MEMBERSHIP entityType', async () => {
    const db = makeDb()
    await grantBusinessMembership({ ...ARGS, actorId: 'owner-1' }, { db })
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(audited(db)).toMatchObject({ entityType: 'MEMBERSHIP', action: 'MEMBERSHIP_GRANTED', actorId: 'owner-1' })
  })

  it('lets a caller keep its own action name so history stays keyed', async () => {
    // FR-038's history is keyed to MEMBERSHIP_ADDED and an id is a key
    // (AGENTS.md §18). The family is the entityType, not the verb — so one
    // event, under the caller's name.
    const db = makeDb()
    await grantBusinessMembership({ ...ARGS, action: 'MEMBERSHIP_ADDED' }, { db })
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1)
    expect(audited(db).action).toBe('MEMBERSHIP_ADDED')
  })
})
