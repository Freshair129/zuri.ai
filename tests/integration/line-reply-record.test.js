import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { recordLineReply, replyExternalId } from '@/modules/crm/reply-record-service'
import { createLineDeliveryPost } from '@/app/api/agent/line-delivery/route'
import { getConversationThread } from '@/modules/crm/conversation-read-model'
import { makeViewer } from '../factories/viewer'

// @req FR-093 — the reply the customer received becomes a row, keyed to the message it
// answered, and cannot be attached across a tenant boundary.
// @spec SDD-051, BR-011, SEC-001, SDD-048

const quietLogger = { info() {}, warn() {}, error() {}, debug() {}, emit() {} }

let tenantA, busA, tenantB, busB
let inboundA, inboundB

const post = (handler, body, headers = {}) => handler(new Request('http://local/api/agent/line-delivery', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
}))

// No composed runtime → the non-production client-scope branch, the same seam the
// webhook uses in the lab (SEC-010 closes it in production).
const handler = () => createLineDeliveryPost({ runtimeFactory: async () => null, logger: quietLogger })

describe('LINE reply delivery receipt (FR-093)', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Reply Group A', code: 'PF-REPLY-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Reply Tenant A', code: 'TNT-REPLY-A' })
    busA = await createBusiness({ tenantId: tenantA.id, name: 'ร้านตอบกลับ', code: 'BUS-REPLY-A' })

    const pfB = await createPortfolio({ name: 'Reply Group B', code: 'PF-REPLY-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Reply Tenant B', code: 'TNT-REPLY-B' })
    busB = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่น', code: 'BUS-REPLY-B' })

    inboundA = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA.id, lineUserId: 'U-reply-a', displayName: 'ลูกค้า ก',
      threadId: 'TH-REPLY-A', text: 'ราคาเท่าไรครับ', externalMessageId: 'MR-1',
    })
    inboundB = await ingestLineMessage({
      tenantId: tenantB.id, businessId: busB.id, lineUserId: 'U-reply-b', displayName: 'ลูกค้า ข',
      threadId: 'TH-REPLY-B', text: 'สอบถามครับ', externalMessageId: 'MR-2',
    })
  })

  it('records the reply as an OUTBOUND message on the conversation it answered', async () => {
    const result = await recordLineReply({
      tenantId: tenantA.id,
      receipt: { inboundMessageId: inboundA.messageId, text: 'ราคา 450 บาทครับ', source: 'STACK' },
      correlationId: 'corr-reply-0001',
    })

    expect(result.created).toBe(true)
    expect(result.conversationId).toBe(inboundA.conversationId)

    const message = await prisma.message.findUnique({ where: { id: result.messageId } })
    expect(message.direction).toBe('OUTBOUND')
    expect(message.body).toBe('ราคา 450 บาทครับ')
    expect(message.externalMessageId).toBe(replyExternalId(inboundA.messageId))
  })

  it('carries the correlation id and the provenance onto the audit row, and no message text', async () => {
    // SDD-048 — the audit table, not the log stream, is the durable join between a
    // webhook delivery and the rows it produced.
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'CONVERSATION', entityId: inboundA.conversationId, action: 'REPLY_DELIVERED' },
    })
    expect(events).toHaveLength(1)

    const payload = JSON.parse(events[0].payloadJson)
    expect(payload.correlationId).toBe('corr-reply-0001')
    expect(payload.inboundMessageId).toBe(inboundA.messageId)
    expect(payload.source).toBe('STACK')
    // The body is what was said; the audit payload is read by tooling with no business
    // seeing customer content (SEC-009).
    expect(events[0].payloadJson).not.toContain('450')
  })

  it('is idempotent: a redelivered receipt resolves to the same row', async () => {
    const before = await prisma.message.count({ where: { conversationId: inboundA.conversationId } })
    const again = await recordLineReply({
      tenantId: tenantA.id,
      // Different text on purpose — a retry must not be able to rewrite what was sent.
      receipt: { inboundMessageId: inboundA.messageId, text: 'ข้อความอื่น', source: 'STACK' },
    })
    expect(again.created).toBe(false)

    const after = await prisma.message.count({ where: { conversationId: inboundA.conversationId } })
    expect(after).toBe(before)

    const message = await prisma.message.findUnique({ where: { id: again.messageId } })
    expect(message.body).toBe('ราคา 450 บาทครับ')
  })

  it('cannot attach a reply to another tenant\'s conversation', async () => {
    // SEC-001 — not "checked and refused": the lookup is scoped, so the row is simply
    // not found and there is no branch in which it resolves first.
    await expect(
      recordLineReply({ tenantId: tenantA.id, receipt: { inboundMessageId: inboundB.messageId, text: 'ข้ามเทนแนนต์' } }),
    ).rejects.toMatchObject({ status: 404 })

    const leaked = await prisma.message.findMany({ where: { conversationId: inboundB.conversationId } })
    expect(leaked.every((message) => message.direction === 'INBOUND')).toBe(true)
  })

  it('refuses a receipt that answers an outbound message', async () => {
    const reply = await prisma.message.findFirst({
      where: { conversationId: inboundA.conversationId, direction: 'OUTBOUND' },
    })
    await expect(
      recordLineReply({ tenantId: tenantA.id, receipt: { inboundMessageId: reply.id, text: 'ตอบของตอบ' } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('records the transport fallback as what the customer received, marked as such', async () => {
    // The whole reason the receipt comes from the sender (BR-011): when the stack
    // cannot answer, the transport substitutes its own text, and recording what this
    // side produced would record a message nobody ever read.
    const second = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA.id, lineUserId: 'U-reply-a',
      threadId: 'TH-REPLY-A', text: 'ถามอีกรอบครับ', externalMessageId: 'MR-3',
    })
    const fallback = 'ซูริยังตอบจากข้อมูลธุรกิจไม่ได้ชั่วคราวค่ะ'
    const result = await recordLineReply({
      tenantId: tenantA.id,
      receipt: { inboundMessageId: second.messageId, text: fallback, source: 'TRANSPORT_FALLBACK' },
    })

    const message = await prisma.message.findUnique({ where: { id: result.messageId } })
    expect(message.body).toBe(fallback)

    const event = await prisma.auditEvent.findFirst({
      where: { entityType: 'CONVERSATION', entityId: second.conversationId, action: 'REPLY_DELIVERED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(JSON.parse(event.payloadJson).source).toBe('TRANSPORT_FALLBACK')
  })

  it('shows both sides of the conversation in the FR-091 thread, in order', async () => {
    const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [busA.id], ownedBusinessIds: [busA.id] })
    const thread = await getConversationThread({
      viewer, businessId: busA.id, conversationId: inboundA.conversationId,
    })

    expect(thread.messages.map((message) => [message.direction, message.body])).toEqual([
      ['INBOUND', 'ราคาเท่าไรครับ'],
      ['OUTBOUND', 'ราคา 450 บาทครับ'],
      ['INBOUND', 'ถามอีกรอบครับ'],
      ['OUTBOUND', 'ซูริยังตอบจากข้อมูลธุรกิจไม่ได้ชั่วคราวค่ะ'],
    ])
  })

  it('the route records a batch and reports each receipt independently', async () => {
    const third = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA.id, lineUserId: 'U-reply-a',
      threadId: 'TH-REPLY-A', text: 'อีกข้อความ', externalMessageId: 'MR-4',
    })

    const response = await post(handler(), {
      tenantId: tenantA.id,
      businessId: busA.id,
      deliveries: [
        { inboundMessageId: third.messageId, text: 'รับทราบครับ', source: 'STACK' },
        // A receipt naming a message that does not exist must not cost the one above.
        { inboundMessageId: 'does-not-exist', text: 'ไม่มีอยู่จริง', source: 'STACK' },
      ],
    }, { 'x-correlation-id': 'corr-reply-batch01' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.received).toBe(2)
    expect(body.recorded).toBe(1)
    expect(body.correlationId).toBe('corr-reply-batch01')
    expect(body.results[0]).toMatchObject({ ok: true, created: true, conversationId: third.conversationId })
    expect(body.results[1]).toMatchObject({ ok: false, stage: 'RECORD', error: 'INBOUND_MESSAGE_NOT_FOUND' })
  })

  it('refuses a batch with no scope at all rather than guessing one', async () => {
    const response = await post(handler(), {
      deliveries: [{ inboundMessageId: inboundA.messageId, text: 'ไม่มี scope' }],
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('TENANT_ID_REQUIRED')
  })

  it('refuses client-selected scope when a binding runtime is composed', async () => {
    // BR-012 — with a runtime present, Tenant/Business are server authority and a
    // caller naming its own is refused before anything is written (FR-052).
    const bound = createLineDeliveryPost({
      logger: quietLogger,
      runtimeFactory: async () => ({ bindingResolver: { resolve: async () => ({ tenantId: tenantA.id }) } }),
    })
    const response = await post(bound, {
      tenantId: tenantA.id,
      deliveries: [{ inboundMessageId: inboundA.messageId, text: 'x' }],
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('PHASE1_CLIENT_SCOPE_FORBIDDEN')
  })
})
