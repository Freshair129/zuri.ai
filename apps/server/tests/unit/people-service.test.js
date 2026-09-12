import { describe, expect, it } from 'vitest'
import { listPeople } from '@/modules/people/application/people-service'
import { makeViewer } from '../factories/viewer'

// @req FR-042 - People Directory is isolated by Business and reuses Person.
// @req FR-193 - the roster is built from Employment, never from Membership.
//   "has system access" is a column DERIVED FROM Membership and shown
//   alongside the roster, never the other way round (ADR-078 D1).
// @spec ADR-013, ADR-078 D1, BR-001, BR-034
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

// Raw Employment/Membership DB rows — a fake prisma return value, not a
// viewer. They live here, next to the tests that use them: the fixture
// ratchet was taught to tell an Employment/Membership row from a viewer
// literal rather than the other way round.
function dbFor({ activeMembershipPersonIds = ['p1'] } = {}) {
  return {
    business: {
      findUnique: async () => ({ id: 'b1', code: 'BUS-001', name: 'Business 01', status: 'ACTIVE', tenantId: 't1' }),
    },
    employment: {
      findMany: async () => [
        { id: 'e1', personId: 'p1', employeeNo: 'E1', title: 'Manager', employmentType: 'EMPLOYEE', status: 'ACTIVE', startAt: null, endAt: null, person: { id: 'p1', code: 'P1', displayName: 'Manager', email: 'manager@local' }, branch: { id: 'br1', code: 'BR-1', name: 'Head Office' } },
        { id: 'e2', personId: 'p2', employeeNo: null, title: null, employmentType: 'CONTRACTOR', status: 'ON_LEAVE', startAt: null, endAt: null, person: { id: 'p2', code: 'P2', displayName: 'Contractor', email: null }, branch: null },
      ],
    },
    membership: {
      findMany: async () => activeMembershipPersonIds.map((personId) => ({ personId })),
    },
  }
}

describe('listPeople', () => {
  it('returns the Employment roster and derives system access from Membership', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b1'] })
    const data = await listPeople('b1', { db: dbFor(), viewer, visibleBusinessIds: viewer.visibleBusinessIds })
    expect(data.business.code).toBe('BUS-001')
    expect(data.people.map((entry) => entry.status)).toEqual(['ACTIVE', 'ON_LEAVE'])
    // Employment defines the roster; Membership only answers "can log in".
    expect(data.people.map((entry) => entry.hasSystemAccess)).toEqual([true, false])
    expect(data.summary).toEqual({ peopleCount: 2, activeCount: 1, onLeaveCount: 1, endedCount: 0, withSystemAccessCount: 1 })
  })

  // @req FR-193 — a suspended (or altogether absent) Membership never removes
  // an Employment row from the roster; it only flips `hasSystemAccess`.
  it('keeps an Employment on the roster when its Membership grants no access', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b1'] })
    const data = await listPeople('b1', { db: dbFor({ activeMembershipPersonIds: [] }), viewer, visibleBusinessIds: viewer.visibleBusinessIds })
    expect(data.people).toHaveLength(2)
    expect(data.people.every((entry) => entry.hasSystemAccess === false)).toBe(true)
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
