import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'

// @req FR-023 — the LINE gateway: message → identity → customer → conversation → message,
// tenant-scoped, idempotent, all resolving through the one identity seam (FR-021).

let tenant, business

describe('ingestLineMessage (FR-023)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'CRM Group', code: 'PF-CRM' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'CRM Tenant', code: 'TNT-CRM' })
    business = await createBusiness({ tenantId: tenant.id, name: 'CRM Business', code: 'BUS-CRM' })
  })

  it('first message creates person + customer + conversation + message', async () => {
    const r = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Ucrm1', displayName: 'มานะ', threadId: 'T-1', text: 'สวัสดีครับ', externalMessageId: 'M-1',
    })
    expect(r.created).toEqual({ customer: true, conversation: true, message: true })
    expect(r.personId && r.customerId && r.conversationId && r.messageId).toBeTruthy()
    const msg = await prisma.message.findUnique({ where: { id: r.messageId } })
    expect(msg.body).toBe('สวัสดีครับ')
    expect(msg.direction).toBe('INBOUND')
  })

  it('second message from the same user reuses customer + conversation, appends only the message', async () => {
    const r = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Ucrm1', threadId: 'T-1', text: 'สนใจสินค้าครับ', externalMessageId: 'M-2',
    })
    expect(r.created).toEqual({ customer: false, conversation: false, message: true })
    const count = await prisma.message.count({ where: { conversationId: r.conversationId } })
    expect(count).toBe(2)
  })

  it('resolves through the identity seam: the customer is linked to the same Person', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, lineUserId: 'Ucrm1', threadId: 'T-1', text: 'x' })
    const customer = await prisma.customer.findUnique({ where: { id: r.customerId } })
    const identities = await prisma.externalIdentity.findMany({ where: { personId: customer.personId, provider: 'LINE', providerSubject: 'Ucrm1' } })
    expect(identities).toHaveLength(1)
  })

  it('is idempotent on externalMessageId — a redelivered webhook does not double-store', async () => {
    const before = await prisma.message.count()
    const r = await ingestLineMessage({ tenantId: tenant.id, lineUserId: 'Ucrm1', threadId: 'T-1', text: 'สนใจสินค้าครับ', externalMessageId: 'M-2' })
    expect(r.created.message).toBe(false)
    const after = await prisma.message.count()
    expect(after).toBe(before)
  })

  it('is tenant-scoped: the same LINE user in another tenant is a different customer', async () => {
    const pf2 = await createPortfolio({ name: 'CRM Group 2', code: 'PF-CRM2' })
    const t2 = await createTenant({ portfolioId: pf2.id, name: 'CRM Tenant 2', code: 'TNT-CRM2' })
    // Distinct from the identity test's 'Ushared' — test.db is shared across files.
    const a = await ingestLineMessage({ tenantId: tenant.id, lineUserId: 'Ucrm-shared', threadId: 'T-A', text: 'hi' })
    const b = await ingestLineMessage({ tenantId: t2.id, lineUserId: 'Ucrm-shared', threadId: 'T-B', text: 'hi' })
    expect(b.customerId).not.toBe(a.customerId)
    expect(b.personId).not.toBe(a.personId)
  })
})
