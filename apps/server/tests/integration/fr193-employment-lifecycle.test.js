// @req FR-193 — Employment is an HR assignment record, separate from
// Membership's access grant.
// @spec ADR-078 D1, BR-034
// @tested tests/integration/fr193-employment-lifecycle.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant, createBranch } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createEmployment, endEmployment, reinstateEmployment, setEmploymentOnLeave } from '@/modules/people/application/employment-service'
import { listPeople } from '@/modules/people/application/people-service'

let tenant, business, branch, owner, outsider, person

describe('FR-193 Employment lifecycle', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-FR193', name: 'Employment Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR193', name: 'Employment Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR193', name: 'Employment Fixture' })
    branch = await createBranch({ tenantId: tenant.id, businessId: business.id, code: 'BR-FR193', name: 'Head Office' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    outsider = makeViewer({ visibleBusinessIds: ['other-business'], ownedBusinessIds: ['other-business'] })
    person = await prisma.person.create({ data: { code: 'PER-FR193', displayName: 'FR-193 Fixture Person' } })
  })

  it('creates an Employment that grants no Membership and no access', async () => {
    const before = await prisma.membership.count({ where: { personId: person.id } })
    const employment = await createEmployment(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, branchId: branch.id, title: 'Warehouse Lead', employmentType: 'EMPLOYEE' },
      { viewer: owner },
    )
    expect(employment).toMatchObject({ personId: person.id, businessId: business.id, status: 'ACTIVE', employmentType: 'EMPLOYEE' })
    expect(await prisma.membership.count({ where: { personId: person.id } })).toBe(before)
  })

  it('refuses a second open Employment for the same person at the same Business', async () => {
    await expect(
      createEmployment({ personId: person.id, tenantId: tenant.id, businessId: business.id }, { viewer: owner }),
    ).rejects.toMatchObject({ status: 409, message: 'EMPLOYMENT_ALREADY_OPEN' })
  })

  it('refuses a viewer who does not own the Business', async () => {
    const other = await prisma.person.create({ data: { code: 'PER-FR193-OTHER', displayName: 'Outside Fixture' } })
    await expect(
      createEmployment({ personId: other.id, tenantId: tenant.id, businessId: business.id }, { viewer: outsider }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('the roster survives a suspended (or absent) Membership — Employment is never gated on it', async () => {
    // No Membership has been granted to `person` at all yet.
    const before = await listPeople(business.id, { viewer: owner, visibleBusinessIds: owner.visibleBusinessIds })
    const entry = before.people.find((row) => row.person.id === person.id)
    expect(entry).toBeTruthy()
    expect(entry.hasSystemAccess).toBe(false)

    const membership = await prisma.membership.create({
      data: { personId: person.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' },
    })
    const withAccess = await listPeople(business.id, { viewer: owner, visibleBusinessIds: owner.visibleBusinessIds })
    expect(withAccess.people.find((row) => row.person.id === person.id).hasSystemAccess).toBe(true)

    await prisma.membership.update({ where: { id: membership.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } })
    const suspended = await listPeople(business.id, { viewer: owner, visibleBusinessIds: owner.visibleBusinessIds })
    const suspendedEntry = suspended.people.find((row) => row.person.id === person.id)
    // Still on the roster — a suspended Membership never removes the Employment.
    expect(suspendedEntry).toBeTruthy()
    expect(suspendedEntry.hasSystemAccess).toBe(false)
  })

  it('moves ACTIVE -> ON_LEAVE -> ACTIVE -> ENDED without ever touching Membership', async () => {
    const before = await prisma.membership.count({ where: { personId: person.id } })
    const employment = await prisma.employment.findFirst({ where: { personId: person.id, businessId: business.id, endAt: null } })

    const onLeave = await setEmploymentOnLeave(employment.id, { viewer: owner })
    expect(onLeave.status).toBe('ON_LEAVE')

    const reinstated = await reinstateEmployment(employment.id, { viewer: owner })
    expect(reinstated.status).toBe('ACTIVE')

    const ended = await endEmployment(employment.id, { viewer: owner, reason: 'fixture teardown' })
    expect(ended.status).toBe('ENDED')
    expect(ended.endAt).toBeTruthy()
    expect(await prisma.membership.count({ where: { personId: person.id } })).toBe(before)

    await expect(endEmployment(employment.id, { viewer: owner, reason: 'again' })).rejects.toMatchObject({ status: 409, message: 'EMPLOYMENT_ALREADY_ENDED' })
  })

  it('a Person may be re-hired as a new Employment row once the old one has ended', async () => {
    const created = await createEmployment({ personId: person.id, tenantId: tenant.id, businessId: business.id, employmentType: 'CONTRACTOR' }, { viewer: owner })
    expect(created.employmentType).toBe('CONTRACTOR')
    expect(created.status).toBe('ACTIVE')
  })
})
