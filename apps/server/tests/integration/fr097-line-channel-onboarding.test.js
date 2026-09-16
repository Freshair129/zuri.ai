import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { resolveLineIdentity, revokeLineIdentity } from '@/modules/identity/resolve-line-identity'
import { authorizeAgentToolExecution } from '@/modules/identity/agent-tool-authorizer'
import { POST as postLinkToken } from '@/app/api/identity/link-tokens/route'
import { POST as postRedeemToken } from '@/app/api/identity/link-tokens/redeem/route'
import { GET as getChannelIdentity } from '@/app/api/identity/channel-identities/route'

// @req FR-097 — verified channel onboarding and identity binding for LINE OA
// @spec ADR-045 D1, D5, SDD-052, BR-020, SEC-018
// @tested tests/integration/fr097-line-channel-onboarding.test.js

let tenant
let business
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

  const staffPerson = await prisma.person.create({ data: { code: 'PSN-FR097-STAFF', displayName: 'Staff Admin' } })
  await prisma.membership.create({
    data: { personId: staffPerson.id, tenantId: tenant.id, businessId: business.id, role: 'ADMIN', status: 'ACTIVE' },
  })

  staffViewer = makeViewer({
    principal: { id: staffPerson.id, code: staffPerson.code, displayName: staffPerson.displayName },
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    ownedTenantIds: [tenant.id],
    visibleDomains: ['identity', 'platform', 'line-oa'],
  })
  staffViewer.tenantId = tenant.id
  staffViewer.personId = staffPerson.id
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

    // 2. Query status endpoint returns PENDING
    const statusReq = mockRequest(`http://localhost:3000/api/identity/channel-identities?tenantId=${tenant.id}&channelAccountId=${channelAccountId}&providerSubject=${lineUserId}`)
    const statusRes = await getChannelIdentity(statusReq)
    const statusData = await statusRes.json()
    expect(statusRes.status).toBe(200)
    expect(statusData).toMatchObject({
      found: true,
      status: 'PENDING',
      verified: false,
    })

    // 3. Security check: Tool execution rejected with IDENTITY_PENDING
    const unverifiedViewer = {
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

    // 4. Issue Link Token via API route
    // Note: resolveRequestViewer in test uses default test dev viewer if mock session not present
    const issueReq = mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST',
      body: { personId: staffViewer.personId, ttlSeconds: 600 },
    })
    const issueRes = await postLinkToken(issueReq, { viewer: staffViewer })
    expect(issueRes.status).toBe(200)
    const issueData = await issueRes.json()
    expect(issueData.token).toBeTruthy()
    expect(issueData.tokenId).toBeTruthy()

    // 5. Redeem Link Token via API route
    const redeemReq = mockRequest('http://localhost:3000/api/identity/link-tokens/redeem', {
      method: 'POST',
      body: {
        tenantId: tenant.id,
        token: issueData.token,
        channelAccountId,
        lineUserId,
        displayName: 'Verified Staff Member',
        merge: true,
      },
    })
    const redeemRes = await postRedeemToken(redeemReq)
    expect(redeemRes.status).toBe(200)
    const redeemData = await redeemRes.json()
    expect(redeemData.personId).toBe(staffViewer.personId)
    expect(redeemData.channelIdentity.status).toBe('ACTIVE')

    // 6. Query status endpoint now confirms ACTIVE and verified: true
    const updatedStatusRes = await getChannelIdentity(statusReq)
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
    expect(verifiedResolution.personId).toBe(staffViewer.personId)

    // 8. Tool execution is now authorized for the verified identity
    const verifiedViewer = {
      personId: staffViewer.personId,
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

  it('rejects redeeming an already consumed link token', async () => {
    const channelAccountId = 'LINE-OA-FR097-CONSUME'
    const lineUserId = 'U-fr097-consume'

    const issueReq = mockRequest('http://localhost:3000/api/identity/link-tokens', {
      method: 'POST',
      body: { personId: staffViewer.personId, ttlSeconds: 600 },
    })
    const issueRes = await postLinkToken(issueReq, { viewer: staffViewer })
    const { token } = await issueRes.json()

    // First redemption succeeds
    const redeem1 = await postRedeemToken(mockRequest('http://localhost:3000/api/identity/link-tokens/redeem', {
      method: 'POST',
      body: { tenantId: tenant.id, token, channelAccountId, lineUserId },
    }))
    expect(redeem1.status).toBe(200)

    // Second redemption fails
    const redeem2 = await postRedeemToken(mockRequest('http://localhost:3000/api/identity/link-tokens/redeem', {
      method: 'POST',
      body: { tenantId: tenant.id, token, channelAccountId, lineUserId },
    }))
    expect(redeem2.status).toBe(400)
    const err = await redeem2.json()
    expect(err.error).toMatch(/already been used/i)
  })

  it('rejects querying channel identity without required query parameters', async () => {
    const badReq = mockRequest('http://localhost:3000/api/identity/channel-identities?providerSubject=U-missing-tenant')
    const res = await getChannelIdentity(badReq)
    expect(res.status).toBe(400)
  })
})
