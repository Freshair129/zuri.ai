// @req FR-200 — actual grants, persisted browser sessions and scope guards.
// @spec ADR-082, SEC-001, SEC-008, SEC-027
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { grantSuperadmin, revokeSuperadmin, hasSuperadminGrant } from '@/modules/identity/superadmin-grant'
import { grantBusinessMembership } from '@/modules/identity/membership-grant-service'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveViewer, VIEWER_DOMAINS } from '@/modules/identity/resolve-viewer'
import { ownsBusiness, ownsTenant, isInstallationOperator } from '@/modules/identity/viewer-authority'
import { ROLE_PERMISSIONS, hasPermission } from '@/modules/identity/rbac'
import { assertWorkspaceAdminAuthority } from '@/modules/identity/workspace-membership-service'
import { listUserPermissions } from '@/modules/identity/profile-permission-service'
import { buildViewerEntry } from '@/modules/identity/entry-read-model'

const suffix = randomUUID().slice(0, 8)
const env = { NODE_ENV: 'production', ZURI_SESSION_SECRET: 'superadmin-test-secret-with-more-than-32-characters' }
let actor, person, member, portfolio, emptyPortfolio, tenantA, tenantB, businessA, businessB, request
const personRow = (name) => prisma.person.create({ data: { code: `SA-${name}-${suffix}`, displayName: name, email: `${name}.${suffix}@example.com` } })
const expiry = () => new Date(Date.now() + 86400000)
const resolveBrowser = () => resolveRequestViewer(request, { sessionPort: createSessionPort({ env, db: prisma }) })
const grant = (over = {}) => grantSuperadmin({ personId: person.id, actorId: actor.id, reason: 'Approved integration test', expiresAt: expiry(), ...over })

beforeAll(async () => {
  actor = await personRow('operator')
  person = await personRow('target')
  member = await personRow('member')
  await prisma.platformGrant.create({ data: { personId: actor.id, capability: 'OPERATOR', status: 'ACTIVE', standing: true } })
  portfolio = await prisma.portfolio.create({ data: { code: `PF-SA-${suffix}`, name: 'Superadmin test' } })
  emptyPortfolio = await prisma.portfolio.create({ data: { code: `PF-SA-EMPTY-${suffix}`, name: 'Empty portfolio' } })
  tenantA = await prisma.tenant.create({ data: { code: `T-SA-A-${suffix}`, name: 'A', portfolioId: portfolio.id } })
  tenantB = await prisma.tenant.create({ data: { code: `T-SA-B-${suffix}`, name: 'B', portfolioId: portfolio.id } })
  businessA = await prisma.business.create({ data: { code: `B-SA-A-${suffix}`, name: 'A', tenantId: tenantA.id } })
  businessB = await prisma.business.create({ data: { code: `B-SA-B-${suffix}`, name: 'B', tenantId: tenantB.id } })
  await grantBusinessMembership({ personId: member.id, tenantId: tenantA.id, businessId: businessA.id, role: 'MEMBER', domainKeys: ['people'], actorId: actor.id })
  const sessionId = randomUUID()
  const token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
  await persistSession({ personId: person.id, sessionId, token, env })
  request = new Request('http://localhost/api/entry', { headers: { cookie: `zuri_session=${token}`, 'x-superadmin': 'true' } })
})

afterAll(async () => {
  // Other serial suites exercise first-operator bootstrap in the same test DB.
  // Withdraw only this fixture's grants, leaving their global precondition intact.
  await prisma.platformGrant.updateMany({
    where: { personId: { in: [actor?.id, person?.id].filter(Boolean) }, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'Superadmin fixture teardown' },
  })
})

describe('FR-200 Superadmin boundary', () => {
  it('does not promote an OPERATOR, MEMBER, request header, or scoped resolver caller', async () => {
    expect((await resolveBrowser()).ownedBusinessIds).toEqual([])
    const operator = await resolveViewer({ principalId: actor.id, platformGrant: true })
    expect(operator.role).toBe('DEV')
    expect(operator.ownedBusinessIds).toEqual([])
    await expect(listUserPermissions({ resolve: async () => operator })).rejects.toMatchObject({ status: 403 })
    const ordinary = await resolveViewer({ principalId: member.id })
    expect(ordinary.visibleBusinessIds).toEqual([businessA.id])
    expect(ownsBusiness(ordinary, businessB.id)).toBe(false)
    await expect(assertWorkspaceAdminAuthority(ordinary, emptyPortfolio.id, prisma)).rejects.toMatchObject({ status: 404 })
  })

  it('refuses unauthorized actors and invalid expiry without writing grant or audit', async () => {
    const before = await prisma.auditEvent.count({ where: { entityId: person.id } })
    await expect(grant({ actorId: member.id })).rejects.toMatchObject({ status: 403 })
    await expect(grant({ reason: '' })).rejects.toMatchObject({ status: 400 })
    await expect(grant({ expiresAt: new Date(Date.now() + 91 * 86400000) })).rejects.toMatchObject({ status: 400 })
    await expect(grant({ expiresAt: new Date(0) })).rejects.toMatchObject({ status: 400 })
    await expect(grant({ expiresAt: null })).rejects.toMatchObject({ status: 400 })
    expect(await prisma.platformGrant.count({ where: { personId: person.id } })).toBe(0)
    expect(await prisma.auditEvent.count({ where: { entityId: person.id } })).toBe(before)
  })

  it('grants through the persisted session, covers both tenants and all existing authority guards', async () => {
    const issued = await grant()
    const viewer = await resolveBrowser()
    expect(viewer.role).toBe('OWNER')
    expect(viewer.isPlatform).toBe(true)
    expect(viewer.isOperator).toBe(true)
    expect(viewer.isSuperadmin).toBe(true)
    for (const [tenant, business] of [[tenantA, businessA], [tenantB, businessB]]) {
      expect(ownsTenant(viewer, tenant.id)).toBe(true)
      expect(ownsBusiness(viewer, business.id)).toBe(true)
      expect(viewer.domainsByBusinessId[business.id]).toEqual(VIEWER_DOMAINS)
      for (const permission of Object.values(ROLE_PERMISSIONS).flat()) expect(hasPermission(viewer, business.id, permission)).toBe(true)
    }
    expect(isInstallationOperator(viewer)).toBe(true)
    expect(ownsBusiness(viewer, 'nonexistent')).toBe(false)
    await assertWorkspaceAdminAuthority(viewer, emptyPortfolio.id, prisma)
    await expect(assertWorkspaceAdminAuthority(viewer, 'nonexistent', prisma)).rejects.toMatchObject({ status: 404 })
    await listUserPermissions({ resolve: async () => viewer })
    await buildViewerEntry({ viewer })
    expect((await resolveViewer({ principalId: person.id })).visibleBusinessIds).toEqual([])
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: person.id, action: 'SUPERADMIN_GRANTED' } })
    expect(JSON.parse(audit.payloadJson).grantId).toBe(issued.id)
    expect(audit.actorId).toBe(actor.id)
    expect(await prisma.membership.count({ where: { personId: person.id } })).toBe(0)
    await expect(grant()).rejects.toMatchObject({ status: 409 })
  })

  it('removes Superadmin authority from an already signed-in disabled account', async () => {
    await prisma.person.update({ where: { id: person.id }, data: { accessDisabledAt: new Date() } })
    expect(await hasSuperadminGrant(person.id)).toBe(false)
    expect((await resolveBrowser()).ownedBusinessIds).toEqual([])
    await prisma.person.update({ where: { id: person.id }, data: { accessDisabledAt: null } })
    expect((await resolveBrowser()).isSuperadmin).toBe(true)
  })

  it('rolls back the grant when the audit insert fails', async () => {
    const target = await personRow('atomic')
    const db = { $transaction: (run) => prisma.$transaction((tx) => run({
      ...tx, auditEvent: { create: async () => { throw new Error('AUDIT_UNAVAILABLE') } },
    })) }
    await expect(grant({ personId: target.id, db })).rejects.toThrow('AUDIT_UNAVAILABLE')
    expect(await prisma.platformGrant.count({ where: { personId: target.id } })).toBe(0)
  })

  it('includes a newly created tenant/business without rewriting the grant', async () => {
    const tenant = await prisma.tenant.create({ data: { code: `T-SA-NEW-${suffix}`, name: 'New', portfolioId: portfolio.id } })
    const business = await prisma.business.create({ data: { code: `B-SA-NEW-${suffix}`, name: 'New', tenantId: tenant.id } })
    const viewer = await resolveBrowser()
    expect(ownsTenant(viewer, tenant.id)).toBe(true)
    expect(ownsBusiness(viewer, business.id)).toBe(true)
    expect((await resolveViewer({ principalId: member.id })).visibleBusinessIds).toEqual([businessA.id])
  })

  it('revokes atomically and removes authority from the same session on its next request', async () => {
    await expect(revokeSuperadmin({ personId: person.id, actorId: member.id, reason: 'not authorized' })).rejects.toMatchObject({ status: 403 })
    await revokeSuperadmin({ personId: person.id, actorId: actor.id, reason: 'test withdrawal' })
    expect(await hasSuperadminGrant(person.id)).toBe(false)
    expect((await resolveBrowser()).ownedBusinessIds).toEqual([])
    expect(await prisma.auditEvent.count({ where: { entityId: person.id, action: 'SUPERADMIN_REVOKED' } })).toBe(1)
  })

  it('fails closed at expiry while preserving a separate standing OPERATOR grant', async () => {
    await grant()
    await prisma.platformGrant.updateMany({ where: { personId: person.id, capability: 'SUPERADMIN', status: 'ACTIVE' }, data: { expiresAt: new Date(0) } })
    await prisma.platformGrant.create({ data: { personId: person.id, capability: 'OPERATOR', status: 'ACTIVE', standing: true } })
    const viewer = await resolveBrowser()
    expect(viewer.role).toBe('DEV')
    expect(viewer.ownedBusinessIds).toEqual([])
    expect(isInstallationOperator(viewer)).toBe(true)
  })
})
