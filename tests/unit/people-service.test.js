import { describe, expect, it } from 'vitest'
import { listPeople } from '@/modules/people/application/people-service'
import { makeViewer } from '../factories/viewer'

// @req FR-042 - People Directory is isolated by Business and reuses Membership.
// @spec ADR-013, BR-001
// @tested tests/unit/people-service.test.js
//
// Repaid from docs/.viewer-fixture-baseline.json on 2026-08-17: the array passed here
// used to be hand-typed instead of pulled off a real viewer shape. It now comes from
// makeViewer(), same as the route handler does (src/app/api/people/route.js).
//
// @req FR-061 (2026-09-02) — listPeople takes the whole `viewer` now, not just its
// `visibleBusinessIds`. The per-Business domain grant that decides HR / People access
// lives on the viewer, and passing the array alone left the service with no data to
// answer that question from.

// Raw Membership DB rows — a fake prisma return value, not a viewer. They live
// here, next to the tests that use them: the fixture ratchet was taught to tell
// a Membership row from a viewer literal rather than the other way round.
function dbFor() {
  return {
    business: {
      findUnique: async () => ({ id: 'b1', code: 'BUS-001', name: 'Business 01', status: 'ACTIVE', tenantId: 't1' }),
    },
    membership: {
      findMany: async () => [
        { id: 'm1', businessId: 'b1', branchId: 'br1', employeeRef: 'E1', role: 'OWNER', person: { id: 'p1', code: 'P1', displayName: 'Owner', email: 'owner@local' }, branch: { id: 'br1', code: 'BR-1', name: 'Head Office' } },
        { id: 'm2', businessId: null, branchId: null, employeeRef: null, role: 'MEMBER', person: { id: 'p2', code: 'P2', displayName: 'Shared', email: null }, branch: null },
      ],
    },
  }
}

describe('listPeople', () => {
  it('returns business and tenant-wide memberships without exposing another business', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b1'] })
    const data = await listPeople('b1', { db: dbFor(), viewer, visibleBusinessIds: viewer.visibleBusinessIds })
    expect(data.business.code).toBe('BUS-001')
    expect(data.people.map((entry) => entry.businessScope)).toEqual(['BUSINESS', 'TENANT'])
    expect(data.summary).toEqual({ peopleCount: 2, businessScopedCount: 1, tenantScopedCount: 1 })
  })

  it('fails closed for an invisible Business', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b2'] })
    await expect(listPeople('b1', { db: dbFor(), viewer, visibleBusinessIds: viewer.visibleBusinessIds })).rejects.toThrow('Business access denied')
  })

  // @req FR-061 — visibility and the domain grant are two different questions, and the
  // directory now asks both. A MEMBER whose Membership lists only `projects` sees the
  // Business in the switcher and must still be refused HR / People, in the shape an
  // unknown Business is refused with (FR-072(a)).
  it('refuses a viewer who sees the Business but was not granted the people domain', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b1'], visibleDomains: ['projects'] })
    await expect(listPeople('b1', { db: dbFor(), viewer, visibleBusinessIds: viewer.visibleBusinessIds }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })
})
