import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { appendOutbound, recordLineReply } from '@/modules/crm/reply-record-service'
import { LEGACY_CHANNEL_ACCOUNT_ID } from '@/modules/identity/channel-identity'
import { getConversationInbox } from '@/modules/crm/conversation-read-model'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

// @req FR-148 — account/business isolation, legacy preservation and atomic CRM writes.
// @spec ADR-061, BR-001, SEC-001

let tenant, businessA, businessB
const input = (overrides = {}) => ({
  tenantId: tenant.id, businessId: businessA.id, channelAccountId: 'oa-scope-a',
  lineUserId: 'U-account-shared', threadId: 'thread-account-shared',
  text: 'account question', externalMessageId: 'message-account-shared', ...overrides,
})
const scope = (overrides = {}) => ({
  tenantId: tenant.id, businessId: businessA.id, channelAccountId: 'oa-scope-a', ...overrides,
})

describe('CRM account namespace', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Account namespace', code: 'PF-CRM-ACCOUNT' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Account tenant', code: 'TNT-CRM-ACCOUNT' })
    businessA = await createBusiness({ tenantId: tenant.id, name: 'Account A', code: 'BUS-CRM-ACCOUNT-A' })
    businessB = await createBusiness({ tenantId: tenant.id, name: 'Account B', code: 'BUS-CRM-ACCOUNT-B' })
  })

  it('separates two OAs in one business while keeping the tenant customer shared', async () => {
    const a = await ingestLineMessage(input())
    const b = await ingestLineMessage(input({ channelAccountId: 'oa-scope-b' }))
    expect(a.customerId).toBe(b.customerId)
    expect(a.conversationId).not.toBe(b.conversationId)
    expect(a.messageId).not.toBe(b.messageId)
    expect((await ingestLineMessage(input())).created.message).toBe(false)
    expect((await ingestLineMessage(input({ channelAccountId: 'oa-scope-b' }))).messageId).toBe(b.messageId)
  })

  it('separates two businesses under one tenant and rejects a binding rehome', async () => {
    const a = await ingestLineMessage(input())
    const b = await ingestLineMessage(input({ businessId: businessB.id, channelAccountId: 'oa-business-b' }))
    expect(a.customerId).toBe(b.customerId)
    expect(a.conversationId).not.toBe(b.conversationId)
    // The same message id must not bypass the business check via idempotency.
    await expect(ingestLineMessage(input({ businessId: businessB.id })))
      .rejects.toMatchObject({ status: 409, message: 'CONVERSATION_BUSINESS_SCOPE_CONFLICT' })
    const row = await prisma.conversation.findUnique({ where: { id: a.conversationId } })
    expect(row.businessId).toBe(businessA.id)
  })

  it('requires business authority for a known account and refuses a foreign business', async () => {
    await expect(ingestLineMessage(input({ businessId: undefined })))
      .rejects.toMatchObject({ status: 400 })
    await expect(ingestLineMessage(input({ businessId: 'business-outside-tenant' })))
      .rejects.toMatchObject({ status: 404 })
  })

  it('leaves legacy threads in their namespace even when a real account arrives', async () => {
    const legacy = await ingestLineMessage(input({ channelAccountId: undefined }))
    const known = await ingestLineMessage(input())
    expect(legacy.conversationId).not.toBe(known.conversationId)
    expect((await prisma.conversation.findUnique({ where: { id: legacy.conversationId } })).channelAccountId)
      .toBe(LEGACY_CHANNEL_ACCOUNT_ID)
  })

  it('rolls back first-contact identity, CRM rows and audits if the enclosing enqueue fails', async () => {
    const user = 'U-atomic-account-rollback'
    let personId, conversationId
    await expect(prisma.$transaction(async (tx) => {
      const result = await ingestLineMessage(input({ lineUserId: user, threadId: user }), { db: tx })
      personId = result.personId
      conversationId = result.conversationId
      throw new Error('QUEUE_INSERT_FAILED')
    })).rejects.toThrow('QUEUE_INSERT_FAILED')
    expect(await prisma.person.findUnique({ where: { id: personId } })).toBeNull()
    expect(await prisma.externalIdentity.count({ where: { tenantId: tenant.id, providerSubject: user } })).toBe(0)
    expect(await prisma.channelIdentity.count({ where: { tenantId: tenant.id, providerSubject: user } })).toBe(0)
    expect(await prisma.conversation.findUnique({ where: { id: conversationId } })).toBeNull()
    expect(await prisma.auditEvent.count({ where: { entityId: conversationId } })).toBe(0)
  })

  it('projects the account in the inbox and hides other-business conversations', async () => {
    const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: [...VIEWER_DOMAINS] })
    const inbox = await getConversationInbox({ viewer, businessId: businessA.id })
    expect(inbox.conversations.some((row) => row.channelAccountId === 'oa-scope-a')).toBe(true)
    expect(inbox.conversations.some((row) => row.channelAccountId === 'oa-scope-b')).toBe(true)
    expect(inbox.conversations.some((row) => row.businessId === businessB.id)).toBe(false)
  })
})

describe('server accepted outbound append', () => {
  it('refuses cross-account and cross-business receipts before idempotency', async () => {
    const inbound = await ingestLineMessage(input())
    const receipt = { inboundMessageId: inbound.messageId, text: 'accepted answer' }
    for (const wrong of [{ channelAccountId: 'oa-scope-b' }, { businessId: businessB.id }]) {
      await expect(appendOutbound({ ...scope(wrong), receipt })).rejects.toMatchObject({ status: 404 })
      await expect(recordLineReply({ ...scope(wrong), receipt })).rejects.toMatchObject({ status: 404 })
    }
    const acceptedAt = '2026-09-06T12:00:00.000Z'
    const result = await prisma.$transaction((db) => appendOutbound({
      db, ...scope(), receipt, acceptedAt, providerRequestId: 'line-request-123',
    }))
    expect(result.created).toBe(true)
    expect((await appendOutbound({ ...scope(), receipt })).created).toBe(false)
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: inbound.conversationId, action: 'OUTBOUND_ACCEPTED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ acceptedAt, providerRequestId: 'line-request-123', channelAccountId: 'oa-scope-a' })
    expect(audit.payloadJson).not.toContain(receipt.text)
    expect((await prisma.message.findUnique({ where: { id: result.messageId } })).createdAt.toISOString()).toBe(acceptedAt)
    await expect(appendOutbound({ ...scope({ channelAccountId: 'oa-scope-b' }), receipt })).rejects.toMatchObject({ status: 404 })
  })

  it('rolls back outbound and its audit when terminal job-state persistence fails', async () => {
    const inbound = await ingestLineMessage(input({ externalMessageId: 'atomic-outbound' }))
    await expect(prisma.$transaction(async (db) => {
      await appendOutbound({ db, ...scope(), receipt: { inboundMessageId: inbound.messageId, text: 'not committed' } })
      throw new Error('JOB_STATE_WRITE_FAILED')
    })).rejects.toThrow('JOB_STATE_WRITE_FAILED')
    expect(await prisma.message.count({ where: { conversationId: inbound.conversationId, body: 'not committed' } })).toBe(0)
    const audits = await prisma.auditEvent.findMany({ where: { entityId: inbound.conversationId, action: 'OUTBOUND_ACCEPTED' } })
    expect(audits.some((row) => JSON.parse(row.payloadJson).inboundMessageId === inbound.messageId)).toBe(false)
  })

  it('requires complete scope and never calls acceptance delivery', async () => {
    await expect(appendOutbound({ ...scope({ businessId: undefined }), receipt: {} }))
      .rejects.toMatchObject({ message: 'OUTBOUND_SCOPE_REQUIRED' })
    await expect(appendOutbound({ ...scope(), receipt: { deliveredAt: '2026-09-06T12:00:00.000Z' } }))
      .rejects.toMatchObject({ message: 'ACCEPTANCE_IS_NOT_DELIVERY' })
  })
})
