import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import {
  getConversationInbox,
  getConversationThread,
} from '@/modules/crm/conversation-read-model'

// @req FR-091 — the reader surface over the LINE ingress, proved against rows the real
// ingest seam wrote rather than against hand-inserted fixtures: if `ingestLineMessage`
// changes shape, this suite fails, which is the point of reading through it.
// @spec SDD-049, BR-001, SEC-001

// One tenant with two businesses (the BR-001 sharing case) and a second tenant that
// must stay invisible. Codes are prefixed so they cannot collide with the other suites
// sharing test.db.
let tenantA, busA1, busA2, tenantB, busB1
let sharedConversationId, ownedConversationId, foreignConversationId

const ownerOf = (...businessIds) => makeViewer({ role: 'OWNER', visibleBusinessIds: businessIds, ownedBusinessIds: businessIds })

describe('CRM conversation inbox (FR-091)', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Inbox Group A', code: 'PF-INBOX-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Inbox Tenant A', code: 'TNT-INBOX-A' })
    busA1 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านหน้าบ้าน', code: 'BUS-INBOX-A1' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ครัวกลาง', code: 'BUS-INBOX-A2' })

    const pfB = await createPortfolio({ name: 'Inbox Group B', code: 'PF-INBOX-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Inbox Tenant B', code: 'TNT-INBOX-B' })
    busB1 = await createBusiness({ tenantId: tenantB.id, name: 'คู่แข่ง', code: 'BUS-INBOX-B1' })

    // Tenant-shared: what an unbound LINE binding actually writes.
    const shared = await ingestLineMessage({
      tenantId: tenantA.id, lineUserId: 'U-inbox-shared', displayName: 'สมชาย',
      threadId: 'TH-INBOX-SHARED', text: 'สวัสดีครับ ร้านเปิดกี่โมง', externalMessageId: 'MI-1',
    })
    await ingestLineMessage({
      tenantId: tenantA.id, lineUserId: 'U-inbox-shared',
      threadId: 'TH-INBOX-SHARED', text: 'ขอบคุณครับ', externalMessageId: 'MI-2',
    })
    sharedConversationId = shared.conversationId

    // Owned by the second Business of the SAME tenant.
    const owned = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA2.id, lineUserId: 'U-inbox-a2', displayName: 'มาลี',
      threadId: 'TH-INBOX-A2', text: 'สั่งของได้ไหมคะ', externalMessageId: 'MI-3',
    })
    ownedConversationId = owned.conversationId

    // Another tenant entirely.
    const foreign = await ingestLineMessage({
      tenantId: tenantB.id, businessId: busB1.id, lineUserId: 'U-inbox-b1', displayName: 'ต่างเทนแนนต์',
      threadId: 'TH-INBOX-B1', text: 'ความลับของอีกเทนแนนต์', externalMessageId: 'MI-4',
    })
    foreignConversationId = foreign.conversationId
  })

  it('lists the tenant of the open Business, not that Business alone (BR-001)', async () => {
    const result = await getConversationInbox({ viewer: ownerOf(busA1.id, busA2.id), businessId: busA1.id })
    const ids = result.conversations.map((row) => row.id)

    // The tenant-shared conversation belongs to no Business at all. A Business-scoped
    // query would have dropped it — and it is the common case, not the exception.
    expect(ids).toContain(sharedConversationId)
    expect(ids).toContain(ownedConversationId)
    expect(ids).not.toContain(foreignConversationId)
    expect(result.scope.tenantId).toBe(tenantA.id)
  })

  it('never returns another tenant, even for a viewer who owns businesses in both', async () => {
    const result = await getConversationInbox({
      viewer: ownerOf(busA1.id, busA2.id, busB1.id),
      businessId: busA1.id,
    })
    const ids = result.conversations.map((row) => row.id)
    expect(ids).not.toContain(foreignConversationId)

    const bodies = JSON.stringify(result)
    expect(bodies).not.toContain('ความลับของอีกเทนแนนต์')
  })

  it('excludes a same-tenant conversation owned by a Business the viewer cannot see', async () => {
    // Tenant-sharing is a CRM rule, not a licence to hand someone a Business they
    // could not open. `busA2` is invisible here, so its conversation is too — while
    // the tenant-shared one, which no Business owns, remains readable.
    const result = await getConversationInbox({ viewer: ownerOf(busA1.id), businessId: busA1.id })
    const ids = result.conversations.map((row) => row.id)
    expect(ids).toContain(sharedConversationId)
    expect(ids).not.toContain(ownedConversationId)
  })

  it('labels a conversation no Business owns rather than leaving it blank', async () => {
    const result = await getConversationInbox({ viewer: ownerOf(busA1.id, busA2.id), businessId: busA1.id })
    const shared = result.conversations.find((row) => row.id === sharedConversationId)
    const owned = result.conversations.find((row) => row.id === ownedConversationId)
    expect(shared.businessId).toBeNull()
    expect(shared.businessName).toBeNull()
    expect(owned.businessName).toBe('ครัวกลาง')
  })

  it('carries the message count and the last message per row', async () => {
    const result = await getConversationInbox({ viewer: ownerOf(busA1.id, busA2.id), businessId: busA1.id })
    const shared = result.conversations.find((row) => row.id === sharedConversationId)
    expect(shared.messageCount).toBe(2)
    expect(shared.lastMessage.preview).toBe('ขอบคุณครับ')
    expect(shared.lastMessage.direction).toBe('INBOUND')
  })

  it('counts only the conversations it returned, so the band reconciles with the list', async () => {
    const result = await getConversationInbox({ viewer: ownerOf(busA1.id), businessId: busA1.id })
    expect(result.counts.conversations).toBe(result.conversations.length)
    expect(result.counts.messages).toBe(
      result.conversations.reduce((total, row) => total + row.messageCount, 0),
    )
    expect(result.counts.customers).toBe(new Set(result.conversations.map((row) => row.customer.id)).size)
  })

  it('refuses a Business the viewer cannot see, before reading anything', async () => {
    await expect(
      getConversationInbox({ viewer: ownerOf(busA1.id), businessId: busB1.id }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('returns one thread oldest-first', async () => {
    const thread = await getConversationThread({
      viewer: ownerOf(busA1.id), businessId: busA1.id, conversationId: sharedConversationId,
    })
    expect(thread.messages.map((message) => message.body)).toEqual([
      'สวัสดีครับ ร้านเปิดกี่โมง',
      'ขอบคุณครับ',
    ])
    expect(thread.conversation.customer.displayName).toBe('สมชาย')
  })

  it("answers another tenant's conversation id as absent, not as forbidden", async () => {
    // 403 would confirm the row exists. Disclosure by status code is still disclosure.
    await expect(
      getConversationThread({ viewer: ownerOf(busA1.id), businessId: busA1.id, conversationId: foreignConversationId }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('reads without writing: no audit event and no row count changes', async () => {
    const before = {
      messages: await prisma.message.count(),
      conversations: await prisma.conversation.count(),
      audit: await prisma.auditEvent.count(),
    }
    await getConversationInbox({ viewer: ownerOf(busA1.id, busA2.id), businessId: busA1.id })
    await getConversationThread({
      viewer: ownerOf(busA1.id), businessId: busA1.id, conversationId: sharedConversationId,
    })
    expect({
      messages: await prisma.message.count(),
      conversations: await prisma.conversation.count(),
      audit: await prisma.auditEvent.count(),
    }).toEqual(before)
  })
})
