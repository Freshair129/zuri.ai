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

// @req FR-198, FR-199 — the invite writer and the history reader agree.
//
//   `ACCESS_INVITE` was in this reader's entity-type list from the start, and
//   the Business/Tenant arms filter on the `tenantId`/`businessId` columns —
//   but `access-invite-service.js` wrote both only inside `payloadJson`, so
//   the query asked for invitations and never matched one. The person arm was
//   worse: it compared `entityId` (an INVITE's id) against `personId`, which
//   no invite has ever equalled, so that arm could only ever return nothing.
//
//   Both assertions below fail against the code as it stood before this file.
describe('FR-199 — invitations appear in the history of the scope they grant into', () => {
  it('finds an invite event by Business scope, and in the invitee\'s own history', async () => {
    const invitee = await prisma.person.create({
      data: { code: `PSN-AEI${suffix}`, displayName: 'Invitee', email: `ae-invitee.${suffix}@example.com` },
    })
    const invite = await prisma.accessInvite.create({
      data: {
        scopeType: 'BUSINESS',
        tenantId: ids.tenant.id,
        businessId: ids.businessA.id,
        invitedByPersonId: ids.owner.id,
        targetPersonId: invitee.id,
        tokenHash: `hash-${suffix}`,
        role: 'MEMBER',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 86400000),
      },
    })

    // Written the way access-invite-service.js writes it after this change:
    // scope as COLUMNS, entityId as the invite's own id.
    await recordAudit(prisma, {
      entityType: 'ACCESS_INVITE',
      entityId: invite.id,
      action: 'ACCESS_INVITE_MINTED',
      actorId: ids.owner.id,
      tenantId: ids.tenant.id,
      businessId: ids.businessA.id,
      payload: { scopeType: 'BUSINESS', role: 'MEMBER' },
    })

    const byBusiness = await listAccessHistory(
      { businessId: ids.businessA.id },
      { resolve: async () => ownerViewer() },
    )
    expect(byBusiness.events.some((e) => e.entityId === invite.id)).toBe(true)

    // The person arm must reach it through `targetPersonId`, not by pretending
    // the invite's entityId is the person's id.
    const inviteeViewer = () => makeViewer({
      principal: { id: invitee.id, code: invitee.code, displayName: invitee.displayName },
      visibleBusinessIds: [],
      ownedBusinessIds: [],
    })
    const mine = await listAccessHistory(
      { personId: invitee.id },
      { resolve: async () => inviteeViewer() },
    )
    expect(mine.events.some((e) => e.entityId === invite.id)).toBe(true)
  })

  it('counts an issued operator grant as access history, not only its revocation', async () => {
    // OPERATOR_GRANT_ISSUED was absent from ACCESS_PERSON_ACTIONS while
    // OPERATOR_GRANT_REVOKED was present, so a person's history could show
    // installation authority taken away and never given.
    const op = await prisma.person.create({
      data: { code: `PSN-AEOP${suffix}`, displayName: 'Operator', email: `ae-op.${suffix}@example.com` },
    })
    await recordAudit(prisma, {
      entityType: 'PERSON',
      entityId: op.id,
      action: 'OPERATOR_GRANT_ISSUED',
      actorId: ids.owner.id,
      payload: { reason: 'incident response' },
    })

    const opViewer = () => makeViewer({
      principal: { id: op.id, code: op.code, displayName: op.displayName },
      visibleBusinessIds: [],
      ownedBusinessIds: [],
    })
    const history = await listAccessHistory({ personId: op.id }, { resolve: async () => opViewer() })
    expect(history.events.some((e) => e.action === 'OPERATOR_GRANT_ISSUED')).toBe(true)
  })
})
