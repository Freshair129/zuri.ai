import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { eraseCustomerPrincipal } from '@/modules/identity/erase-customer-principal'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'
import { RAW_RECORD_ERASURE_REASON } from '@/platform/integrations/core/raw-record-redaction'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

// @req FR-022 — PDPA erasure end to end: from an owner-triggered request on the CRM
//   surface down to the message bodies and the raw provider payloads.
// @req FR-103 — the authority model this reuses.
// @spec SEC-001, SEC-003, SEC-005, BR-001
//
// The gap this file closes had two halves that only look separable. `erasePrincipal`
// was correct and unreachable (no route, no UI, no script), and even when reached by
// hand it left `Message.body` and every `RawExternalRecord` payload fully readable —
// so an erased person's actual words survived, merely detached from their name. The
// tests below assert both halves against rows the real ingest seam wrote.

const token = () => randomUUID().slice(0, 8).toUpperCase()

let tenantA, busA1, busA2, tenantB, busB1
let connectionA

async function ownerOf(...businessIds) {
  const person = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-ERASE-${token()}`, displayName: 'Owner' },
  })
  // FR-061 — the erasure path now runs the `customer` domain gate before the
  // ownership gate, so the fixture states the grant explicitly (the factory's
  // default list predates `customer` being a real domain).
  return makeViewer({
    role: 'OWNER', visibleBusinessIds: businessIds, ownedBusinessIds: businessIds,
    visibleDomains: [...VIEWER_DOMAINS],
    principal: { id: person.id, code: person.code, displayName: person.displayName },
  })
}

/** One raw LINE event as FR-081 would have stored it, keyed by the message id. */
async function rawRecordFor({ tenantId, connectionId, externalId, text, lineUserId }) {
  return prisma.rawExternalRecord.create({
    data: {
      tenantId,
      connectionId,
      provider: 'LINE_OA',
      lane: 'CUSTOMER',
      entityType: 'MESSAGE_EVENT',
      externalId,
      sourceType: 'WEBHOOK',
      schemaVersion: '1.0.0',
      payloadJson: JSON.stringify({ event: { message: { text }, source: { userId: lineUserId } } }),
      payloadHash: `hash-${externalId}`,
      idempotencyKey: `idem-${externalId}-${token()}`,
      receivedAt: new Date(),
    },
  })
}

async function seedCustomer({ tenant, business, lineUserId, threadId, externalMessageId, text }) {
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId, displayName: 'ลูกค้าทดสอบ',
    threadId, text, externalMessageId,
  })
  return result
}

describe('PDPA erasure from the CRM surface (FR-022)', () => {
  beforeAll(async () => {
    const t = token()
    const pfA = await createPortfolio({ name: `Erase Group A ${t}`, code: `PF-ERASE-A-${t}` })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Erase Tenant A', code: `TNT-ERASE-A-${t}` })
    busA1 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านต้นทาง', code: `BUS-ERASE-A1-${t}` })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านพี่น้อง', code: `BUS-ERASE-A2-${t}` })

    const pfB = await createPortfolio({ name: `Erase Group B ${t}`, code: `PF-ERASE-B-${t}` })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Erase Tenant B', code: `TNT-ERASE-B-${t}` })
    busB1 = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่นเทนแนนต์', code: `BUS-ERASE-B1-${t}` })

    const provider = await prisma.integrationProvider.create({
      data: { code: `LINE_OA_ERASE_${t}`, name: 'LINE OA (erase suite)', status: 'ACTIVE' },
    })
    connectionA = await prisma.integrationConnection.create({
      data: {
        tenantId: tenantA.id,
        businessId: busA1.id,
        providerId: provider.id,
        name: 'LINE OA primary',
        authorizationType: 'API_KEY',
        status: 'ACTIVE',
      },
    })
  })

  it('an owner erases the person behind a Customer, and every layer goes at once', async () => {
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-1',
      threadId: 'TH-ERASE-1', externalMessageId: 'MSG-ERASE-1', text: 'ขอสอบถามราคาครับ',
    })
    const conversation = await prisma.conversation.findFirst({ where: { customerId: r.customerId } })
    await prisma.conversationAnalysis.create({
      data: {
        conversationId: conversation.id,
        analyzedDate: new Date(),
        contactType: 'INQUIRY',
        state: 'OPEN',
        tags: JSON.stringify(['ราคา']),
        summary: 'ลูกค้าถามราคา',
      },
    })
    // Two raw records: the message event (keyed by the LINE message id) and a profile
    // record keyed by the provider subject itself. Both are this person's.
    await rawRecordFor({
      tenantId: tenantA.id, connectionId: connectionA.id, externalId: 'MSG-ERASE-1',
      text: 'ขอสอบถามราคาครับ', lineUserId: 'U-erase-1',
    })
    await rawRecordFor({
      tenantId: tenantA.id, connectionId: connectionA.id, externalId: 'U-erase-1',
      text: null, lineUserId: 'U-erase-1',
    })
    // A bystander's raw record in the same tenant and connection — it must survive.
    await rawRecordFor({
      tenantId: tenantA.id, connectionId: connectionA.id, externalId: 'MSG-BYSTANDER-1',
      text: 'ของคนอื่น', lineUserId: 'U-bystander-1',
    })

    const result = await eraseCustomerPrincipal(
      r.customerId,
      { businessId: busA1.id, confirmation: 'ERASE' },
      { viewer: await ownerOf(busA1.id) },
    )

    expect(result.customerId).toBe(r.customerId)
    expect(result.counts).toMatchObject({
      erasedCustomers: 1,
      erasedAnalyses: 1,
      redactedMessages: 1,
      tombstonedRawRecords: 2,
      revokedIdentities: 1,
    })
    // The receipt is counts only. A caller who has just erased a person must not be
    // handed their name back in the response.
    expect(JSON.stringify(result)).not.toContain('ลูกค้าทดสอบ')
    expect(JSON.stringify(result)).not.toContain('U-erase-1')

    // 1. The message text itself is gone, but the message still exists.
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id } })
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
    expect(messages[0].createdAt).toBeInstanceOf(Date)
    expect(messages[0].direction).toBe('INBOUND')

    // 2. The raw evidence carries a tombstone rather than a gap — envelope intact.
    const mine = await prisma.rawExternalRecord.findMany({
      where: { tenantId: tenantA.id, externalId: { in: ['MSG-ERASE-1', 'U-erase-1'] } },
    })
    expect(mine).toHaveLength(2)
    for (const row of mine) {
      expect(JSON.parse(row.payloadJson)).toMatchObject({ redacted: true, reason: RAW_RECORD_ERASURE_REASON })
      expect(JSON.parse(row.payloadJson).erasedAt).toMatch(/^\d{4}-/)
      expect(row.payloadJson).not.toContain('ขอสอบถามราคา')
      // Envelope metadata replay tooling needs is untouched.
      expect(row.payloadHash).toBe(`hash-${row.externalId}`)
      expect(row.connectionId).toBe(connectionA.id)
      expect(row.receivedAt).toBeInstanceOf(Date)
    }

    // 3. Someone else's evidence in the same tenant is not collateral.
    const bystander = await prisma.rawExternalRecord.findFirst({
      where: { tenantId: tenantA.id, externalId: 'MSG-BYSTANDER-1' },
    })
    expect(bystander.payloadJson).toContain('ของคนอื่น')

    // 4. Derived analysis is deleted outright — it is recomputable, so there is
    //    nothing to keep a tombstone for.
    expect(await prisma.conversationAnalysis.count({ where: { conversationId: conversation.id } })).toBe(0)

    // 5. The Customer is redacted and soft-deleted; the identity refuses to resolve.
    const customer = await prisma.customer.findUnique({ where: { id: r.customerId } })
    expect(customer.deletedAt).not.toBeNull()
    expect(customer.displayName).toBe('[erased]')
    await expect(resolveLineIdentity({ tenantId: tenantA.id, lineUserId: 'U-erase-1' })).rejects.toThrow(/revoked/)

    // 6. One audit event, counts only — no message text, no display name, no subject.
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'PRINCIPAL', entityId: r.personId, action: 'ERASED' },
    })
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].payloadJson)).toMatchObject({
      tenantId: tenantA.id, redactedMessages: 1, tombstonedRawRecords: 2, erasedCustomers: 1,
    })
    expect(events[0].payloadJson).not.toContain('ขอสอบถามราคา')
    expect(events[0].payloadJson).not.toContain('U-erase-1')
  })

  it('a second erasure is idempotent — nothing is re-erased and no timestamp moves', async () => {
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-2',
      threadId: 'TH-ERASE-2', externalMessageId: 'MSG-ERASE-2', text: 'สั่งของครับ',
    })
    await rawRecordFor({
      tenantId: tenantA.id, connectionId: connectionA.id, externalId: 'MSG-ERASE-2',
      text: 'สั่งของครับ', lineUserId: 'U-erase-2',
    })

    const viewer = await ownerOf(busA1.id)
    const first = await eraseCustomerPrincipal(r.customerId, { businessId: busA1.id, confirmation: 'ERASE' }, { viewer })
    expect(first.counts).toMatchObject({ redactedMessages: 1, tombstonedRawRecords: 1, erasedCustomers: 1 })

    const afterFirst = await prisma.rawExternalRecord.findFirst({ where: { externalId: 'MSG-ERASE-2' } })

    const second = await eraseCustomerPrincipal(r.customerId, { businessId: busA1.id, confirmation: 'ERASE' }, { viewer })
    // Everything is already gone, so the second run reports zero rather than
    // "succeeding" a second time — and, crucially, does not stamp a new erasedAt over
    // the record of when the person's data actually went.
    expect(second.counts).toMatchObject({
      redactedMessages: 0, tombstonedRawRecords: 0, erasedCustomers: 0, erasedAnalyses: 0, revokedIdentities: 0,
    })
    const afterSecond = await prisma.rawExternalRecord.findFirst({ where: { externalId: 'MSG-ERASE-2' } })
    expect(afterSecond.payloadJson).toBe(afterFirst.payloadJson)
  })

  it('a Member who can see the Business is refused as not-found, and nothing is erased', async () => {
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-3',
      threadId: 'TH-ERASE-3', externalMessageId: 'MSG-ERASE-3', text: 'ขอบคุณครับ',
    })
    // Holds the CRM domain, so the refusal below is the ownership gate, not FR-061's.
    const member = makeViewer({ visibleBusinessIds: [busA1.id], ownedBusinessIds: [], visibleDomains: [...VIEWER_DOMAINS] })
    await expect(
      eraseCustomerPrincipal(r.customerId, { businessId: busA1.id, confirmation: 'ERASE' }, { viewer: member }),
    ).rejects.toMatchObject({ status: 404 })

    const customer = await prisma.customer.findUnique({ where: { id: r.customerId } })
    expect(customer.deletedAt).toBeNull()
    expect(customer.displayName).toBe('ลูกค้าทดสอบ')
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MSG-ERASE-3' } })
    expect(message.body).toBe('ขอบคุณครับ')
  })

  it('owning a Business elsewhere carries no authority into this tenant', async () => {
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-4',
      threadId: 'TH-ERASE-4', externalMessageId: 'MSG-ERASE-4', text: 'สวัสดีครับ',
    })
    const viewer = ownsElsewhere({ owns: busB1.id, sees: busA1.id, visibleDomains: [...VIEWER_DOMAINS] })
    await expect(
      eraseCustomerPrincipal(r.customerId, { businessId: busA1.id, confirmation: 'ERASE' }, { viewer }),
    ).rejects.toMatchObject({ status: 404 })
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MSG-ERASE-4' } })
    expect(message.body).toBe('สวัสดีครับ')
  })

  it('cannot reach another tenant\'s Customer by naming an owned Business in this one', async () => {
    const other = await seedCustomer({
      tenant: tenantB, business: busB1, lineUserId: 'U-erase-b1',
      threadId: 'TH-ERASE-B1', externalMessageId: 'MSG-ERASE-B1', text: 'อีกเทนแนนต์',
    })
    await expect(
      eraseCustomerPrincipal(other.customerId, { businessId: busA1.id, confirmation: 'ERASE' }, {
        viewer: await ownerOf(busA1.id),
      }),
    ).rejects.toMatchObject({ status: 404 })
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MSG-ERASE-B1' } })
    expect(message.body).toBe('อีกเทนแนนต์')
  })

  it('an owner of a sibling Business in the same tenant may erase (BR-001 CRM sharing)', async () => {
    // busA2 never talked to this customer. The Customer row is the tenant's shared CRM
    // record, and PDPA obligations follow the record, not the conversation.
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-5',
      threadId: 'TH-ERASE-5', externalMessageId: 'MSG-ERASE-5', text: 'ฝากลบข้อมูลด้วยครับ',
    })
    const result = await eraseCustomerPrincipal(
      r.customerId, { businessId: busA2.id, confirmation: 'ERASE' }, { viewer: await ownerOf(busA2.id) },
    )
    expect(result.counts.erasedCustomers).toBe(1)
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MSG-ERASE-5' } })
    expect(message.body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
  })

  it('the wrong confirmation word is a 400 and erases nothing', async () => {
    const r = await seedCustomer({
      tenant: tenantA, business: busA1, lineUserId: 'U-erase-6',
      threadId: 'TH-ERASE-6', externalMessageId: 'MSG-ERASE-6', text: 'ยังไม่ลบนะครับ',
    })
    await expect(
      eraseCustomerPrincipal(r.customerId, { businessId: busA1.id, confirmation: 'ลบเลย' }, {
        viewer: await ownerOf(busA1.id),
      }),
    ).rejects.toMatchObject({ status: 400 })
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MSG-ERASE-6' } })
    expect(message.body).toBe('ยังไม่ลบนะครับ')
    const customer = await prisma.customer.findUnique({ where: { id: r.customerId } })
    expect(customer.deletedAt).toBeNull()
  })

  it('a fabricated Customer id answers exactly as an unowned one does', async () => {
    // The two refusals must be one answer: otherwise the endpoint is an oracle for
    // "does a Customer with this id exist in some other tenant?" (FR-072).
    await expect(
      eraseCustomerPrincipal(randomUUID(), { businessId: busA1.id, confirmation: 'ERASE' }, {
        viewer: await ownerOf(busA1.id),
      }),
    ).rejects.toMatchObject({ status: 404, message: 'CUSTOMER_NOT_FOUND' })
  })
})
