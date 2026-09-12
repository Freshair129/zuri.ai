// @req FR-191, FR-193 — Remove uses scoped owner or explicit Operator authority.
// @spec ADR-082, ADR-078, BR-034, SEC-003, SEC-008
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import db from '@/lib/db'
import { makeViewer, makeDevViewer, ownsElsewhere } from '../factories/viewer'
import { listPeople } from '@/modules/people/application/people-service'

const session = vi.hoisted(() => ({ viewer: null }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: async () => session.viewer }))
const { POST: revoke } = await import('@/app/api/platform/users/memberships/[id]/lifecycle/route')
const { POST: create } = await import('@/app/api/people/employment/route')
const { PATCH: change } = await import('@/app/api/people/employment/[employmentId]/route')
const request = (body) => ({ json: async () => body })
let tenant, business, person, grant, employment, owner, operator, member

beforeEach(async () => {
  const suffix = randomUUID()
  const portfolio = await db.portfolio.create({ data: { code: `REMOVE-${suffix}`, name: 'Remove tests' } })
  tenant = await db.tenant.create({ data: { code: `REMOVE-${suffix}`, name: 'Remove tests', portfolioId: portfolio.id } })
  business = await db.business.create({ data: { code: `REMOVE-${suffix}`, name: 'Remove tests', tenantId: tenant.id } })
  person = await db.person.create({ data: { code: `REMOVE-${suffix}`, displayName: 'Remove target' } })
  const actor = await db.person.create({ data: { code: `ACTOR-${suffix}`, displayName: 'Remove actor' } })
  const visible = { visibleBusinessIds: [business.id], principal: { id: actor.id, code: actor.code, displayName: actor.displayName } }
  owner = makeViewer({ ...visible, ownedBusinessIds: [business.id] })
  operator = makeDevViewer({ ...visible, isOperator: true })
  member = makeViewer(visible)
  grant = await db.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER' } })
  employment = await db.employment.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id } })
  session.viewer = owner
})

const removeGrant = (body = {}) => revoke(request({ action: 'REVOKE', reason: 'Owner-approved removal', ...body }), { params: { id: grant.id } })
const end = (body = {}) => change(request({ action: 'end', reason: 'Contract completed', ...body }), { params: { employmentId: employment.id } })

describe('HR Remove authority and independent lifecycles', () => {
  it('exposes grant scope and per-grant authority without letting a Business owner revoke inherited access', async () => {
    const inherited = await db.membership.create({ data: { personId: person.id, tenantId: tenant.id, scopeType: 'TENANT', role: 'MEMBER' } })
    const data = await listPeople(business.id, { viewer: owner })
    expect(data.canRemoveEmployment).toBe(true)
    const grants = data.accessMembers[0].grants
    expect(grants.find(g => g.id === grant.id)).toMatchObject({ scopeType: 'BUSINESS', role: 'MEMBER', canRemove: true })
    expect(grants.find(g => g.id === inherited.id)).toMatchObject({ scopeType: 'TENANT', canRemove: false })
    const denied = await revoke(request({ action: 'REVOKE', reason: 'Wrong scope' }), { params: { id: inherited.id } })
    expect(denied.status).toBe(404)
    session.viewer = makeViewer({ ...owner, ownedTenantIds: [tenant.id] })
    expect((await revoke(request({ action: 'REVOKE', reason: 'Tenant owner' }), { params: { id: inherited.id } })).status).toBe(200)
  })

  it.each(['owner', 'operator'])('%s can revoke one grant while other access and Employment remain', async kind => {
    session.viewer = kind === 'owner' ? owner : operator
    const inherited = await db.membership.create({ data: { personId: person.id, tenantId: tenant.id, scopeType: 'TENANT', role: 'MEMBER' } })
    expect((await removeGrant()).status).toBe(200)
    expect(await db.employment.findUnique({ where: { id: employment.id } })).toEqual(employment)
    expect(await db.membership.findUnique({ where: { id: inherited.id } })).toEqual(inherited)
    const data = await listPeople(business.id, { viewer: session.viewer })
    expect(data.accessMembers).toHaveLength(1)
    expect(data.accessMembers[0].grants).toHaveLength(1)
    expect(await db.auditEvent.count({ where: { entityId: grant.id, action: 'MEMBERSHIP_REVOKED' } })).toBe(1)
  })

  it('Operator can revoke a Tenant-wide grant without gaining ownership', async () => {
    await db.membership.update({ where: { id: grant.id }, data: { scopeType: 'TENANT', businessId: null } })
    session.viewer = operator
    expect((await listPeople(business.id, { viewer: operator })).accessMembers[0].grants[0].canRemove).toBe(true)
    expect((await removeGrant()).status).toBe(200)
    expect(operator.ownedBusinessIds).toEqual([])
    expect(operator.ownedTenantIds).toEqual([])
  })

  it.each(['owner', 'operator'])('%s can end Employment and retain the record, Membership and audit', async kind => {
    session.viewer = kind === 'owner' ? owner : operator
    expect((await end()).status).toBe(200)
    const data = await listPeople(business.id, { viewer: session.viewer })
    expect(data.people[0]).toMatchObject({ employmentId: employment.id, status: 'ENDED' })
    expect(data.accessMembers[0].hasOpenEmployment).toBe(false)
    expect(await db.membership.findUnique({ where: { id: grant.id } })).toEqual(grant)
    expect(await db.auditEvent.count({ where: { entityId: employment.id, action: 'EMPLOYMENT_ENDED' } })).toBe(1)
  })

  it('hides Remove and denies forged API requests from a member, including OWNER_OPERATOR employment', async () => {
    await db.employment.create({ data: { personId: member.principal.id, businessId: business.id, tenantId: tenant.id, employmentType: 'OWNER_OPERATOR' } })
    session.viewer = member
    const data = await listPeople(business.id, { viewer: member })
    expect(data.canRemoveEmployment).toBe(false)
    expect(data.accessMembers.every(m => m.grants.every(g => !g.canRemove))).toBe(true)
    expect((await end({ isOperator: true, role: 'OWNER' })).status).toBe(404)
    expect((await removeGrant({ isOperator: true, role: 'OWNER' })).status).toBe(404)
    expect(await db.membership.findUnique({ where: { id: grant.id } })).toEqual(grant)
    expect(await db.employment.findUnique({ where: { id: employment.id } })).toEqual(employment)
  })

  it('denies an owner of another Business and a platform viewer without Operator authority', async () => {
    for (const viewer of [ownsElsewhere({ sees: business.id }), makeDevViewer({ visibleBusinessIds: [business.id], isOperator: false })]) {
      session.viewer = viewer
      expect((await end()).status).toBe(404)
      expect((await removeGrant()).status).toBe(404)
    }
  })

  it('Operator removal does not authorize create, leave, reinstate or suspension', async () => {
    session.viewer = operator
    expect((await listPeople(business.id, { viewer: operator })).canManageEmployment).toBe(false)
    expect((await create(request({ personId: person.id, tenantId: tenant.id, businessId: business.id }))).status).toBe(404)
    for (const action of ['on_leave', 'reinstate']) expect((await end({ action })).status).toBe(404)
    expect((await removeGrant({ action: 'SUSPEND' })).status).toBe(404)
  })

  it('keeps the last-owner guard for Operators, including a forged override', async () => {
    await db.membership.update({ where: { id: grant.id }, data: { role: 'OWNER' } })
    session.viewer = operator
    const response = await removeGrant({ allowLast: true })
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).toContain('LAST_OWNER')
  })

  it('requires a reason for both operations and preserves data on refusal', async () => {
    expect((await end({ reason: ' ' })).status).toBe(400)
    expect((await removeGrant({ reason: ' ' })).status).toBe(400)
    expect(await db.membership.findUnique({ where: { id: grant.id } })).toEqual(grant)
    expect(await db.employment.findUnique({ where: { id: employment.id } })).toEqual(employment)
  })
})
