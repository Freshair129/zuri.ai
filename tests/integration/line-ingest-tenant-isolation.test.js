import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'

// @req FR-023 — the LINE gateway resolves conversation and message inside one tenant.
// @spec BR-001, SEC-001 — Tenant is the isolation boundary.
// @spec BR-002 — an external id is envelope data, never a key.
//
// `Conversation` is keyed by (tenantId, channel, externalThreadId) and `Message` by
// (conversationId, externalMessageId). Before that, both carried a GLOBAL @unique: one
// tenant presenting another's thread id appended into that tenant's conversation, and
// one presenting another's message id got that tenant's conversationId, customerId and
// messageId back through the idempotency short-circuit.
//
// The fix is structural, so the assertions here are about OUTCOME, not about an error
// message: two tenants using the same provider id is legitimate and must simply
// produce two independent conversations. There is no application-level scope check
// left to test, because the key cannot return another tenant's row in the first place.

let tenantA, businessA, tenantB, businessB

const SHARED_THREAD = 'U-collision-thread'
const SHARED_MESSAGE_ID = 'M-collision-1'

describe('ingestLineMessage — cross-tenant thread and message collisions (SEC-001)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Isolation Group', code: 'PF-LINE-ISO' })
    tenantA = await createTenant({ portfolioId: pf.id, name: 'Tenant A', code: 'TNT-LINE-ISO-A' })
    businessA = await createBusiness({ tenantId: tenantA.id, name: 'Business A', code: 'BUS-LINE-ISO-A' })
    tenantB = await createTenant({ portfolioId: pf.id, name: 'Tenant B', code: 'TNT-LINE-ISO-B' })
    businessB = await createBusiness({ tenantId: tenantB.id, name: 'Business B', code: 'BUS-LINE-ISO-B' })
  })

  it('gives each tenant its own conversation for the same external thread id', async () => {
    const owned = await ingestLineMessage({
      tenantId: tenantB.id, businessId: businessB.id,
      lineUserId: 'Uiso-owner', threadId: SHARED_THREAD,
      text: 'ข้อความของ tenant B', externalMessageId: 'M-ISO-B-1',
    })

    const other = await ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-intruder', threadId: SHARED_THREAD,
      text: 'ข้อความของ tenant A', externalMessageId: 'M-ISO-A-1',
    })

    // two tenants, two conversations — never the same row
    expect(other.conversationId).not.toBe(owned.conversationId)
    expect(other.created.conversation).toBe(true)

    const [convA, convB] = await Promise.all([
      prisma.conversation.findUnique({ where: { id: other.conversationId } }),
      prisma.conversation.findUnique({ where: { id: owned.conversationId } }),
    ])
    expect(convA.tenantId).toBe(tenantA.id)
    expect(convB.tenantId).toBe(tenantB.id)

    // and tenant B's conversation still holds exactly its own one message
    const messagesB = await prisma.message.findMany({ where: { conversationId: owned.conversationId } })
    expect(messagesB).toHaveLength(1)
    expect(messagesB[0].body).toBe('ข้อความของ tenant B')
  })

  it('does not let another tenant message id short-circuit into our conversation', async () => {
    const ownedB = await ingestLineMessage({
      tenantId: tenantB.id, businessId: businessB.id,
      lineUserId: 'Uiso-owner-2', threadId: 'U-thread-B-2',
      text: 'อีกข้อความของ tenant B', externalMessageId: SHARED_MESSAGE_ID,
    })

    const inA = await ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-intruder-2', threadId: 'U-thread-A-2',
      text: 'ข้อความของ tenant A', externalMessageId: SHARED_MESSAGE_ID,
    })

    // the same provider message id under two tenants is two real messages —
    // tenant A must not receive tenant B's ids back
    expect(inA.created.message).toBe(true)
    expect(inA.messageId).not.toBe(ownedB.messageId)
    expect(inA.conversationId).not.toBe(ownedB.conversationId)
    expect(inA.customerId).not.toBe(ownedB.customerId)

    const stored = await prisma.message.findUnique({ where: { id: inA.messageId } })
    expect(stored.conversationId).toBe(inA.conversationId)
    expect(stored.body).toBe('ข้อความของ tenant A')
  })

  it('keeps a thread id in one channel from colliding with another channel', async () => {
    const line = await ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-channel', threadId: 'U-thread-shared-channel',
      text: 'ทาง LINE', externalMessageId: 'M-ISO-CH-1',
    })
    const conversation = await prisma.conversation.findUnique({ where: { id: line.conversationId } })
    expect(conversation.channel).toBe('LINE')

    // the same tenant may hold the same external thread id on a different channel
    const web = await prisma.conversation.create({
      data: {
        tenantId: tenantA.id, businessId: businessA.id, customerId: conversation.customerId,
        channel: 'WEB', externalThreadId: 'U-thread-shared-channel',
      },
    })
    expect(web.id).not.toBe(conversation.id)
  })

  it('still allows the same tenant to continue its own thread', async () => {
    const first = await ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-same', threadId: 'U-thread-same',
      text: 'ครั้งที่หนึ่ง', externalMessageId: 'M-ISO-SAME-1',
    })
    const second = await ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-same', threadId: 'U-thread-same',
      text: 'ครั้งที่สอง', externalMessageId: 'M-ISO-SAME-2',
    })
    expect(second.conversationId).toBe(first.conversationId)
    expect(second.created.conversation).toBe(false)
  })

  it('still short-circuits a genuine redelivery inside the owning conversation', async () => {
    const input = {
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-replay', threadId: 'U-thread-replay',
      text: 'ส่งซ้ำ', externalMessageId: 'M-ISO-REPLAY',
    }
    const first = await ingestLineMessage(input)
    const replay = await ingestLineMessage(input)
    expect(replay.messageId).toBe(first.messageId)
    expect(replay.created.message).toBe(false)
    expect(await prisma.message.count({ where: { conversationId: first.conversationId } })).toBe(1)
  })

  it('lets unkeyed messages coexist in one conversation (NULL never conflicts)', async () => {
    const base = {
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-nokey', threadId: 'U-thread-nokey', text: 'ไม่มี id',
    }
    const first = await ingestLineMessage(base)
    const second = await ingestLineMessage(base)
    expect(second.messageId).not.toBe(first.messageId)
    expect(await prisma.message.count({ where: { conversationId: first.conversationId } })).toBe(2)
  })
})
