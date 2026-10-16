import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { handleAgentTurn, issueStepUp } from '@/modules/agent'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'

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

async function businessOwners(prefix, count) {
  const people = []
  for (let index = 0; index < count; index += 1) {
    const person = await prisma.person.create({ data: { code: `PSN-${prefix}-${index}`, displayName: `${prefix} ${index}` } })
    await prisma.membership.create({
      data: {
        personId: person.id,
        tenantId: tenant.id,
        businessId: business.id,
        scopeType: 'BUSINESS',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    })
    people.push(person)
  }
  return people
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

  it('uses the Phase 1 grounded business-answer ports when configured', async () => {
    const businessKnowledge = {
      query: async ({ businessId }) => ({
        queryId: 'product_detail', queryVersion: '1.0.0', businessId,
        sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
        records: [{
          knowledge_id: 'sg:sku:USB-001', business_id: businessId, knowledge_type: 'PRODUCT',
          product_code: 'USB-001', name: 'แฟลชไดรฟ์ไม้', category: 'USB', description: null,
          unit: 'ชิ้น', sell_price: 120, currency: 'THB', moq: 100, colors: ['ไม้'],
          specification: { capacity: '32GB' }, source_ref: 'catalog:usb',
          source_sha256: 'a'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
          approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
          sensitivity: 'PUBLIC', contract_version: '1.0.0',
        }],
      }),
    }
    const model = {
      provider: 'openai', model: 'test',
      generate: async () => ({ provider: 'openai', model: 'test', status: 'ok', text: 'ราคา 120 บาท ขั้นต่ำ 100 ชิ้น' }),
    }
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-p1',
      threadId: 'T-trn-p1', text: 'USB-001 ราคาเท่าไร', externalMessageId: 'MT-P1',
    }, { businessKnowledge, model })

    expect(r.response.kind).toBe('ANSWER')
    expect(r.response.text).toContain('120')
    expect(r.response.grounded).toBe(true)
    expect(r.response.evidenceCount).toBe(1)
    expect(r.response.sourceRefs).toEqual(['catalog:usb'])
  })

  it('does not call the provider again for a redelivered Phase 1 external message', async () => {
    const businessKnowledge = { query: async ({ businessId }) => ({
      queryId: 'product_detail', queryVersion: '1.0.0', businessId, sensitivity: 'PUBLIC',
      asOf: '2026-08-12T00:00:00.000Z', records: [],
    }) }
    let calls = 0
    const model = { provider: 'openai', model: 'test', generate: async () => { calls++; return { text: 'x' } } }
    const input = {
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-p1-retry',
      threadId: 'T-trn-p1-retry', text: 'USB-404 ราคาเท่าไร', externalMessageId: 'MT-P1-RETRY',
    }
    await handleAgentTurn(input, { businessKnowledge, model })
    const replay = await handleAgentTurn(input, { businessKnowledge, model })
    expect(calls).toBe(0)
    expect(replay.response).toMatchObject({ kind: 'DUPLICATE', skipReply: true })
  })

  it('returns a pending approval request, then executes only when the requester resubmits that request', async () => {
    await staffSubject('PSN-trn-staff1', 'Utrn-staff1')
    // a customer conversation to close
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-2', threadId: 'T-trn-2', text: 'hi' })
    const action = {
      name: 'close_conversation',
      target: { conversationId: cust.inbound.conversationId },
    }
    const pending = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff1', threadId: 'T-staff-1', text: 'close it',
      action,
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(pending.response).toMatchObject({ kind: 'ACTION_PENDING', action: 'close_conversation', tier: 'L1', quorum: 1 })
    expect(pending.response.approvalRequestId).toBeTruthy()
    expect(pending.action).toMatchObject({ executed: false, approvalRequired: true, approvalRequestId: pending.response.approvalRequestId })
    const [reviewer] = await businessOwners('trn-close-owner', 1)
    await decideAgentApprovalRequest(prisma, {
      requestId: pending.response.approvalRequestId,
      personId: reviewer.id,
      decision: 'APPROVE',
    })
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff1', threadId: 'T-staff-1', text: 'close it',
      action: { ...action, approvalRequestId: pending.response.approvalRequestId },
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(r.response).toMatchObject({ kind: 'ACTION_DONE', action: 'close_conversation', approvalRequestId: pending.response.approvalRequestId })
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

  it('keeps a HIGH action pending until its approval quorum, then requires step-up', async () => {
    await staffSubject('PSN-trn-staff2', 'Utrn-staff2', 'OWNER')
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-4', threadId: 'T-trn-4', text: 'hi' })
    const action = { name: 'deactivate_customer', target: { customerId: cust.inbound.customerId } }
    const pending = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff2', threadId: 'T-staff-2', text: 'deactivate',
      action,
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(pending.response).toMatchObject({ kind: 'ACTION_PENDING', action: 'deactivate_customer', tier: 'L4', quorum: 4 })
    const reviewers = await businessOwners('trn-deactivate-no-stepup', 4)
    for (const reviewer of reviewers) {
      await decideAgentApprovalRequest(prisma, {
        requestId: pending.response.approvalRequestId,
        personId: reviewer.id,
        decision: 'APPROVE',
      })
    }
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff2', threadId: 'T-staff-2', text: 'deactivate',
      action: { ...action, approvalRequestId: pending.response.approvalRequestId },
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(r.response).toMatchObject({ kind: 'STEP_UP_REQUIRED', approvalRequestId: pending.response.approvalRequestId })
    const c = await prisma.customer.findUnique({ where: { id: cust.inbound.customerId } })
    expect(c.deletedAt).toBeNull()
  })

  it('a HIGH action with a valid step-up token completes the turn (ACTION_DONE)', async () => {
    const staff = await staffSubject('PSN-trn-staff3', 'Utrn-staff3', 'OWNER')
    const cust = await handleAgentTurn({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-5', threadId: 'T-trn-5', text: 'hi' })
    const action = { name: 'deactivate_customer', target: { customerId: cust.inbound.customerId } }
    const pending = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff3', threadId: 'T-staff-3', text: 'deactivate',
      action,
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(pending.response).toMatchObject({ kind: 'ACTION_PENDING', action: 'deactivate_customer', tier: 'L4', quorum: 4 })
    const reviewers = await businessOwners('trn-deactivate-stepup', 4)
    for (const reviewer of reviewers) {
      await decideAgentApprovalRequest(prisma, {
        requestId: pending.response.approvalRequestId,
        personId: reviewer.id,
        decision: 'APPROVE',
      })
    }
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    const r = await handleAgentTurn({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Utrn-staff3', threadId: 'T-staff-3', text: 'deactivate',
      action: { ...action, approvalRequestId: pending.response.approvalRequestId, stepUpToken: token },
    }, { serverScope: { transportVerified: true, businessId: business.id } })
    expect(r.response).toMatchObject({ kind: 'ACTION_DONE', approvalRequestId: pending.response.approvalRequestId })
    const c = await prisma.customer.findUnique({ where: { id: cust.inbound.customerId } })
    expect(c.deletedAt).not.toBeNull()
  })
})
