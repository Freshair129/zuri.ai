// @req FR-193 — access members remain separate from the Employment lifecycle.
// @spec ADR-078 D1, BR-034, SEC-003
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { listPeople } from '@/modules/people/application/people-service'
import { createEmployment, endEmployment } from '@/modules/people/application/employment-service'

const suffix = randomUUID().slice(0, 8)
let tenant, business, sibling, otherTenant, owner, direct, inherited, both
const person = (name, extra = {}) => prisma.person.create({ data: { code: `HR-${name}-${suffix}`, displayName: name, ...extra } })
const membership = (personId, data = {}) => prisma.membership.create({ data: {
  personId, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE', ...data,
} })

beforeAll(async () => {
  const portfolio = await prisma.portfolio.create({ data: { code: `PF-HR-${suffix}`, name: 'HR list test' } })
  tenant = await prisma.tenant.create({ data: { code: `T-HR-${suffix}`, name: 'HR', portfolioId: portfolio.id } })
  otherTenant = await prisma.tenant.create({ data: { code: `T-HR-OTHER-${suffix}`, name: 'Other', portfolioId: portfolio.id } })
  business = await prisma.business.create({ data: { code: `B-HR-${suffix}`, name: 'HR', tenantId: tenant.id } })
  sibling = await prisma.business.create({ data: { code: `B-HR-SIB-${suffix}`, name: 'Sibling', tenantId: tenant.id } })
  owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  direct = await person('Direct')
  inherited = await person('Inherited')
  both = await person('Both')
  await membership(direct.id)
  await membership(inherited.id, { scopeType: 'TENANT', businessId: null })
  await membership(both.id)
  await membership(both.id, { scopeType: 'TENANT', businessId: null, role: 'OWNER' })
  for (const [name, overrides] of [
    ['Suspended', { status: 'SUSPENDED' }], ['Revoked', { status: 'REVOKED' }],
    ['Expired', { expiresAt: new Date(0) }], ['Sibling', { businessId: sibling.id }],
    ['Other', { tenantId: otherTenant.id, scopeType: 'TENANT', businessId: null }],
  ]) await membership((await person(name)).id, overrides)
  await membership((await person('Disabled', { accessDisabledAt: new Date() })).id)
})

describe('FR-193 independent access-member list', () => {
  it('includes direct and inherited access once, excluding unavailable and foreign grants', async () => {
    const data = await listPeople(business.id, { viewer: owner })
    expect(data.accessMembers.map((m) => m.person.id).sort()).toEqual([direct.id, inherited.id, both.id].sort())
    expect(data.summary.accessMemberCount).toBe(3)
    expect(data.summary.peopleCount).toBe(0)
    expect(data.accessMembers.every((m) => !m.hasOpenEmployment)).toBe(true)
    expect(data.canManageEmployment).toBe(true)
    const member = makeViewer({ role: 'MEMBER', visibleBusinessIds: [business.id], visibleDomains: ['people'] })
    expect((await listPeople(business.id, { viewer: member })).canManageEmployment).toBe(false)
  })

  it('keeps a member after adding Employment, and permits a new record after ending it', async () => {
    const before = await prisma.membership.findMany({ where: { personId: direct.id } })
    const created = await createEmployment({ personId: direct.id, tenantId: tenant.id, businessId: business.id, employmentType: 'EMPLOYEE' }, { viewer: owner })
    const data = await listPeople(business.id, { viewer: owner })
    expect(data.accessMembers.find((m) => m.person.id === direct.id)).toMatchObject({ hasOpenEmployment: true, employmentStatus: 'ACTIVE' })
    expect(data.summary.accessMemberCount).toBe(3)
    expect(data.summary.peopleCount).toBe(1)
    expect(data.accessWithoutEmployment.map((p) => p.id)).not.toContain(direct.id)
    await endEmployment(created.id, { reason: 'Contract completed', viewer: owner })
    const ended = await listPeople(business.id, { viewer: owner })
    expect(ended.accessMembers.find((m) => m.person.id === direct.id).hasOpenEmployment).toBe(false)
    expect(ended.accessWithoutEmployment.map((p) => p.id)).toContain(direct.id)
    const rehired = await createEmployment({ personId: direct.id, tenantId: tenant.id, businessId: business.id, employmentType: 'EMPLOYEE' }, { viewer: owner })
    expect(rehired.id).not.toBe(created.id)
    expect(await prisma.membership.findMany({ where: { personId: direct.id } })).toEqual(before)
  })
})
