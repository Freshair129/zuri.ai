// @req FR-149 — a portable restore preserves provider evidence without resuming external sends.
// @spec ADR-061, BR-008, SEC-016
// @tested tests/integration/line-server-backup.test.js
import { describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { exportSnapshot, importSnapshot, previewImport } from '@/modules/project-manager/application/backup-service'
import { reconcileLineMemoryDeliveries } from '@/modules/line-oa-studio/application/line-memory-delivery'
import { appendTraceEvent } from '@/modules/agent/execution-trace'

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
        ...(status === 'RECORDED' ? { memorySyncOptIn: true, memoryDeliveryState: 'PENDING', memoryDeliveryAttempts: 2,
          memoryDeliveryNextAttemptAt: new Date(Date.now() - 1000), memoryDeliveryLeaseUntil: new Date(Date.now() + 60000),
          acceptedAt: new Date(), providerRequestId: 'recorded-provider-id', answerText: 'Recorded answer' } : {}),
      } }))
      if (status === 'RECORDED') {
        const outbound = await prisma.message.create({ data: { conversationId: inbound.conversationId, direction: 'OUTBOUND',
          body: 'Recorded answer', externalMessageId: `reply:${inbound.messageId}` } })
        await appendTraceEvent(prisma, { scope: { tenantId: tenant.id, businessId: business.id }, turnId: jobs.at(-1).id,
          kind: 'MEMORY_DELIVERY_PENDING', idempotencyKey: `memory-delivery:pending:${jobs.at(-1).id}`,
          payload: { jobId: jobs.at(-1).id, inboundMessageId: inbound.messageId, outboundMessageId: outbound.id,
            receiptId: outbound.id, channelAccountId: account.id, externalThreadRef: 'backup-thread', audienceKind: 'DIRECT',
            providerAcceptance: 'ACCEPTED_BY_LINE' } })
      }
    }
    const snapshot = await exportSnapshot()
    const exported = snapshot.tables.lineConversationJob.filter(job => job.accountId === account.id)
    expect(exported).toHaveLength(jobs.length)
    expect(snapshot.lineWorkerMemoryRecovery).toEqual({ schemaVersion: 'line-worker-memory-recovery.v1', requiredTables: ['lineConversationJob', 'agentTraceEvent'] })
    expect(exported.every(job => !Object.hasOwn(job, 'sealedReplyToken'))).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('ciphertext-')
    const corrupt = structuredClone(snapshot)
    const corruptJob = corrupt.tables.lineConversationJob.find(job => job.id === jobs.find((job) => job.status === 'RECORDED').id)
    corruptJob.memorySyncOptIn = false
    corruptJob.memoryDeliveryAttempts = -1
    corruptJob.memoryDeliveryState = 'ACKNOWLEDGED'
    corruptJob.memoryDeliveryNextAttemptAt = new Date()
    corruptJob.audienceKind = 'NOT_A_LINE_AUDIENCE'
    const corruptPreview = await previewImport(corrupt, { viewer: makeOperatorViewer() })
    expect(corruptPreview.valid).toBe(false)
    expect(corruptPreview.lineWorkerMemoryRecovery.errors.join(' ')).toMatch(/invalid memoryDeliveryAttempts|invalid audienceKind|retry cursor on a terminal state|pending memory/)
    const foreignTrace = structuredClone(snapshot)
    const foreign = foreignTrace.tables.agentTraceEvent.find(event => event.kind === 'MEMORY_DELIVERY_PENDING' && event.turnId === jobs.find(job => job.status === 'RECORDED').id)
    foreign.businessId = 'foreign-business'
    const foreignPreview = await previewImport(foreignTrace, { viewer: makeOperatorViewer() })
    expect(foreignPreview.valid).toBe(false)
    expect(foreignPreview.lineWorkerMemoryRecovery.errors.join(' ')).toContain('no matching scoped MEMORY_DELIVERY_PENDING')
    const emptyTrace = structuredClone(snapshot)
    emptyTrace.tables.agentTraceEvent = emptyTrace.tables.agentTraceEvent.filter(event => event.kind !== 'MEMORY_DELIVERY_PENDING')
    const emptyTracePreview = await previewImport(emptyTrace, { viewer: makeOperatorViewer() })
    expect(emptyTracePreview.valid).toBe(false)
    expect(emptyTracePreview.lineWorkerMemoryRecovery.errors.join(' ')).toContain('no matching scoped MEMORY_DELIVERY_PENDING')
    const legacy = structuredClone(snapshot)
    delete legacy.lineWorkerMemoryRecovery
    const legacyPreview = await previewImport(legacy, { viewer: makeOperatorViewer() })
    expect(legacyPreview.valid).toBe(false)
    expect(legacyPreview.lineWorkerMemoryRecovery.status).toBe('UNAVAILABLE')
    expect(legacyPreview.errors.join(' ')).toMatch(/enrolled jobs or memory evidence/)
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
      if (original.status === 'RECORDED') expect(restored).toMatchObject({ memorySyncOptIn: true, memoryDeliveryState: 'PENDING', memoryDeliveryAttempts: 2, memoryDeliveryLeaseUntil: null })
    }
    const recordDelivery = vi.fn()
    const memoryRun = await reconcileLineMemoryDeliveries({ db: prisma, threadMemory: { recordDelivery }, now: () => new Date(), workerId: 'restored-memory-scanner', policyResolver: vi.fn() })
    expect(memoryRun.closed).toBe(1)
    expect(recordDelivery).not.toHaveBeenCalled()
    expect((await prisma.lineConversationJob.findUnique({ where: { id: jobs.find((job) => job.status === 'RECORDED').id } })).memoryDeliveryState).toBe('CLOSED')
  })
})
