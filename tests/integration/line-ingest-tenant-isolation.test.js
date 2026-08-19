import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'

// @req FR-023 — the LINE gateway resolves conversation and message inside one tenant.
// @spec BR-001, SEC-001 — Tenant is the isolation boundary. Scope is not a filter applied
//   afterwards: a row belonging to another tenant must be refused, not reused.
// @spec BR-002 — an external id is envelope data, never a key. `Conversation.externalThreadId`
//   and `Message.externalMessageId` carry a GLOBAL `@unique` in prisma/schema.prisma, so the
//   external namespace is not tenant-partitioned at the database level. This suite pins the
//   application-level guard that keeps one tenant's thread id from reaching another's
//   conversation while that composite-key change remains outstanding.

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

  it('refuses to append into another tenant conversation that already holds the thread id', async () => {
    const owned = await ingestLineMessage({
      tenantId: tenantB.id, businessId: businessB.id,
      lineUserId: 'Uiso-owner', threadId: SHARED_THREAD,
      text: 'ข้อความของ tenant B', externalMessageId: 'M-ISO-B-1',
    })
    expect(owned.conversationId).toBeTruthy()

    // Tenant A presents the SAME external thread id. It must not be able to write
    // into, or learn the id of, tenant B's conversation.
    await expect(ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-intruder', threadId: SHARED_THREAD,
      text: 'ข้อความแทรกจาก tenant A', externalMessageId: 'M-ISO-A-1',
    })).rejects.toThrow(/LINE_INGEST_TENANT_MISMATCH/)

    // tenant B's conversation still holds exactly its own one message
    const messages = await prisma.message.findMany({ where: { conversationId: owned.conversationId } })
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe('ข้อความของ tenant B')

    // and nothing was written for the intruder
    expect(await prisma.message.findUnique({ where: { externalMessageId: 'M-ISO-A-1' } })).toBeNull()
  })

  it('refuses a redelivery short-circuit that would return another tenant conversation', async () => {
    await ingestLineMessage({
      tenantId: tenantB.id, businessId: businessB.id,
      lineUserId: 'Uiso-owner-2', threadId: 'U-thread-B-2',
      text: 'อีกข้อความของ tenant B', externalMessageId: SHARED_MESSAGE_ID,
    })

    // The same provider message id arriving under tenant A must not resolve to
    // tenant B's conversation through the idempotency short-circuit.
    await expect(ingestLineMessage({
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-intruder-2', threadId: 'U-thread-A-2',
      text: 'ข้อความแทรก', externalMessageId: SHARED_MESSAGE_ID,
    })).rejects.toThrow(/LINE_INGEST_TENANT_MISMATCH/)
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

  it('still short-circuits a genuine redelivery inside the owning tenant', async () => {
    const input = {
      tenantId: tenantA.id, businessId: businessA.id,
      lineUserId: 'Uiso-replay', threadId: 'U-thread-replay',
      text: 'ส่งซ้ำ', externalMessageId: 'M-ISO-REPLAY',
    }
    const first = await ingestLineMessage(input)
    const replay = await ingestLineMessage(input)
    expect(replay.messageId).toBe(first.messageId)
    expect(replay.created.message).toBe(false)
  })
})
