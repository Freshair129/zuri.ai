import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { resolveLineIdentity, revokeLineIdentity } from '@/modules/identity/resolve-line-identity'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { authorizeAgentToolExecution } from '@/modules/identity/agent-tool-authorizer'
import { POST as postLinkToken } from '@/app/api/identity/link-tokens/route'
import { POST as postRedeemToken } from '@/app/api/identity/link-tokens/redeem/route'
import { GET as getChannelIdentity } from '@/app/api/identity/channel-identities/route'

// @req FR-022, FR-097 — verified channel onboarding and identity binding for LINE OA
// @spec SEC-018, ADR-045 D1/D5, SDD-052, BR-020
// @tested tests/integration/fr097-line-channel-onboarding.test.js

let tenant
let business
let staffPerson
let staffViewer

function mockRequest(url, { method = 'GET', body = null, headers = {} } = {}) {
  return {
    url,
    method,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null,
    },
    json: async () => body ?? {},
  }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'FR097 Group', code: 'PF-FR097' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'FR097 Tenant', code: 'TNT-FR097' })
  business = await createBusiness({ tenantId: tenant.id, name: 'FR097 Business', code: 'BUS-FR097' })

  staffPerson = await prisma.person.create({ data: { code: 'PSN-FR097-STAFF', displayName: 'Staff Admin' } })
  await prisma.membership.create({
    data: { personId: staffPerson.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' },
  })

  staffViewer = makeViewer({
    principal: { id: staffPerson.id, code: staffPerson.code, displayName: staffPerson.displayName },
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    visibleDomains: ['identity', 'platform', 'line-oa'],
  })
})

describe('FR-097 Verified Channel Onboarding & Identity Binding', () => {
  it('enforces complete verified onboarding lifecycle from PENDING to ACTIVE', async () => {
    const channelAccountId = 'LINE-OA-FR097-E2E'
    const lineUserId = 'U-fr097-e2e-user'

    // 1. Discovery: First contact sets ChannelIdentity to PENDING
    const initial = await resolveLineIdentity({
      tenantId: tenant.id,
      channelAccountId,
      lineUserId,
      displayName: 'Unverified Customer',
    })
    expect(initial.identityVerified).toBe(false)
    expect(initial.channelIdentity.status).toBe('PENDING')

    // 2. A Business-scoped OWNER cannot read the pending binding of a Person
    //    with no Membership in their Business: it is shaped as not-found.
    const statusReq = mockRequest(`http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&channelAccountId=${channelAccountId}&providerSubject=${lineUserId}`)
    const statusRes = await getChannelIdentity(statusReq, { viewer: staffViewer })
    const statusData = await statusRes.json()
    expect(statusRes.status).toBe(200)
    expect(statusData).toEqual({
      found: false,
      status: null,
      verified: false,
      verifiedAt: null,
      linkedAt: null,
    })

    // 3. Security check: Tool execution rejected with IDENTITY_PENDING
    const unverifiedViewer = {
      ...makeViewer({
        role: 'MEMBER',
        visibleBusinessIds: [business.id],
        ownedBusinessIds: [],
        principal: { id: initial.personId },
      }),
      personId: initial.personId,
      tenantId: tenant.id,
      businessId: business.id,
      identityVerified: false,
      channelIdentity: initial.channelIdentity,
    }
    const toolCheck = await authorizeAgentToolExecution({
      toolName: 'read_project_data',
      toolArgs: {},
      viewer: unverifiedViewer,
      db: prisma,
    })
    expect(toolCheck.allowed).toBe(false)
    expect(toolCheck.reason).toBe('IDENTITY_PENDING')

    // 4. Issue a self-only Link Token via the authenticated API route.
    const issueReq = mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST',
      body: { tenantId: tenant.id, ttlSeconds: 600 },
    })
    const issueRes = await postLinkToken(issueReq, { viewer: staffViewer })
    expect(issueRes.status).toBe(200)
    const issueData = await issueRes.json()
    expect(issueData.token).toBeTruthy()
    expect(issueData.tokenId).toBeTruthy()

    // 5. Internal redemption is reserved for a future verified LINE caller.
    const redeemData = await redeemLinkToken({
      tenantId: tenant.id,
      token: issueData.token,
      channelAccountId,
      lineUserId,
      displayName: 'Verified Staff Member',
      merge: true,
    })
    expect(redeemData.personId).toBe(staffPerson.id)
    expect(redeemData.channelIdentity.status).toBe('ACTIVE')
    const identityAudits = await prisma.auditEvent.findMany({
      where: {
        entityType: 'EXTERNAL_IDENTITY',
        entityId: redeemData.externalIdentityId,
      },
    })
    const redemptionAudit = identityAudits.find(({ payloadJson }) =>
      JSON.parse(payloadJson).tokenId === issueData.tokenId,
    )
    expect(redemptionAudit).toBeTruthy()
    const redemptionPayload = JSON.parse(redemptionAudit.payloadJson)
    expect(redemptionPayload.tokenId).toBe(issueData.tokenId)
    expect(redemptionPayload.tokenId).not.toBe(issueData.token)
    expect(redemptionPayload).not.toHaveProperty('token')

    // 6. Query status endpoint now confirms ACTIVE and verified: true
    const updatedStatusRes = await getChannelIdentity(statusReq, { viewer: staffViewer })
    const updatedStatusData = await updatedStatusRes.json()
    expect(updatedStatusData).toMatchObject({
      found: true,
      status: 'ACTIVE',
      verified: true,
    })
    expect(updatedStatusData.verifiedAt).toBeTruthy()
    expect(updatedStatusData.linkedAt).toBeTruthy()

    // 7. Re-resolution now yields verified identity
    const verifiedResolution = await resolveLineIdentity({
      tenantId: tenant.id,
      channelAccountId,
      lineUserId,
    })
    expect(verifiedResolution.identityVerified).toBe(true)
    expect(verifiedResolution.personId).toBe(staffPerson.id)

    // 8. Tool execution is now authorized for the verified identity
    const verifiedViewer = {
      ...makeViewer({
        role: 'OWNER',
        visibleBusinessIds: [business.id],
        ownedBusinessIds: [business.id],
        principal: { id: staffPerson.id },
      }),
      personId: staffPerson.id,
      tenantId: tenant.id,
      businessId: business.id,
      identityVerified: true,
      channelIdentity: updatedStatusData,
    }
    const verifiedToolCheck = await authorizeAgentToolExecution({
      toolName: 'read_project_data',
      toolArgs: {},
      viewer: verifiedViewer,
      db: prisma,
    })
    expect(verifiedToolCheck.allowed).toBe(true)
    expect(verifiedToolCheck.reason).toBe('AUTHORIZED')
  })

  it('keeps internal redemption single-use', async () => {
    const channelAccountId = 'LINE-OA-FR097-CONSUME'
    const lineUserId = 'U-fr097-consume'

    const issueReq = mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST',
      body: { tenantId: tenant.id, ttlSeconds: 600 },
    })
    const issueRes = await postLinkToken(issueReq, { viewer: staffViewer })
    const { token } = await issueRes.json()

    await redeemLinkToken({ tenantId: tenant.id, token, channelAccountId, lineUserId })
    await expect(redeemLinkToken({ tenantId: tenant.id, token, channelAccountId, lineUserId }))
      .rejects.toThrow(/already been used/i)
  })

  it('requires a session before querying channel identity', async () => {
    const req = mockRequest(`http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=U-fr097-no-session`)
    const res = await getChannelIdentity(req, { resolveViewer: async () => null })
    expect(res.status).toBe(401)
  })

  it('returns the same not-found shape for another Person binding to a non-owner', async () => {
    const providerSubject = 'U-fr097-owner-only'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })

    const outsider = await prisma.person.create({ data: { code: 'PSN-FR097-OUTSIDER', displayName: 'Outsider' } })
    const outsiderViewer = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: outsider.id, code: outsider.code, displayName: outsider.displayName },
    })
    const hidden = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: outsiderViewer })
    const hiddenData = await hidden.json()
    const notFound = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=U-fr097-does-not-exist`,
    ), { viewer: outsiderViewer })

    expect(hidden.status).toBe(200)
    expect(hiddenData).toEqual(await notFound.json())
    expect(hiddenData).toEqual({ found: false, status: null, verified: false, verifiedAt: null, linkedAt: null })

    const owner = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: staffViewer })
    expect(owner.status).toBe(200)
    expect(await owner.json()).toMatchObject({ found: true, personId: staffPerson.id })
  })

  it('hides a Business A binding from an owner of Business B in the same Tenant', async () => {
    const businessB = await createBusiness({ tenantId: tenant.id, name: 'FR097 Business B', code: 'BUS-FR097-B' })
    const ownerB = await prisma.person.create({ data: { code: 'PSN-FR097-OWNER-B', displayName: 'Owner B' } })
    await prisma.membership.create({
      data: { personId: ownerB.id, tenantId: tenant.id, businessId: businessB.id, role: 'OWNER', status: 'ACTIVE' },
    })
    const ownerBViewer = makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [businessB.id],
      ownedBusinessIds: [businessB.id],
      principal: { id: ownerB.id, code: ownerB.code, displayName: ownerB.displayName },
    })

    const providerSubject = 'U-fr097-business-a-hidden-from-b'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })

    const hidden = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: ownerBViewer })
    const absent = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=U-fr097-business-b-absent`,
    ), { viewer: ownerBViewer })

    const hiddenData = await hidden.json()
    expect(hidden.status).toBe(200)
    expect(hiddenData).toEqual(await absent.json())
    expect(hiddenData).toEqual({ found: false, status: null, verified: false, verifiedAt: null, linkedAt: null })
  })

  it('lets a Business OWNER read a binding for an active member of that Business', async () => {
    const member = await prisma.person.create({ data: { code: 'PSN-FR097-MEMBER-A', displayName: 'Member A' } })
    await prisma.membership.create({
      data: { personId: member.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE' },
    })
    const providerSubject = 'U-fr097-business-a-member'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: member.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })

    const response = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: staffViewer })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: true, personId: member.id })
  })

  it('allows a tenant-wide OWNER to read a binding in that Tenant', async () => {
    const tenantOwner = await prisma.person.create({ data: { code: 'PSN-FR097-TENANT-OWNER', displayName: 'Tenant Owner' } })
    await prisma.membership.create({
      data: { personId: tenantOwner.id, tenantId: tenant.id, scopeType: 'TENANT', businessId: null, role: 'OWNER', status: 'ACTIVE' },
    })
    const tenantOwnerViewer = makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      ownedTenantIds: [tenant.id],
      principal: { id: tenantOwner.id, code: tenantOwner.code, displayName: tenantOwner.displayName },
    })
    const providerSubject = 'U-fr097-tenant-wide-owner'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })

    const response = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: tenantOwnerViewer })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: true, personId: staffPerson.id })
  })

  it('allows an operator viewer with a live Person and ACTIVE Tenant to read a binding', async () => {
    const operator = await prisma.person.create({ data: { code: 'PSN-FR097-OPERATOR', displayName: 'Operator' } })
    const operatorViewer = makeOperatorViewer({
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: operator.id, code: operator.code, displayName: operator.displayName },
    })
    const providerSubject = 'U-fr097-operator-read'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })

    const response = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer: operatorViewer })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ found: true, personId: staffPerson.id })
  })

  it('refuses self lookup for a disabled Person with the not-found shape', async () => {
    const disabledPerson = await prisma.person.create({ data: { code: 'PSN-FR097-DISABLED', displayName: 'Disabled' } })
    const viewer = makeViewer({
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: disabledPerson.id, code: disabledPerson.code, displayName: disabledPerson.displayName },
    })
    const providerSubject = 'U-fr097-disabled-person'
    const token = await issueLinkToken({ tenantId: tenant.id, personId: disabledPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId: providerSubject })
    const beforeDisable = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer })
    expect(await beforeDisable.json()).toMatchObject({ found: true, personId: disabledPerson.id })
    await prisma.person.update({ where: { id: disabledPerson.id }, data: { accessDisabledAt: new Date() } })

    const hidden = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=${providerSubject}`,
    ), { viewer })
    const absent = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=U-fr097-disabled-absent`,
    ), { viewer })

    const hiddenData = await hidden.json()
    expect(hiddenData).toEqual(await absent.json())
    expect(hiddenData).toEqual({ found: false, status: null, verified: false, verifiedAt: null, linkedAt: null })
  })

  it('refuses self lookup in an inactive Tenant with the not-found shape', async () => {
    const portfolio = await createPortfolio({ name: 'FR097 Inactive Group', code: 'PF-FR097-INACTIVE' })
    const inactiveTenant = await createTenant({ portfolioId: portfolio.id, name: 'FR097 Inactive Tenant', code: 'TNT-FR097-INACTIVE' })
    const inactivePerson = await prisma.person.create({ data: { code: 'PSN-FR097-INACTIVE-TENANT', displayName: 'Inactive Tenant Person' } })
    const viewer = makeViewer({
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: inactivePerson.id, code: inactivePerson.code, displayName: inactivePerson.displayName },
    })
    const providerSubject = 'U-fr097-inactive-tenant'
    const token = await issueLinkToken({ tenantId: inactiveTenant.id, personId: inactivePerson.id })
    await redeemLinkToken({ tenantId: inactiveTenant.id, token: token.token, lineUserId: providerSubject })
    const beforeDeactivation = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${inactiveTenant.id}&providerSubject=${providerSubject}`,
    ), { viewer })
    expect(await beforeDeactivation.json()).toMatchObject({ found: true, personId: inactivePerson.id })
    await prisma.tenant.update({ where: { id: inactiveTenant.id }, data: { status: 'INACTIVE' } })

    const hidden = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${inactiveTenant.id}&providerSubject=${providerSubject}`,
    ), { viewer })
    const absent = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${inactiveTenant.id}&providerSubject=U-fr097-inactive-absent`,
    ), { viewer })

    const hiddenData = await hidden.json()
    expect(hiddenData).toEqual(await absent.json())
    expect(hiddenData).toEqual({ found: false, status: null, verified: false, verifiedAt: null, linkedAt: null })
  })

  it('refuses issuing a token for another Person or for a tenant without viewer authority', async () => {
    const attacker = await prisma.person.create({ data: { code: 'PSN-FR097-ATTACKER', displayName: 'Attacker' } })
    const attackerViewer = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: attacker.id, code: attacker.code, displayName: attacker.displayName },
    })

    const otherPerson = await postLinkToken(mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST', body: { tenantId: tenant.id, personId: staffPerson.id },
    }), { viewer: attackerViewer })
    expect(otherPerson.status).toBe(403)
    expect(await otherPerson.json()).toMatchObject({ error: 'LINK_TOKEN_FORBIDDEN' })

    const noTenantAuthority = await postLinkToken(mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST', body: { tenantId: tenant.id },
    }), { viewer: attackerViewer })
    expect(noTenantAuthority.status).toBe(403)
    expect(await noTenantAuthority.json()).toMatchObject({ error: 'LINK_TOKEN_FORBIDDEN' })
  })

  it.each([60, 900])('accepts link-token TTL %i seconds', async (ttlSeconds) => {
    const res = await postLinkToken(mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST', body: { tenantId: tenant.id, ttlSeconds },
    }), { viewer: staffViewer })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tokenId: expect.any(String), token: expect.any(String) })
  })

  it.each([59, 901, 600.5])('rejects link-token TTL %s seconds', async (ttlSeconds) => {
    const res = await postLinkToken(mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST', body: { tenantId: tenant.id, ttlSeconds },
    }), { viewer: staffViewer })
    expect(res.status).toBe(400)
  })

  it('blocks the complete public identity-takeover chain without writing a binding', async () => {
    const providerSubject = 'U-fr097-public-attack'
    const bindingToken = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })
    await redeemLinkToken({ tenantId: tenant.id, token: bindingToken.token, lineUserId: 'U-fr097-owner-bound' })
    const ownerToken = await issueLinkToken({ tenantId: tenant.id, personId: staffPerson.id })

    const attacker = await prisma.person.create({ data: { code: 'PSN-FR097-CHAIN-ATTACKER', displayName: 'Chain attacker' } })
    const attackerViewer = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      principal: { id: attacker.id, code: attacker.code, displayName: attacker.displayName },
    })

    const lookup = await getChannelIdentity(mockRequest(
      `http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&providerSubject=U-fr097-owner-bound`,
    ), { viewer: attackerViewer })
    expect(await lookup.json()).toEqual({ found: false, status: null, verified: false, verifiedAt: null, linkedAt: null })

    const issue = await postLinkToken(mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST', body: { tenantId: tenant.id, personId: staffPerson.id },
    }), { viewer: attackerViewer })
    expect(issue.status).toBe(403)
    expect(await issue.json()).toMatchObject({ error: 'LINK_TOKEN_FORBIDDEN' })

    const redeem = await postRedeemToken(mockRequest('http://localhost:3000/api/identity/link-tokens/redeem', {
      method: 'POST', body: {
        tenantId: tenant.id,
        token: ownerToken.token,
        lineUserId: providerSubject,
        merge: true,
      },
    }))
    expect(redeem.status).toBe(403)
    expect(await redeem.json()).toMatchObject({ error: 'LINK_REDEMPTION_REQUIRES_VERIFIED_LINE_SUBJECT' })
    await expect(prisma.externalIdentity.findUnique({
      where: { tenantId_provider_providerSubject: { tenantId: tenant.id, provider: 'LINE', providerSubject } },
    })).resolves.toBeNull()
    await expect(prisma.channelIdentity.findFirst({ where: { tenantId: tenant.id, providerSubject } })).resolves.toBeNull()
    await expect(prisma.identityLinkToken.findUnique({ where: { id: ownerToken.tokenId } }))
      .resolves.toMatchObject({ consumedAt: null })
  })

  it('rejects querying channel identity without required query parameters for an authenticated viewer', async () => {
    const badReq = mockRequest('http://localhost:3000/api/identity/channel-identities?providerSubject=U-missing-tenant')
    const res = await getChannelIdentity(badReq, { viewer: staffViewer })
    expect(res.status).toBe(400)
  })
})
