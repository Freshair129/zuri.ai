import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { resolveLineIdentity, revokeLineIdentity } from '@/modules/identity/resolve-line-identity'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'

// @req FR-097 — a trusted channel subject has an explicit pending/active/revoked
// lifecycle and never gains private authority from transport identity alone.
// @spec ADR-044 D1-D2, ADR-045 D1/D5-D6, BR-020, SEC-018
// @tested tests/integration/channel-identity.test.js

let tenant
let business

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Channel Identity Group', code: 'PF-CHN-ID' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Channel Identity Tenant', code: 'TNT-CHN-ID' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Channel Identity Business', code: 'BUS-CHN-ID' })
})

describe('FR-097 verified channel identity lifecycle', () => {
  it('records first contact as PENDING in the trusted channel namespace', async () => {
    const resolved = await resolveLineIdentity({
      tenantId: tenant.id,
      channelAccountId: 'LINE-ACCOUNT-FR097-A',
      lineUserId: 'U-fr097-pending',
      displayName: 'Pending channel user',
    })

    expect(resolved.channelIdentity).toMatchObject({ status: 'PENDING' })
    await expect(prisma.channelIdentity.findUnique({
      where: {
        tenantId_channel_channelAccountId_providerSubject: {
          tenantId: tenant.id,
          channel: 'LINE',
          channelAccountId: 'LINE-ACCOUNT-FR097-A',
          providerSubject: 'U-fr097-pending',
        },
      },
    })).resolves.toMatchObject({
      tenantId: tenant.id,
      personId: resolved.personId,
      status: 'PENDING',
      verifiedAt: null,
      linkedAt: null,
    })
  })

  it('does not grant private agent memory while the channel is pending', async () => {
    await resolveLineIdentity({
      tenantId: tenant.id,
      channelAccountId: 'LINE-ACCOUNT-FR097-B',
      lineUserId: 'U-fr097-private',
    })

    const result = await resolveAgentAuthorization({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'U-fr097-private',
      serverScope: {
        transportVerified: true,
        channelAccountId: 'LINE-ACCOUNT-FR097-B',
        businessId: business.id,
      },
    })

    expect(result.policy).toMatchObject({
      decision: 'DENY',
      reason: 'IDENTITY_PENDING',
      privateMemoryAllowed: false,
    })
    expect(result.authorizedVaults).toEqual([])
  })

  it('moves the same channel subject to ACTIVE only through the link token flow', async () => {
    const person = await prisma.person.create({ data: { code: 'PSN-FR097-LINK', displayName: 'Linked staff' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
    const channelAccountId = 'LINE-ACCOUNT-FR097-C'
    const providerSubject = 'U-fr097-linked'

    await resolveLineIdentity({ tenantId: tenant.id, channelAccountId, lineUserId: providerSubject })
    const link = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({
      tenantId: tenant.id,
      token: link.token,
      channelAccountId,
      lineUserId: providerSubject,
      merge: true,
    })

    const resolved = await resolveLineIdentity({ tenantId: tenant.id, channelAccountId, lineUserId: providerSubject })
    expect(resolved.channelIdentity).toMatchObject({ status: 'ACTIVE' })
    await expect(prisma.channelIdentity.findUnique({
      where: {
        tenantId_channel_channelAccountId_providerSubject: {
          tenantId: tenant.id,
          channel: 'LINE',
          channelAccountId,
          providerSubject,
        },
      },
    })).resolves.toMatchObject({ personId: person.id, status: 'ACTIVE' })

    const result = await resolveAgentAuthorization({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: providerSubject,
      serverScope: { transportVerified: true, channelAccountId, businessId: business.id },
    })
    expect(result.policy.privateMemoryAllowed).toBe(true)
  })

  it('revokes the channel record and rejects subsequent resolution', async () => {
    const channelAccountId = 'LINE-ACCOUNT-FR097-D'
    const providerSubject = 'U-fr097-revoked'
    await resolveLineIdentity({ tenantId: tenant.id, channelAccountId, lineUserId: providerSubject })

    await revokeLineIdentity(tenant.id, providerSubject, { channelAccountId })

    await expect(prisma.channelIdentity.findUnique({
      where: {
        tenantId_channel_channelAccountId_providerSubject: {
          tenantId: tenant.id,
          channel: 'LINE',
          channelAccountId,
          providerSubject,
        },
      },
    })).resolves.toMatchObject({ status: 'REVOKED' })
    await expect(resolveLineIdentity({ tenantId: tenant.id, channelAccountId, lineUserId: providerSubject }))
      .rejects.toThrow(/revoked/i)
  })
})
