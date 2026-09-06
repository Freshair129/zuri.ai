// @req FR-149 — account server activation, secret-safe provisioning, version fences and policy.
// @spec ADR-061, SEC-001, SEC-016
// @tested tests/integration/fr149-line-server-configuration.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { zLineOaAccountAction } from '@/modules/line-oa-studio/domain/line-oa-account'
let business, owner, member, account
const ports = { validateServerCredentials: async () => ({ ready: true }) }
describe('FR-149 account configuration', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-SERVERLINE', name: 'Server LINE' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-SERVERLINE', name: 'Server LINE' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-SERVERLINE', name: 'Server LINE' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })
  })
  it('provisions metadata transactionally for an owner and never returns credential references', async () => {
    const input = { businessId: business.id, name: 'Main', destination: `U${'a'.repeat(32)}`, secretRef: 'deployment-secret:main' }
    await expect(provisionLineServerConnection(input, { viewer: member })).rejects.toMatchObject({ status: 404 })
    await expect(provisionLineServerConnection({ ...input, channelSecret: 'raw' }, { viewer: owner })).rejects.toThrow()
    const connection = await provisionLineServerConnection(input, { viewer: owner })
    expect(JSON.stringify(connection)).not.toContain(input.secretRef)
    const credential = await prisma.integrationCredential.findUnique({ where: { connectionId: connection.id } })
    expect(credential.secretRef).toBe(input.secretRef)
    account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: 'oa-server-main', displayName: 'Main' }, { viewer: owner })
    expect(account).toMatchObject({ serverEnabled: false, transportMode: 'CLOUD', executionMode: 'SERVER', modelAccess: 'LOCAL_ONLY', transportEpoch: 1 })
  })
  it('requires an explicit legacy handoff and refuses failed credential validation without changing ownership', async () => {
    expect(() => zLineOaAccountAction.parse({ action: 'ENABLE_SERVER', version: account.version })).toThrow()
    await expect(applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version, legacyQuiesced: true }, {
      viewer: owner, ports: { validateServerCredentials: async () => { throw new Error('CREDENTIALS_UNAVAILABLE') } },
    })).rejects.toThrow('CREDENTIALS_UNAVAILABLE')
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).serverEnabled).toBe(false)
    account = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version, legacyQuiesced: true }, { viewer: owner, ports })
    expect(account).toMatchObject({ serverEnabled: true, status: 'CONNECTED', effectiveStatus: 'LIVE', bindingCode: null, transportEpoch: 2 })
  })
  it('persists explicit model policy and disables ownership with epoch/version fencing', async () => {
    await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_EXECUTION', version: account.version, executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', allowDelayedPush: false }, { viewer: member })).rejects.toMatchObject({ status: 404 })
    account = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_EXECUTION', version: account.version, executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', allowDelayedPush: false }, { viewer: owner })
    expect(account).toMatchObject({ executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', allowDelayedPush: false, serverEnabled: true, transportEpoch: 3 })
    await expect(applyLineOaAccountAction(account.id, { action: 'DISABLE_SERVER', version: account.version - 1 }, { viewer: owner })).rejects.toMatchObject({ status: 409 })
    account = await applyLineOaAccountAction(account.id, { action: 'DISABLE_SERVER', version: account.version }, { viewer: owner })
    expect(account).toMatchObject({ serverEnabled: false, transportEpoch: 4 })
  })
  it('refuses ownership changes while sending or unknown, then cancels queued work atomically', async () => {
    const inbound = await ingestLineMessage({ tenantId: business.tenantId, businessId: business.id, channelAccountId: account.id, lineUserId: 'line-config-user', threadId: 'line-config-thread', text: 'Hello', externalMessageId: 'configuration-message' })
    const job = await prisma.lineConversationJob.create({ data: {
      accountId: account.id, inboundMessageId: inbound.messageId, eventId: 'config-event', tenantId: business.tenantId, businessId: business.id,
      channelAccountId: account.id, transportEpoch: account.transportEpoch, executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', recipientId: 'line-config-user', sourceUserId: 'line-config-user',
      status: 'SENDING', expiresAt: new Date(Date.now() + 60000), correlationId: 'configuration-job',
    } })
    for (const status of ['SENDING', 'UNKNOWN']) {
      await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status } })
      await expect(applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version, legacyQuiesced: true }, { viewer: owner, ports })).rejects.toMatchObject({ status: 409, message: 'LINE_OA_DELIVERY_RECONCILIATION_REQUIRED' })
      expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).version).toBe(account.version)
    }
    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'QUEUED', sealedReplyToken: 'sealed' } })
    account = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version, legacyQuiesced: true }, { viewer: owner, ports })
    expect(await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'CANCELLED', sealedReplyToken: null, claimantId: null })
    expect(account.transportEpoch).toBe(5)
  })

})
