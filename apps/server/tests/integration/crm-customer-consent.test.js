import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { recordCustomerConsent } from '@/modules/crm/customer-consent-service'
import { executeAgentAction } from '@/modules/agent/action-gate'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { getConversationThread } from '@/modules/crm/conversation-read-model'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'

// @req FR-103 — SEC-005 consent attestation, proved against a Customer the real
// FR-023 ingest seam wrote, not a hand-inserted fixture.
// @spec SDD-053, BR-001, SEC-005, SDD-048
//
// `consentRecordedByPersonId` is a real foreign key to Person (schema.prisma), so
// every attesting viewer here needs a Person row that actually exists — the
// factory's default `principal: { id: 'per-1', ... }` does not, and the FK
// violation is exactly the signal that a service must not do what
// sot-decision-service.js does (`viewer?.personId`, a field resolveViewer never
// returns): store an id nothing points at.
let tenantA, busA1, busA2, tenantB, busB1
let customerA1, customerB1

async function ownerOf(...businessIds) {
  const person = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-CONSENT-${randomUUID().slice(0, 8)}`, displayName: 'Owner' },
  })
  return makeViewer({
    role: 'OWNER', visibleBusinessIds: businessIds, ownedBusinessIds: businessIds,
    // @req FR-061 — an OWNER Membership derives every domain from its role, per
    // Membership (SDD-034), which is what resolveViewer emits for this shape. Stated
    // because consent now asks for the `customer` grant before it asks about ownership,
    // and the factory's default domain list predates that domain existing.
    visibleDomains: [...VIEWER_DOMAINS],
    principal: { id: person.id, code: person.code, displayName: person.displayName },
  })
}

describe('Customer PDPA consent attestation (FR-103)', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Consent Group A', code: 'PF-CONSENT-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Consent Tenant A', code: 'TNT-CONSENT-A' })
    busA1 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านต้นทาง', code: 'BUS-CONSENT-A1' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านพี่น้อง', code: 'BUS-CONSENT-A2' })

    const pfB = await createPortfolio({ name: 'Consent Group B', code: 'PF-CONSENT-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Consent Tenant B', code: 'TNT-CONSENT-B' })
    busB1 = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่นเทนแนนต์', code: 'BUS-CONSENT-B1' })

    const a1 = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-consent-a1', displayName: 'ลูกค้า เอ',
      threadId: 'TH-CONSENT-A1', text: 'สนใจสินค้าครับ', externalMessageId: 'MC-1',
    })
    customerA1 = a1.customerId

    const b1 = await ingestLineMessage({
      tenantId: tenantB.id, businessId: busB1.id, lineUserId: 'U-consent-b1', displayName: 'ลูกค้า บี',
      threadId: 'TH-CONSENT-B1', text: 'สอบถามครับ', externalMessageId: 'MC-2',
    })
    customerB1 = b1.customerId
  })

  it('every new Customer the ingest seam writes defaults to PENDING', async () => {
    const row = await prisma.customer.findUnique({ where: { id: customerA1 } })
    expect(row.consentStatus).toBe('PENDING')
    expect(row.consentRecordedAt).toBeNull()
    expect(row.consentRecordedByPersonId).toBeNull()
  })

  it('a Business owner attests GRANTED — status, timestamp, attester and audit event all land', async () => {
    const viewer = await ownerOf(busA1.id)
    const requester = await prisma.person.create({ data: { code: `PSN-CONSENT-GATE-${randomUUID()}`, displayName: 'Consent gate requester' } })
    await prisma.membership.create({ data: {
      personId: requester.id, tenantId: tenantA.id, businessId: busA1.id, scopeType: 'BUSINESS', role: 'MANAGER',
    } })
    const link = await issueLinkToken({ tenantId: tenantA.id, personId: requester.id })
    const lineUserId = `U-consent-gate-${randomUUID()}`
    await redeemLinkToken({ tenantId: tenantA.id, token: link.token, lineUserId })
    const before = await prisma.customer.findUnique({ where: { id: customerA1 } })
    const pending = await executeAgentAction({
      tenantId: tenantA.id, lineUserId, actionName: 'set_customer_lifecycle',
      target: { customerId: customerA1 }, payload: { lifecycleStage: 'ACTIVE' },
    })
    const result = await recordCustomerConsent(
      customerA1,
      { businessId: busA1.id, status: 'GRANTED', note: 'ลูกค้ายืนยันทางโทรศัพท์' },
      { viewer },
    )

    expect(result.consentStatus).toBe('GRANTED')
    expect(result.consentRecordedByPersonId).toBe(viewer.principal.id)

    const row = await prisma.customer.findUnique({ where: { id: customerA1 } })
    expect(row.consentStatus).toBe('GRANTED')
    expect(row.version).toBe(before.version + 1)
    expect(row.consentRecordedAt).not.toBeNull()
    expect(row.consentNote).toBe('ลูกค้ายืนยันทางโทรศัพท์')

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'CUSTOMER', entityId: customerA1, action: 'CUSTOMER_CONSENT_GRANTED' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].actorId).toBe(viewer.principal.id)
    // No message content, no raw contact detail — just what a PDPA request needs.
    expect(JSON.parse(events[0].payloadJson)).toMatchObject({
      businessId: busA1.id, tenantId: tenantA.id, previousStatus: 'PENDING', status: 'GRANTED',
    })
    await expect(executeAgentAction({
      tenantId: tenantA.id, lineUserId, actionName: 'set_customer_lifecycle',
      target: { customerId: customerA1 }, payload: { lifecycleStage: 'ACTIVE' },
      approvalRequestId: pending.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_BINDING_MISMATCH/)
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: pending.approvalRequestId } })).status).toBe('STALE')
  })

  it('the FR-091 thread reads the updated status straight through, no second endpoint', async () => {
    const thread = await getConversationThread({
      viewer: await ownerOf(busA1.id), businessId: busA1.id,
      conversationId: (await prisma.conversation.findFirst({ where: { customerId: customerA1 } })).id,
    })
    expect(thread.conversation.customer.consentStatus).toBe('GRANTED')
  })

  it('a Member of the Business is refused — recording consent needs OWNER authority', async () => {
    // Granted the CRM domain and nothing more: without that grant this viewer would be
    // refused one gate earlier (FR-061), and the case would stop testing OWNER authority.
    const viewer = makeViewer({
      visibleBusinessIds: [busA1.id], ownedBusinessIds: [], visibleDomains: [...VIEWER_DOMAINS],
    })
    await expect(
      recordCustomerConsent(customerA1, { businessId: busA1.id, status: 'DECLINED' }, { viewer }),
    ).rejects.toMatchObject({ status: 403 })
    const row = await prisma.customer.findUnique({ where: { id: customerA1 } })
    expect(row.consentStatus).toBe('GRANTED') // unchanged by the refused attempt
  })

  it('an owner of a sibling Business in the same tenant may still attest (BR-001 CRM sharing)', async () => {
    // busA2 never talked to this customer directly — the Customer row is the
    // tenant's shared CRM record, exactly as getConversationInbox already reads it.
    const result = await recordCustomerConsent(
      customerA1,
      { businessId: busA2.id, status: 'DECLINED' },
      { viewer: await ownerOf(busA2.id) },
    )
    expect(result.consentStatus).toBe('DECLINED')
  })

  it('declines and erases the current principal when identity linking commits before the consent transaction', async () => {
    const lineUserId = `U-consent-relink-${randomUUID()}`
    const ingest = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId,
      threadId: lineUserId, text: 'Private memory before consent withdrawal',
      externalMessageId: `M-consent-relink-${randomUUID()}`,
    })
    const canonical = await prisma.person.create({
      data: { code: `PER-CONSENT-RELINK-${randomUUID()}`, displayName: 'Canonical customer' },
    })
    const token = await issueLinkToken({ tenantId: tenantA.id, personId: canonical.id })
    let linked = false
    const db = {
      business: prisma.business,
      customer: prisma.customer,
      $transaction: async (callback, options) => {
        if (!linked) {
          linked = true
          await redeemLinkToken({ tenantId: tenantA.id, token: token.token, lineUserId, merge: true })
        }
        return prisma.$transaction(callback, options)
      },
    }

    const result = await recordCustomerConsent(ingest.customerId,
      { businessId: busA1.id, status: 'DECLINED' }, { viewer: await ownerOf(busA1.id), db })
    expect(result.consentStatus).toBe('DECLINED')
    expect((await prisma.customer.findUnique({ where: { id: ingest.customerId } })).personId).toBe(canonical.id)
    const messages = await prisma.message.findMany({ where: { conversation: { customerId: ingest.customerId } } })
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe(CUSTOMER_ERASURE_TOMBSTONE)
  })

  it('rolls back the consent and memory changes when the identity/version claim becomes stale', async () => {
    const lineUserId = `U-consent-conflict-${randomUUID()}`
    const ingest = await ingestLineMessage({
      tenantId: tenantA.id, businessId: busA1.id, lineUserId, threadId: lineUserId,
      text: 'Preserve memory when the consent transaction aborts',
    })
    const before = await prisma.customer.findUnique({ where: { id: ingest.customerId } })
    const canonical = await prisma.person.create({
      data: { code: `PER-CONSENT-CONFLICT-${randomUUID()}`, displayName: 'Conflicting customer' },
    })
    const db = {
      business: prisma.business,
      customer: prisma.customer,
      $transaction: (callback, options) => prisma.$transaction(async tx => {
        const customer = new Proxy(tx.customer, {
          get(target, key) {
            if (key !== 'update') return target[key]
            return async args => {
              // A real row/version change after the authoritative read proves
              // the guarded write refuses stale identity and rolls back all work.
              await target.update({ where: { id: ingest.customerId },
                data: { personId: canonical.id, version: { increment: 1 } } })
              return target.update(args)
            }
          },
        })
        return callback(new Proxy(tx, { get: (target, key) => key === 'customer' ? customer : target[key] }))
      }, options),
    }
    await expect(recordCustomerConsent(ingest.customerId,
      { businessId: busA1.id, status: 'DECLINED' }, { viewer: await ownerOf(busA1.id), db }))
      .rejects.toMatchObject({ code: 'P2025' })
    expect(await prisma.customer.findUnique({ where: { id: ingest.customerId } })).toEqual(before)
    expect((await prisma.message.findFirst({ where: { conversation: { customerId: ingest.customerId } } })).body)
      .toBe('Preserve memory when the consent transaction aborts')
    expect(await prisma.auditEvent.count({ where: { entityType: 'CUSTOMER', entityId: ingest.customerId, action: 'CUSTOMER_CONSENT_DECLINED' } })).toBe(0)
  })

  it('an owner of a Business in a different tenant cannot reach this Customer at all', async () => {
    await expect(
      recordCustomerConsent(customerA1, { businessId: busB1.id, status: 'GRANTED' }, { viewer: await ownerOf(busB1.id) }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('owning a Business elsewhere does not carry authority into this tenant either', async () => {
    // The attacker shape from the authorization RCAs: OWNER of Business B1, merely
    // visible into A1 — proves ownership is checked against the *named* businessId,
    // not against "owns something, somewhere".
    const viewer = ownsElsewhere({ owns: busB1.id, sees: busA1.id, visibleDomains: [...VIEWER_DOMAINS] })
    await expect(
      recordCustomerConsent(customerA1, { businessId: busA1.id, status: 'GRANTED' }, { viewer }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('cannot reach another tenant\'s Customer by naming an owned Business in this one', async () => {
    await expect(
      recordCustomerConsent(customerB1, { businessId: busA1.id, status: 'GRANTED' }, { viewer: await ownerOf(busA1.id) }),
    ).rejects.toMatchObject({ status: 404 })
    const row = await prisma.customer.findUnique({ where: { id: customerB1 } })
    expect(row.consentStatus).toBe('PENDING')
  })
})
