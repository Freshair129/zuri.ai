import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { handleAgentTurn, issueStepUp } from '@/modules/agent'

// @req FR-027 — the end-to-end agent turn: ingest → read context → optional Gate F
// action → response, with denials/step-up degrading gracefully.

let tenant, business

async function staffSubject(code, lineUserId, role = 'MANAGER') {
  const person = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role } })
  const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
  await redeemLinkToken({ tenantId: tenant.id, token, lineUserId })
  return person
}

describe('handleAgentTurn (FR-027)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Turn Group', code: 'PF-TURN' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Turn Tenant', code: 'TNT-TURN' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Turn Business', code: 'BUS-TURN' })
  })

  it('a customer message turn ingests, types the principal, and answers from the KG', async () => {
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-1',
      threadId: 'T-trn-1', text: 'สนใจคอร์สทำอาหาร', externalMessageId: 'MT-1',
    })
    expect(r.inbound.messageId).toBeTruthy()
    expect(r.identity.principalType).toBe('CUSTOMER')
    expect(r.response.kind).toBe('ANSWER')
    expect(r.response.grounded).toBe(true)
    expect(r.response.relationCount).toBeGreaterThan(0)
  })

  it('a redelivered inbound is idempotent but the turn still returns context', async () => {
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-1',
      threadId: 'T-trn-1', text: 'สนใจคอร์สทำอาหาร', externalMessageId: 'MT-1',
    })
    expect(r.inbound.created.message).toBe(false)
    expect(r.identity.principalType).toBe('CUSTOMER')
  })

  it('a staff turn requesting a LOW action executes it (ACTION_DONE)', async () => {
    await staffSubject('PSN-trn-staff1', 'Utrn-staff1')
    // a customer conversation to close
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-2', threadId: 'T-trn-2', text: 'hi' })
    const r = await handleAgentTurn({
      tenantId: tenant.id, lineUserId: 'Utrn-staff1', threadId: 'T-staff-1', text: 'close it',
      action: { name: 'close_conversation', target: { conversationId: cust.inbound.conversationId } },
    })
    expect(r.response.kind).toBe('ACTION_DONE')
    const convo = await prisma.conversation.findUnique({ where: { id: cust.inbound.conversationId } })
    expect(convo.status).toBe('CLOSED')
  })

  it('a customer requesting a staff action degrades gracefully to ACTION_DENIED (no crash)', async () => {
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-3', threadId: 'T-trn-3', text: 'hi' })
    const r = await handleAgentTurn({
      tenantId: tenant.id, lineUserId: 'Utrn-3', threadId: 'T-trn-3', text: 'set me active',
      action: { name: 'set_customer_lifecycle', target: { customerId: cust.inbound.customerId }, payload: { lifecycleStage: 'ACTIVE' } },
    })
    expect(r.response.kind).toBe('ACTION_DENIED')
    expect(r.action).toBeNull()
  })

  it('a HIGH action without step-up degrades to STEP_UP_REQUIRED', async () => {
    await staffSubject('PSN-trn-staff2', 'Utrn-staff2', 'OWNER')
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-4', threadId: 'T-trn-4', text: 'hi' })
    const r = await handleAgentTurn({
      tenantId: tenant.id, lineUserId: 'Utrn-staff2', threadId: 'T-staff-2', text: 'deactivate',
      action: { name: 'deactivate_customer', target: { customerId: cust.inbound.customerId } },
    })
    expect(r.response.kind).toBe('STEP_UP_REQUIRED')
    const c = await prisma.customer.findUnique({ where: { id: cust.inbound.customerId } })
    expect(c.deletedAt).toBeNull()
  })

  it('a HIGH action with a valid step-up token completes the turn (ACTION_DONE)', async () => {
    const staff = await staffSubject('PSN-trn-staff3', 'Utrn-staff3', 'OWNER')
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-5', threadId: 'T-trn-5', text: 'hi' })
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    const r = await handleAgentTurn({
      tenantId: tenant.id, lineUserId: 'Utrn-staff3', threadId: 'T-staff-3', text: 'deactivate',
      action: { name: 'deactivate_customer', target: { customerId: cust.inbound.customerId }, stepUpToken: token },
    })
    expect(r.response.kind).toBe('ACTION_DONE')
    const c = await prisma.customer.findUnique({ where: { id: cust.inbound.customerId } })
    expect(c.deletedAt).not.toBeNull()
  })
})
