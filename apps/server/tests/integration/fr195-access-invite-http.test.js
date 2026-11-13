// @req FR-195
// @spec BR-016, SEC-014, SDD-094, ADR-079
// @tested tests/integration/fr195-access-invite-http.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { generateSessionToken, hashSessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { mintAccessInvite } from '@/modules/identity/access-invite-service'
import { POST as mintRoute } from '@/app/api/access-invites/route'
import { POST as acceptRoute } from '@/app/api/access-invites/accept/route'
import { POST as declineRoute } from '@/app/api/access-invites/decline/route'
import { DELETE as revokeRoute } from '@/app/api/access-invites/[id]/route'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

const SESSION_SECRET = 'access-invite-http-test-secret-long-enough-0123456789'
const APP_ORIGIN = 'http://local'
const sessionIds = []
let portfolio, tenant, business, otherTenant, otherBusiness
let tenantOwner, businessOwner, member, outsider, otherTenantOwner, acceptor, alternateAcceptor, target

async function requestWithCsrf(url, viewer, { method = 'POST', body, omitToken = false } = {}) {
  const personId = viewer?.principal?.id ?? outsider.principal.id
  const sessionId = randomUUID()
  const cookie = generateSessionToken(personId, { secret: SESSION_SECRET, sessionId })
  await prisma.session.create({ data: {
    id: sessionId,
    personId,
    tokenHash: hashSessionToken(cookie),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  } })
  sessionIds.push(sessionId)

  const headers = new Headers({
    cookie: `zuri_session=${cookie}`,
    origin: APP_ORIGIN,
  })
  if (body !== undefined) headers.set('content-type', 'application/json')
  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }
  const tokenRequest = new Request(url, init)
  const session = await createSessionPort().read(tokenRequest)
  const csrf = issueApiWriteCsrfToken({ request: tokenRequest, session })
  if (!omitToken) headers.set('x-csrf-token', csrf.token)

  const request = new Request(url, init)
  if (viewer) request.__viewer = viewer
  return request
}

async function callMint(viewer, input) {
  return mintRoute(await requestWithCsrf(`${APP_ORIGIN}/api/access-invites`, viewer, { body: input }))
}

async function callAccept(viewer, token, extra = {}) {
  return acceptRoute(await requestWithCsrf(`${APP_ORIGIN}/api/access-invites/accept`, viewer, {
    body: { token, ...extra },
  }))
}

async function callDecline(viewer, token) {
  return declineRoute(await requestWithCsrf(`${APP_ORIGIN}/api/access-invites/decline`, viewer, { body: { token } }))
}

async function callRevoke(viewer, inviteId) {
  return revokeRoute(await requestWithCsrf(`${APP_ORIGIN}/api/access-invites/${inviteId}`, viewer, { method: 'DELETE' }), {
    params: { id: inviteId },
  })
}

async function body(response) {
  return response.json()
}

describe('FR-195 AccessInvite HTTP routes with real service and database', () => {
  beforeAll(async () => {
    vi.stubEnv('ZURI_SESSION_SECRET', SESSION_SECRET)
    vi.stubEnv('PUBLIC_BASE_URL', APP_ORIGIN)
    portfolio = await createPortfolio({ name: 'Access Invite HTTP Group', code: 'PF-AIHTTP' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Access Invite HTTP Tenant', code: 'TNT-AIHTTP' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Access Invite HTTP Business', code: 'BUS-AIHTTP' })
    otherTenant = await createTenant({ portfolioId: portfolio.id, name: 'Other Access Invite Tenant', code: 'TNT-AIHTTP-OTHER' })
    otherBusiness = await createBusiness({ tenantId: otherTenant.id, name: 'Other Access Invite Business', code: 'BUS-AIHTTP-OTHER' })

    const [tenantOwnerPerson, businessOwnerPerson, memberPerson, outsiderPerson, otherOwnerPerson,
      acceptorPerson, alternateAcceptorPerson, targetPerson] = await Promise.all([
      prisma.person.create({ data: { code: 'PER-AIHTTP-TENANT-OWNER', displayName: 'Tenant Owner' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-BUSINESS-OWNER', displayName: 'Business Owner' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-MEMBER', displayName: 'Member' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-OUTSIDER', displayName: 'Outsider' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-OTHER-OWNER', displayName: 'Other Tenant Owner' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-ACCEPTOR', displayName: 'Acceptor', email: 'acceptor-aihttp@example.com' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-ALT-ACCEPTOR', displayName: 'Alternate Acceptor', email: 'alternate-aihttp@example.com' } }),
      prisma.person.create({ data: { code: 'PER-AIHTTP-TARGET', displayName: 'Target Person' } }),
    ])

    tenantOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], ownedTenantIds: [tenant.id],
      principal: { id: tenantOwnerPerson.id, code: tenantOwnerPerson.code, displayName: tenantOwnerPerson.displayName },
    })
    businessOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
      principal: { id: businessOwnerPerson.id, code: businessOwnerPerson.code, displayName: businessOwnerPerson.displayName },
    })
    member = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [business.id], ownedBusinessIds: [],
      principal: { id: memberPerson.id, code: memberPerson.code, displayName: memberPerson.displayName },
    })
    outsider = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [],
      principal: { id: outsiderPerson.id, code: outsiderPerson.code, displayName: outsiderPerson.displayName },
    })
    otherTenantOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], ownedTenantIds: [otherTenant.id],
      principal: { id: otherOwnerPerson.id, code: otherOwnerPerson.code, displayName: otherOwnerPerson.displayName },
    })
    acceptor = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [],
      principal: { id: acceptorPerson.id, code: acceptorPerson.code, displayName: acceptorPerson.displayName },
    })
    alternateAcceptor = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [],
      principal: { id: alternateAcceptorPerson.id, code: alternateAcceptorPerson.code, displayName: alternateAcceptorPerson.displayName },
    })
    target = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [],
      principal: { id: targetPerson.id, code: targetPerson.code, displayName: targetPerson.displayName },
    })
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
    vi.unstubAllEnvs()
  })

  it('mints a TENANT invite once and persists only its token hash', async () => {
    const response = await callMint(tenantOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'new-aihttp@example.com' })
    const raw = await response.text()
    const result = JSON.parse(raw)
    const stored = await prisma.accessInvite.findUnique({ where: { id: result.inviteId } })

    expect(response.status).toBe(200)
    expect(raw.match(new RegExp(result.inviteToken, 'g'))).toHaveLength(1)
    expect(stored.tokenHash).not.toBe(result.inviteToken)
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored).not.toHaveProperty('inviteToken')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a whitespace-only LINE addressee at the route without creating an invite', async () => {
    const reason = `ACCESS_INVITE_BLANK_LINE_ROUTE_${randomUUID()}`
    const response = await callMint(tenantOwner, {
      scopeType: 'TENANT', tenantId: tenant.id, invitedLineUserId: '   ', reason,
    })

    expect(response.status).toBe(400)
    expect(await prisma.accessInvite.findFirst({ where: { reason } })).toBeNull()
  })

  it('allows a BUSINESS owner to mint only at their own BUSINESS scope', async () => {
    const allowed = await callMint(businessOwner, { scopeType: 'BUSINESS', businessId: business.id, invitedEmail: 'business-aihttp@example.com' })
    expect(allowed.status).toBe(200)
    expect(await body(allowed)).toMatchObject({ scopeType: 'BUSINESS', tenantId: tenant.id, businessId: business.id })

    const forbidden = await callMint(businessOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'business-aihttp@example.com' })
    expect(forbidden.status).toBe(404)
  })

  it('keeps PORTFOLIO AccessInvite acceptance on the existing WorkspaceMembership path', async () => {
    const minted = await callMint(tenantOwner, {
      scopeType: 'PORTFOLIO', portfolioId: portfolio.id, invitedEmail: 'portfolio-aihttp@example.com',
    })
    const invite = await body(minted)
    expect(minted.status).toBe(200)
    expect(invite).toMatchObject({
      scopeType: 'PORTFOLIO', portfolioId: portfolio.id, tenantId: null, businessId: null, role: 'MEMBER',
    })

    const response = await callAccept(acceptor, invite.inviteToken)
    const accepted = await body(response)
    expect(response.status).toBe(200)
    expect(await prisma.workspaceMembership.findUnique({ where: { id: accepted.membershipId } })).toMatchObject({
      portfolioId: portfolio.id, personId: acceptor.principal.id, role: 'MEMBER', status: 'ACTIVE',
    })
  })

  it('makes MEMBER, outsider and other-Tenant owner refusals indistinguishable from an absent Tenant', async () => {
    const before = await prisma.accessInvite.count()
    let expectedRefusal
    for (const viewer of [member, outsider, otherTenantOwner]) {
      const existing = await callMint(viewer, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'blocked-aihttp@example.com' })
      const absent = await callMint(viewer, { scopeType: 'TENANT', tenantId: randomUUID(), invitedEmail: 'blocked-aihttp@example.com' })
      expect(existing.status).toBe(404)
      expect(absent.status).toBe(404)
      const refusal = await body(existing)
      expect(refusal).toEqual(await body(absent))
      if (expectedRefusal) expect(refusal).toEqual(expectedRefusal)
      else expectedRefusal = refusal
    }
    expect(await prisma.accessInvite.count()).toBe(before)
  })

  it('lets the service refuse OWNER role without creating an invite', async () => {
    const before = await prisma.accessInvite.count()
    const response = await callMint(tenantOwner, {
      scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'owner-role-aihttp@example.com', role: 'OWNER',
    })
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ error: 'INVITE_ROLE_NOT_ALLOWED' })
    expect(await prisma.accessInvite.count()).toBe(before)
  })

  it('accepts a TENANT invite for the session person and writes Membership plus audit', async () => {
    const minted = await callMint(tenantOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'accept-aihttp@example.com' })
    const invite = await body(minted)
    const response = await callAccept(acceptor, invite.inviteToken)
    const accepted = await body(response)

    expect(response.status).toBe(200)
    const membership = await prisma.membership.findUnique({ where: { id: accepted.membershipId } })
    expect(membership).toMatchObject({
      personId: acceptor.principal.id, tenantId: tenant.id, businessId: null,
      scopeType: 'TENANT', role: 'MEMBER', status: 'ACTIVE', grantSource: 'INVITE',
    })
    expect(await prisma.auditEvent.findMany({
      where: { entityType: 'ACCESS_INVITE', entityId: invite.inviteId }, orderBy: { occurredAt: 'asc' },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'ACCESS_INVITE_MINTED' }),
      expect.objectContaining({ action: 'ACCESS_INVITE_ACCEPTED', actorId: acceptor.principal.id }),
    ]))

    const replay = await callAccept(alternateAcceptor, invite.inviteToken)
    expect(replay.status).toBe(400)
    expect(await body(replay)).toMatchObject({ error: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('binds an email-addressed invite to the accepting session, not the email owner', async () => {
    const minted = await callMint(tenantOwner, {
      scopeType: 'BUSINESS', businessId: business.id, invitedEmail: 'target-aihttp@example.com',
    })
    const invite = await body(minted)
    const response = await callAccept(alternateAcceptor, invite.inviteToken)
    const accepted = await body(response)

    expect(response.status).toBe(200)
    expect(await prisma.membership.findUnique({ where: { id: accepted.membershipId } })).toMatchObject({
      personId: alternateAcceptor.principal.id, businessId: business.id, grantSource: 'INVITE',
    })
    expect(await prisma.membership.findFirst({ where: { personId: target.principal.id, businessId: business.id } })).toBeNull()
  })

  it('uses the generic refusal for expired, revoked and wrong-target tokens', async () => {
    const expired = await mintAccessInvite({
      viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id,
      invitedEmail: 'expired-aihttp@example.com', now: Date.now() - 30 * 24 * 60 * 60 * 1000,
    })
    const expiredResponse = await callAccept(acceptor, expired.inviteToken)
    expect(expiredResponse.status).toBe(400)
    expect(await body(expiredResponse)).toMatchObject({ error: 'INVALID_OR_EXPIRED_INVITE' })

    const wrongTarget = await callMint(tenantOwner, {
      scopeType: 'TENANT', tenantId: tenant.id, targetPersonId: target.principal.id,
    })
    const targetedInvite = await body(wrongTarget)
    const wrongPersonResponse = await callAccept(acceptor, targetedInvite.inviteToken)
    expect(wrongPersonResponse.status).toBe(400)
    expect(await body(wrongPersonResponse)).toMatchObject({ error: 'INVALID_OR_EXPIRED_INVITE' })

    const revoked = await callMint(tenantOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'revoked-aihttp@example.com' })
    const revokedInvite = await body(revoked)
    expect((await callRevoke(tenantOwner, revokedInvite.inviteId)).status).toBe(200)
    const revokedAccept = await callAccept(acceptor, revokedInvite.inviteToken)
    expect(revokedAccept.status).toBe(400)
    expect(await body(revokedAccept)).toMatchObject({ error: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('refuses revoke by a non-owner and another-Tenant owner, and reports a non-PENDING invite as 409', async () => {
    const minted = await callMint(tenantOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'revoke-aihttp@example.com' })
    const invite = await body(minted)
    const absent = await callRevoke(tenantOwner, randomUUID())
    const memberRefusal = await callRevoke(member, invite.inviteId)
    const otherTenantOwnerRefusal = await callRevoke(otherTenantOwner, invite.inviteId)
    expect(absent.status).toBe(404)
    expect(memberRefusal.status).toBe(404)
    expect(otherTenantOwnerRefusal.status).toBe(404)
    const absentBody = await body(absent)
    expect(await body(memberRefusal)).toEqual(absentBody)
    expect(await body(otherTenantOwnerRefusal)).toEqual(absentBody)

    const revokeAcceptorPerson = await prisma.person.create({
      data: { code: `PER-AIHTTP-REVOKE-${randomUUID()}`, displayName: 'Revoke Acceptor' },
    })
    const revokeAcceptor = makeViewer({
      role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [],
      principal: { id: revokeAcceptorPerson.id, code: revokeAcceptorPerson.code, displayName: revokeAcceptorPerson.displayName },
    })
    const accepted = await callAccept(revokeAcceptor, invite.inviteToken)
    expect(accepted.status).toBe(200)
    const terminal = await callRevoke(tenantOwner, invite.inviteId)
    expect(terminal.status).toBe(409)
    expect(await body(terminal)).toMatchObject({ error: 'INVITE_NOT_PENDING' })
  })

  it('declines an invite and then refuses acceptance with the generic response', async () => {
    const minted = await callMint(tenantOwner, { scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'decline-aihttp@example.com' })
    const invite = await body(minted)
    expect((await callDecline(acceptor, invite.inviteToken)).status).toBe(200)
    const accepted = await callAccept(acceptor, invite.inviteToken)
    expect(accepted.status).toBe(400)
    expect(await body(accepted)).toMatchObject({ error: 'INVALID_OR_EXPIRED_INVITE' })
  })
})
