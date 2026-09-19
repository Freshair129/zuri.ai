// @req FR-193 — the write path exists and is reachable.
//
//   `employment-service.js` shipped create / on-leave / reinstate / end, and
//   nothing called any of them: no route imported the service and the People
//   Directory rendered no control that wrote. The roster could therefore only
//   ever hold what the ADR-078 migration backfilled — and on production that
//   was nothing, because no `Membership.employeeRef` value existed to carry
//   over. The page told the owner to add a record and gave them no way to.
//
//   These tests drive the ROUTE handlers, not the service directly: the
//   service already has its own coverage in fr193-employment-lifecycle, and
//   what was missing was the seam between an HTTP request and it.
// @spec ADR-078 D1, BR-034, SDD-093, SEC-008
// @tested tests/integration/fr193-employment-write-path.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { listPeople } from '@/modules/people/application/people-service'

let tenant, business, owner, outsider, staff, memberOnly

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: vi.fn(async () => globalThis.__fr193Viewer),
}))

const { POST } = await import('@/app/api/people/employment/route')
const { PATCH } = await import('@/app/api/people/employment/[employmentId]/route')

const asViewer = (viewer) => {
  globalThis.__fr193Viewer = viewer
}
const req = (body) => ({ json: async () => body })
const read = async (response) => ({ status: response.status, body: await response.json() })

describe('FR-193 — the Employment write path is reachable over HTTP', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR193W', name: 'Write Path Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR193W', name: 'Write Path Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR193W', name: 'Write Path Fixture' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    outsider = makeViewer({ visibleBusinessIds: ['elsewhere'], ownedBusinessIds: ['elsewhere'] })
    staff = await prisma.person.create({ data: { code: 'PER-FR193W-1', displayName: 'Write Path Staff' } })
    // Holds access but no Employment — the exact production shape that made
    // the directory read empty while three Memberships were live.
    memberOnly = await prisma.person.create({ data: { code: 'PER-FR193W-2', displayName: 'Access Only' } })
    await prisma.membership.create({
      data: {
        personId: memberOnly.id, tenantId: tenant.id, businessId: business.id,
        scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE',
        domainKeysJson: JSON.stringify(['people']),
      },
    })
  })

  it('creates an Employment through the route, and the roster then shows it', async () => {
    asViewer(owner)
    const created = await read(await POST(req({
      personId: staff.id, businessId: business.id, tenantId: tenant.id,
      title: 'ผู้จัดการร้าน', employmentType: 'EMPLOYEE',
    })))
    expect(created.body.id).toBeTruthy()
    expect(created.body.status).toBe('ACTIVE')

    const roster = await listPeople(business.id, { viewer: owner })
    expect(roster.people.map((p) => p.person.id)).toContain(staff.id)
    expect(roster.summary.peopleCount).toBe(1)
  })

  it('refuses a caller who does not own the Business, 404-shaped', async () => {
    asViewer(outsider)
    const denied = await read(await POST(req({
      personId: staff.id, businessId: business.id, tenantId: tenant.id, employmentType: 'EMPLOYEE',
    })))
    expect(denied.status).toBe(404)
  })

  it('names the people who hold access but are absent from the roster', async () => {
    // The count the "System access" card could not express: it reads the
    // roster, so on an empty roster it says 0 while people can still sign in.
    const roster = await listPeople(business.id, { viewer: owner })
    expect(roster.summary.accessWithoutEmploymentCount).toBe(1)
    expect(roster.accessWithoutEmployment.map((p) => p.id)).toEqual([memberOnly.id])
    // And it is not merely peopleCount subtracted from something — the person
    // on the roster is not counted here.
    expect(roster.accessWithoutEmployment.map((p) => p.id)).not.toContain(staff.id)
  })

  it('walks on_leave → reinstate → end through PATCH, and refuses an unknown action', async () => {
    asViewer(owner)
    const roster = await listPeople(business.id, { viewer: owner })
    const id = roster.people[0].employmentId

    expect((await read(await PATCH(req({ action: 'on_leave' }), { params: { employmentId: id } }))).body.status).toBe('ON_LEAVE')
    expect((await read(await PATCH(req({ action: 'reinstate' }), { params: { employmentId: id } }))).body.status).toBe('ACTIVE')

    const unknown = await read(await PATCH(req({ action: 'promote' }), { params: { employmentId: id } }))
    expect(unknown.status).toBe(400)

    // `end` without a reason is refused by the service, not silently accepted.
    const noReason = await read(await PATCH(req({ action: 'end' }), { params: { employmentId: id } }))
    expect(noReason.status).toBe(400)

    const ended = await read(await PATCH(req({ action: 'end', reason: 'contract finished' }), { params: { employmentId: id } }))
    expect(ended.body.status).toBe('ENDED')
  })

  it('ending employment leaves Membership untouched (BR-034)', async () => {
    const before = await prisma.membership.count({ where: { personId: memberOnly.id, status: 'ACTIVE' } })
    asViewer(owner)
    const created = await read(await POST(req({
      personId: memberOnly.id, businessId: business.id, tenantId: tenant.id, employmentType: 'CONTRACTOR',
    })))
    await PATCH(req({ action: 'end', reason: 'engagement over' }), { params: { employmentId: created.body.id } })
    const after = await prisma.membership.count({ where: { personId: memberOnly.id, status: 'ACTIVE' } })
    expect(after).toBe(before)
  })
})
