import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import {
  executeAgentAction,
  authorizeAgentAction,
  createToolRegistry,
  createWriteToolRegistry,
  defaultWriteTools,
  issueStepUp,
} from '@/modules/agent'

// @req FR-026 — the Gate F write/action gate: RBAC + ownership + sensitivity authorization,
// single-use step-up for HIGH actions, audited transactional execute; read stays Gate E.

let tenant, business

// Bind a LINE subject to a fresh staff Person (Membership => STAFF).
async function staffSubject(code, lineUserId, role = 'MANAGER') {
  const person = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role } })
  const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
  await redeemLinkToken({ tenantId: tenant.id, token, lineUserId })
  return person
}

describe('agent write/action gate (FR-026)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Gate F Group', code: 'PF-GF' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Gate F Tenant', code: 'TNT-GF' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Gate F Business', code: 'BUS-GF' })
  })

  it('the read-only registry still refuses write tools; the write registry refuses read tools', () => {
    expect(() => createToolRegistry().register({ name: 'refund', readOnly: false })).toThrow(/Gate E forbids/)
    expect(() => createWriteToolRegistry().register({ name: 'peek', effect: 'READ' })).toThrow(/not a WRITE action/)
  })

  it('authorizeAgentAction: UNKNOWN principal is denied a write', () => {
    const d = authorizeAgentAction({ principal: { principalType: 'UNKNOWN', roles: [], isStaff: false }, action: { sensitivity: 'LOW', allowRoles: ['OWNER'] } })
    expect(d.allowed).toBe(false)
  })

  it('a staff principal may run a LOW write (close_conversation) — executed + audited', async () => {
    await staffSubject('PSN-gf-staff1', 'Ugf-staff1')
    // a customer with a conversation to close
    const cust = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust1', threadId: 'T-gf-1', text: 'hi' })
    const r = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-staff1',
      actionName: 'close_conversation', target: { conversationId: cust.conversationId },
    })
    expect(r.executed).toBe(true)
    const convo = await prisma.conversation.findUnique({ where: { id: cust.conversationId } })
    expect(convo.status).toBe('CLOSED')
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'AGENT_ACTION', action: 'EXECUTED', entityId: 'close_conversation' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  it('a bare customer principal is DENIED a staff write (and the denial is audited)', async () => {
    const cust = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust2', threadId: 'T-gf-2', text: 'hi' })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-cust2',
      actionName: 'set_customer_lifecycle', target: { customerId: cust.customerId }, payload: { lifecycleStage: 'ACTIVE' },
    })).rejects.toThrow(/AGENT_ACTION_DENIED/)
    const denial = await prisma.auditEvent.findFirst({
      where: { entityType: 'AGENT_ACTION', action: 'DENIED', entityId: 'set_customer_lifecycle' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(denial).not.toBeNull()
  })

  it('a customer may edit their OWN record via ownership authorization', async () => {
    const cust = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust3', displayName: 'ก่อน', threadId: 'T-gf-3', text: 'hi' })
    const r = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-cust3',
      actionName: 'update_own_display_name', target: { customerId: cust.customerId }, payload: { displayName: 'หลัง' },
    })
    expect(r.executed).toBe(true)
    const c = await prisma.customer.findUnique({ where: { id: cust.customerId } })
    expect(c.displayName).toBe('หลัง')
  })

  it('a HIGH action without a step-up token is refused', async () => {
    await staffSubject('PSN-gf-staff2', 'Ugf-staff2')
    const cust = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust4', threadId: 'T-gf-4', text: 'hi' })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-staff2',
      actionName: 'deactivate_customer', target: { customerId: cust.customerId },
    })).rejects.toThrow(/STEP_UP_REQUIRED/)
    // the customer is untouched (transaction rolled back)
    const c = await prisma.customer.findUnique({ where: { id: cust.customerId } })
    expect(c.deletedAt).toBeNull()
  })

  it('a HIGH action with a valid step-up token executes, and the token is single-use', async () => {
    const staff = await staffSubject('PSN-gf-staff3', 'Ugf-staff3', 'OWNER')
    const cust = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust5', threadId: 'T-gf-5', text: 'hi' })
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    const r = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-staff3',
      actionName: 'deactivate_customer', target: { customerId: cust.customerId }, stepUpToken: token,
    })
    expect(r.executed).toBe(true)
    expect(r.steppedUp).toBe(true)
    const c = await prisma.customer.findUnique({ where: { id: cust.customerId } })
    expect(c.deletedAt).not.toBeNull()
    // reusing the same step-up token is refused
    const cust2 = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugf-cust6', threadId: 'T-gf-6', text: 'hi' })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-staff3',
      actionName: 'deactivate_customer', target: { customerId: cust2.customerId }, stepUpToken: token,
    })).rejects.toThrow(/STEP_UP_REQUIRED/)
  })

  it('proves the gate over an absent domain: refund_order passes authz+step-up then hits no executor', async () => {
    const staff = await staffSubject('PSN-gf-staff4', 'Ugf-staff4', 'OWNER')
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'Ugf-staff4',
      actionName: 'refund_order', target: { orderId: 'X' }, stepUpToken: token,
    })).rejects.toThrow(/NOT_IMPLEMENTED/)
  })
})
