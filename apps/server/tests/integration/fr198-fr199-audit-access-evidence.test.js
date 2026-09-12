import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import { suspendMembership, revokeMembership } from '@/modules/identity/membership-lifecycle-service'
import { listAccessHistory, listBusinessAccess } from '@/modules/identity/access-history-service'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-198, FR-199 — audit events carry their own scope, and a Business
//   owner can read the access history of their own scope. Against real rows,
//   because the defect this closes was invisible to a mocked db by
//   construction: `listAccessHistory` has to actually filter `AuditEvent` by
//   a column that did not exist before this change
//   (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-080 D1-D4, BR-036, SEC-001, SEC-003, SDD-095

const suffix = randomUUID().slice(0, 6)
const ids = {}

async function scope() {
  const portfolio = await prisma.portfolio.create({ data: { code: `PF-AE${suffix}`, name: 'AuditEvidence' } })
  const tenant = await prisma.tenant.create({ data: { code: `TNT-AE${suffix}`, name: 'AuditEvidence', portfolioId: portfolio.id } })
  const businessA = await prisma.business.create({ data: { code: `BUS-AEA${suffix}`, name: 'A', tenantId: tenant.id } })
  const businessB = await prisma.business.create({ data: { code: `BUS-AEB${suffix}`, name: 'B', tenantId: tenant.id } })
  const owner = await prisma.person.create({ data: { code: `PSN-AEO${suffix}`, displayName: 'Owner', email: `ae-owner.${suffix}@example.com` } })
  return { tenant, businessA, businessB, owner }
}

const ownerViewer = () => makeViewer({
  principal: { id: ids.owner.id, code: ids.owner.code, displayName: ids.owner.displayName },
  visibleBusinessIds: [ids.businessA.id, ids.businessB.id],
  ownedBusinessIds: [ids.businessA.id, ids.businessB.id],
  ownedTenantIds: [ids.tenant.id],
})

const strangerViewer = () => makeViewer({
  principal: { id: 'stranger-1', code: 'PSN-STRANGER', displayName: 'Stranger' },
  visibleBusinessIds: [],
  ownedBusinessIds: [],
})

beforeAll(async () => {
  Object.assign(ids, await scope())
})

describe('FR-198 — a lifecycle event carries scope as columns', () => {
  it('grantBusinessMembership writes tenantId/businessId/reason as columns, not only inside payload', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-C${suffix}`, displayName: 'Grantee' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: ['projects'], reason: 'onboarding', actorId: ids.owner.id,
    })
    const event = await prisma.auditEvent.findFirst({ where: { entityType: 'MEMBERSHIP', entityId: grant.id } })
    expect(event).toMatchObject({ tenantId: ids.tenant.id, businessId: ids.businessA.id, reason: 'onboarding' })
    expect(JSON.parse(event.afterJson)).toMatchObject({ status: 'ACTIVE' })
  })

  it('a suspend/revoke transition carries businessId and reason as columns, and a before/after snapshot', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-T${suffix}`, displayName: 'Transitioned' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: [], actorId: ids.owner.id,
    })
    await suspendMembership({ membershipId: grant.id, reason: 'on leave' }, { resolve: async () => ownerViewer() })
    const suspended = await prisma.auditEvent.findFirst({ where: { entityType: 'MEMBERSHIP', entityId: grant.id, action: 'MEMBERSHIP_SUSPENDED' } })
    expect(suspended).toMatchObject({ tenantId: ids.tenant.id, businessId: ids.businessA.id, reason: 'on leave' })
    expect(JSON.parse(suspended.beforeJson)).toMatchObject({ status: 'ACTIVE' })
    expect(JSON.parse(suspended.afterJson)).toMatchObject({ status: 'SUSPENDED' })

    await revokeMembership({ membershipId: grant.id, reason: 'left the company' }, { resolve: async () => ownerViewer() })
    const revoked = await prisma.auditEvent.findFirst({ where: { entityType: 'MEMBERSHIP', entityId: grant.id, action: 'MEMBERSHIP_REVOKED' } })
    expect(revoked).toMatchObject({ tenantId: ids.tenant.id, businessId: ids.businessA.id, reason: 'left the company' })
  })

  it('an existing recordAudit caller that passes no new fields still writes a working row', async () => {
    // The exact shape profile-permission-service.js, project-team-service.js
    // and every pre-existing caller still uses — no tenantId, no businessId,
    // no reason. Proves the migration is additive rather than a retrofit.
    const event = await recordAudit(prisma, {
      entityType: 'MEMBERSHIP', entityId: 'legacy-row', action: 'PERMISSIONS_UPDATED',
      payload: { role: 'MEMBER' }, actorId: ids.owner.id,
    })
    expect(event.tenantId).toBeNull()
    expect(event.businessId).toBeNull()
    expect(event.reason).toBeNull()
    expect(event.action).toBe('PERMISSIONS_UPDATED')
  })
})

describe('FR-199 — access history a Business owner can read', () => {
  it('a Business owner reads their own Business history; a stranger and a nonexistent Business get the identical 404', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-H${suffix}`, displayName: 'History' } })
    await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: [], reason: 'joined', actorId: ids.owner.id,
    })

    const result = await listAccessHistory({ businessId: ids.businessA.id }, { resolve: async () => ownerViewer() })
    expect(result.events.length).toBeGreaterThan(0)
    const granted = result.events.find((e) => e.entityType === 'MEMBERSHIP' && e.reason === 'joined')
    expect(granted).toBeTruthy()
    expect(granted.actor).toMatchObject({ id: ids.owner.id, code: ids.owner.code })

    const strangerAttempt = await listAccessHistory({ businessId: ids.businessA.id }, { resolve: async () => strangerViewer() }).catch((e) => e)
    const missingAttempt = await listAccessHistory({ businessId: 'does-not-exist' }, { resolve: async () => strangerViewer() }).catch((e) => e)
    expect(strangerAttempt.status).toBe(404)
    expect(missingAttempt.status).toBe(404)
    expect(strangerAttempt.message).toBe(missingAttempt.message)
  })

  it('a person reads their own history by relational join, not a personId column', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-SELF${suffix}`, displayName: 'Self' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessB.id,
      role: 'MEMBER', domainKeys: [], actorId: ids.owner.id,
    })
    const selfViewer = () => makeViewer({
      principal: { id: person.id, code: person.code, displayName: person.displayName },
      visibleBusinessIds: [ids.businessB.id],
      ownedBusinessIds: [],
    })
    const result = await listAccessHistory({ personId: person.id }, { resolve: async () => selfViewer() })
    expect(result.events.some((e) => e.entityId === grant.id)).toBe(true)

    // Another person's own history is refused for a caller who is neither
    // that person nor an operator.
    await expect(
      listAccessHistory({ personId: person.id }, { resolve: async () => strangerViewer() }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a query naming zero or more than one scope', async () => {
    await expect(listAccessHistory({}, { resolve: async () => ownerViewer() })).rejects.toMatchObject({ status: 400 })
    await expect(
      listAccessHistory({ businessId: ids.businessA.id, tenantId: ids.tenant.id }, { resolve: async () => ownerViewer() }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('FR-199 — listBusinessAccess shows a revoked grant with its reason and who revoked it', () => {
  it('the current-state roster carries provenance for both a live and a revoked grant', async () => {
    const person = await prisma.person.create({ data: { code: `PSN-BA${suffix}`, displayName: 'Roster' } })
    const grant = await grantBusinessMembership({
      personId: person.id, tenantId: ids.tenant.id, businessId: ids.businessA.id,
      role: 'MEMBER', domainKeys: ['projects'], actorId: ids.owner.id,
    })
    await revokeMembership({ membershipId: grant.id, reason: 'contract ended' }, { resolve: async () => ownerViewer() })

    const roster = await listBusinessAccess({ businessId: ids.businessA.id }, { resolve: async () => ownerViewer() })
    const row = roster.grants.find((g) => g.id === grant.id)
    expect(row).toMatchObject({ status: 'REVOKED', revokeReason: 'contract ended' })
    expect(row.revokedBy).toMatchObject({ id: ids.owner.id })
    expect(row.domainKeys).toEqual(['projects'])
  })

  it('refuses a Business the caller does not own, 404-shaped', async () => {
    await expect(
      listBusinessAccess({ businessId: ids.businessA.id }, { resolve: async () => strangerViewer() }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
