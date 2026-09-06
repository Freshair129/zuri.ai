// @req FR-149 — a portable restore preserves provider evidence without resuming external sends.
// @spec ADR-061, BR-008, SEC-016
// @tested tests/integration/line-server-backup.test.js
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'

describe('LINE server snapshot recovery', () => {
  it('restores FK parents, redacts token capabilities, disables accounts and preserves ambiguous/accepted outcomes', async () => {
    const portfolio = await createPortfolio({ code: 'PF-LINE-BAK', name: 'LINE Backup' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-LINE-BAK', name: 'LINE Backup' })
    const business = await createBusiness({ tenantId: tenant.id, code: 'BUS-LINE-BAK', name: 'LINE Backup' })
    const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    const connection = await provisionLineServerConnection({ businessId: business.id, name: 'Backup', destination: `U${'b'.repeat(32)}`, secretRef: 'deployment-secret:backup' }, { viewer })
    const account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: 'oa-backup', displayName: 'Backup' }, { viewer })
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { serverEnabled: true, status: 'CONNECTED', transportEpoch: 4 } })
    const jobs = []
    for (const status of ['QUEUED', 'CLAIMED', 'READY', 'SENDING', 'UNKNOWN', 'ACCEPTED', 'RECORDED', 'FAILED', 'CANCELLED']) {
      const inbound = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, channelAccountId: account.id, lineUserId: 'backup-user', threadId: 'backup-thread', text: status, externalMessageId: `backup-${status}` })
      jobs.push(await prisma.lineConversationJob.create({ data: {
        accountId: account.id, inboundMessageId: inbound.messageId, eventId: `backup-${status}`, tenantId: tenant.id, businessId: business.id,
        channelAccountId: account.id, transportEpoch: 4, executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED',
        ...(status === 'READY' ? { firstSendAt: new Date(), sendMethod: 'PUSH' } : {}),
        recipientId: 'backup-user', sourceUserId: 'backup-user', status, sealedReplyToken: `ciphertext-${status}`,
        claimantId: 'old-worker', leaseExpiresAt: new Date(Date.now() + 60000), expiresAt: new Date(Date.now() + 60000), correlationId: `backup-${status}`,
        ...(status === 'ACCEPTED' ? { acceptedAt: new Date(), providerRequestId: 'accepted-provider-id', answerText: 'Accepted answer' } : {}),
      } }))
    }
    const snapshot = await exportSnapshot()
    const exported = snapshot.tables.lineConversationJob.filter(job => job.accountId === account.id)
    expect(exported).toHaveLength(jobs.length)
    expect(exported.every(job => !Object.hasOwn(job, 'sealedReplyToken'))).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('ciphertext-')
    // Even an older or tampered snapshot cannot reintroduce a sealed token.
    for (const job of exported) job.sealedReplyToken = 'injected-restored-token'
    const result = await importSnapshot(snapshot, { confirm: true, viewer: makeOperatorViewer() })
    expect(result.restored).toBe(true)
    const restoredAccount = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(restoredAccount).toMatchObject({ serverEnabled: false, transportEpoch: 5 })
    for (const original of jobs) {
      const restored = await prisma.lineConversationJob.findUnique({ where: { id: original.id }, include: { inbound: true, account: true } })
      expect(restored).toMatchObject({ sealedReplyToken: null, claimantId: null, leaseExpiresAt: null, version: original.version + 1 })
      expect(restored.inbound.id).toBe(original.inboundMessageId)
      expect(restored.account.id).toBe(account.id)
      if (['QUEUED', 'CLAIMED'].includes(original.status)) expect(restored).toMatchObject({ status: 'CANCELLED', errorCode: 'RESTORED_REQUIRES_REVIEW' })
      else if (original.status === 'SENDING' || original.status === 'READY') expect(restored).toMatchObject({ status: 'UNKNOWN', errorCode: 'RESTORED_SEND_OUTCOME_UNKNOWN' })
      else expect(restored.status).toBe(original.status)
      if (original.status === 'ACCEPTED') expect(restored).toMatchObject({ providerRequestId: 'accepted-provider-id', answerText: 'Accepted answer', acceptedAt: original.acceptedAt })
    }
  })
})
