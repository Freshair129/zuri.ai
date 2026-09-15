import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { sendStaffReply } from '@/modules/crm/reply-record-service'

// @req FR-246 — a member with CRM write access replies from the inbox: pushed
//   through the account's LINE transport, recorded as OUTBOUND with reply source
//   STAFF naming the person, in the conversation's session. Refused before any push
//   for a viewer without owner authority or a conversation outside the Business's
//   tenant; refused before any record for a push LINE does not accept; idempotent
//   per clientRequestId so a retry never double-sends or double-records.
// @spec ADR-093 evidence gap; ADR-094 D2 (session), SDD-102; SEC-001; BR-011
// @tested tests/integration/crm-staff-reply.test.js

const ownerOf = (...businessIds) => makeViewer({
  role: 'OWNER', visibleBusinessIds: businessIds, ownedBusinessIds: businessIds, visibleDomains: [...VIEWER_DOMAINS],
})
const memberOf = (...businessIds) => makeViewer({
  role: 'MEMBER', visibleBusinessIds: businessIds, ownedBusinessIds: [], visibleDomains: [...VIEWER_DOMAINS],
})

let tenant, business, otherBusiness, provider, sequence = 0

async function makeAccount(over = {}) {
  const id = ++sequence
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Staff reply connection ${id}`, externalAccountId: `staff-reply-oa-${id}`, status: 'ACTIVE',
  })
  return prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: `staff-reply-account-${id}`, displayName: `Staff reply OA ${id}`, bindingCode: `staff-reply-binding-${id}`,
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', ...over,
  } })
}

async function seedConversation(channelAccountId, threadId = `user-${channelAccountId}`) {
  const inbound = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, channelAccountId, lineUserId: threadId,
    threadId, text: 'มีของสีฟ้าไหมครับ', externalMessageId: `staff-reply-inbound-${threadId}`,
  })
  return prisma.conversation.findUnique({ where: { id: inbound.conversationId } })
}

function fakePorts(outcome, spy = vi.fn()) {
  return {
    resolveAccount: vi.fn(async (accountId) => ({ id: accountId, channelAccessToken: 'fake-token' })),
    pushTransport: { send: async (args) => { spy(args); return outcome } },
  }
}
const ACCEPTED = { status: 'ACCEPTED_BY_LINE', httpStatus: 200, requestId: 'req-fake-1', code: null }

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Staff reply', code: 'PF-STAFF-REPLY' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Staff reply tenant', code: 'TNT-STAFF-REPLY' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Staff reply business', code: 'BUS-STAFF-REPLY' })
  otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Staff reply other business', code: 'BUS-STAFF-REPLY-OTHER' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
})

afterEach(() => vi.clearAllMocks())

describe('FR-246 authorization', () => {
  it('refuses a member without owner authority, before any push', async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode)
    const spy = vi.fn()
    await expect(sendStaffReply(conversation.id, {
      businessId: business.id, text: 'สวัสดีครับ', clientRequestId: crypto.randomUUID(),
    }, { viewer: memberOf(business.id), ports: fakePorts(ACCEPTED, spy) })).rejects.toMatchObject({ status: 403 })
    expect(spy).not.toHaveBeenCalled()
    expect(await prisma.message.count({ where: { conversationId: conversation.id, direction: 'OUTBOUND' } })).toBe(0)
  })

  it("answers a Business the viewer cannot see as not found, never as forbidden", async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode)
    await expect(sendStaffReply(conversation.id, {
      businessId: business.id, text: 'สวัสดีครับ', clientRequestId: crypto.randomUUID(),
    }, { viewer: ownerOf(otherBusiness.id) })).rejects.toMatchObject({ status: 404 })
  })

  it("refuses a conversation from another tenant's Business, and refuses the caller's own OWNER Business used as the scope", async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode)
    // Owns otherBusiness (same tenant) but names business as the scope it does not own.
    await expect(sendStaffReply(conversation.id, {
      businessId: business.id, text: 'สวัสดีครับ', clientRequestId: crypto.randomUUID(),
    }, { viewer: ownerOf(otherBusiness.id) })).rejects.toMatchObject({ status: 404 })
  })
})

describe('FR-246 channel guard', () => {
  it('refuses a conversation on the legacy channel (no LineOaAccount at all), before any push', async () => {
    const conversation = await seedConversation('LEGACY:LINE')
    const spy = vi.fn()
    await expect(sendStaffReply(conversation.id, {
      businessId: business.id, text: 'สวัสดีครับ', clientRequestId: crypto.randomUUID(),
    }, { viewer: ownerOf(business.id), ports: fakePorts(ACCEPTED, spy) })).rejects.toMatchObject({ status: 409, message: 'STAFF_REPLY_NOT_SUPPORTED_FOR_CHANNEL' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('refuses a real account that is not server-enabled, before any push', async () => {
    const account = await makeAccount({ serverEnabled: false, status: 'DRAFT' })
    const conversation = await seedConversation(account.bindingCode)
    const spy = vi.fn()
    await expect(sendStaffReply(conversation.id, {
      businessId: business.id, text: 'สวัสดีครับ', clientRequestId: crypto.randomUUID(),
    }, { viewer: ownerOf(business.id), ports: fakePorts(ACCEPTED, spy) })).rejects.toMatchObject({ status: 409, message: 'LINE_ACCOUNT_NOT_SERVER_ENABLED' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('FR-246 send and record', () => {
  it('pushes, records an OUTBOUND message naming the person, joins the open session, and refreshes the preview', async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode, 'user-send-record')
    const owner = ownerOf(business.id)
    const spy = vi.fn()
    const clientRequestId = crypto.randomUUID()

    const result = await sendStaffReply(conversation.id, {
      businessId: business.id, text: 'มีสีฟ้าค่ะ พรุ่งนี้ส่งได้เลย', clientRequestId,
    }, { viewer: owner, ports: fakePorts(ACCEPTED, spy) })

    expect(result.created).toBe(true)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      to: conversation.externalThreadId, retryKey: clientRequestId,
      messages: [{ type: 'text', text: 'มีสีฟ้าค่ะ พรุ่งนี้ส่งได้เลย' }],
    }))

    const message = await prisma.message.findUnique({ where: { id: result.messageId } })
    expect(message).toMatchObject({ direction: 'OUTBOUND', body: 'มีสีฟ้าค่ะ พรุ่งนี้ส่งได้เลย', externalMessageId: `staff:${clientRequestId}` })
    expect(message.sessionId).toBeTruthy()

    const inbound = await prisma.message.findFirst({ where: { conversationId: conversation.id, direction: 'INBOUND' } })
    expect(message.sessionId).toBe(inbound.sessionId)

    const audit = await prisma.auditEvent.findFirst({ where: { entityId: conversation.id, action: 'STAFF_REPLY_DELIVERED' } })
    expect(audit.actorId).toBe(owner.principal.id)
    expect(audit.actorType).toBe('LOCAL_USER')
    expect(audit.payloadJson).toContain('"source":"STAFF"')
    expect(audit.payloadJson).not.toContain('มีสีฟ้าค่ะ')

    const updated = await prisma.conversation.findUnique({ where: { id: conversation.id } })
    expect(updated.lastMessagePreview).toContain('มีสีฟ้าค่ะ')
  })

  it('is idempotent: the same clientRequestId never pushes or records twice', async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode, 'user-idempotent')
    const spy = vi.fn()
    const clientRequestId = crypto.randomUUID()
    const input = { businessId: business.id, text: 'ข้อความซ้ำ', clientRequestId }

    const first = await sendStaffReply(conversation.id, input, { viewer: ownerOf(business.id), ports: fakePorts(ACCEPTED, spy) })
    const second = await sendStaffReply(conversation.id, input, { viewer: ownerOf(business.id), ports: fakePorts(ACCEPTED, spy) })

    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, messageId: first.messageId })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(await prisma.message.count({ where: { conversationId: conversation.id, externalMessageId: `staff:${clientRequestId}` } })).toBe(1)
  })

  it('never records anything LINE did not accept, and a later retry with the same key can still succeed', async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode, 'user-retry')
    const clientRequestId = crypto.randomUUID()
    const input = { businessId: business.id, text: 'ลองส่งใหม่', clientRequestId }
    const failure = { status: 'RETRYABLE_FAILURE', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE' }

    await expect(sendStaffReply(conversation.id, input, { viewer: ownerOf(business.id), ports: fakePorts(failure) }))
      .rejects.toMatchObject({ status: 502, message: 'STAFF_REPLY_NOT_ACCEPTED_BY_LINE' })
    expect(await prisma.message.count({ where: { conversationId: conversation.id, externalMessageId: `staff:${clientRequestId}` } })).toBe(0)

    const retried = await sendStaffReply(conversation.id, input, { viewer: ownerOf(business.id), ports: fakePorts(ACCEPTED) })
    expect(retried.created).toBe(true)
  })

  it('allows several staff messages in the same conversation with no new inbound between them', async () => {
    const account = await makeAccount()
    const conversation = await seedConversation(account.bindingCode, 'user-multi')
    const owner = ownerOf(business.id)
    const one = await sendStaffReply(conversation.id, { businessId: business.id, text: 'ข้อความที่หนึ่ง', clientRequestId: crypto.randomUUID() }, { viewer: owner, ports: fakePorts(ACCEPTED) })
    const two = await sendStaffReply(conversation.id, { businessId: business.id, text: 'ข้อความที่สอง', clientRequestId: crypto.randomUUID() }, { viewer: owner, ports: fakePorts(ACCEPTED) })
    expect(one.messageId).not.toBe(two.messageId)
    expect(await prisma.message.count({ where: { conversationId: conversation.id, direction: 'OUTBOUND' } })).toBe(2)
  })
})
