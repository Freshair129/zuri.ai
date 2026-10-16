import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { revokeLineIdentity } from '@/modules/identity/gate'
import { executeAgentAction } from '@/modules/agent/action-gate'
import { createWriteToolRegistry, defaultWriteTools } from '@/modules/agent/write-tools'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'
import { consumeStepUp, issueStepUp } from '@/modules/agent/step-up'

let tenant, business

async function staffSubject(code, lineUserId, role = 'MANAGER') {
  const person = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, scopeType: 'TENANT', role } })
  const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
  await redeemLinkToken({ tenantId: tenant.id, token, lineUserId })
  return person
}

async function owners(prefix, count) {
  const result = []
  for (let index = 0; index < count; index += 1) {
    const person = await prisma.person.create({ data: { code: `PSN-${prefix}-${index}`, displayName: `${prefix} ${index}` } })
    await prisma.membership.create({
      data: {
        personId: person.id, tenantId: tenant.id, businessId: business.id,
        scopeType: 'BUSINESS', role: 'OWNER', status: 'ACTIVE',
      },
    })
    result.push(person)
  }
  return result
}

async function customer(lineUserId, threadId) {
  return ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId,
    threadId, text: 'approval gateway fixture',
  })
}

async function approveAll(requestId, reviewers) {
  for (const reviewer of reviewers) {
    await decideAgentApprovalRequest(prisma, { requestId, personId: reviewer.id, decision: 'APPROVE' })
  }
}

describe('Agent approval gateway (FR-026)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Approval Gateway Group', code: 'PF-AGW' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Approval Gateway Tenant', code: 'TNT-AGW' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Approval Gateway Business', code: 'BUS-AGW' })
  })

  it('uses explicit server action tiers and keeps the customer self-edit ungated', () => {
    const actions = Object.fromEntries(defaultWriteTools().list().map((action) => [action.name, action]))
    expect(actions.close_conversation.approvalTier).toBe('L1')
    expect(actions.set_customer_lifecycle.approvalTier).toBe('L2')
    expect(actions.deactivate_customer.approvalTier).toBe('L4')
    expect(actions.update_own_display_name.approvalTier).toBe('NONE')
    expect(actions.refund_order.available).toBe(false)
  })

  it('rejects unknown target fields before creating an approval or persisting audit data', async () => {
    await staffSubject('PSN-agw-target-strict-requester', 'U-agw-target-strict-requester')
    const target = await customer('U-agw-target-strict-customer', 'T-agw-target-strict')
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-target-strict-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId, injectedAuditField: 'must-not-persist' },
    })).rejects.toThrow(/AGENT_ACTION_TARGET_INVALID/)
    expect(await prisma.agentApprovalRequest.count({ where: { conversationId: target.conversationId } })).toBe(0)
    const audit = await prisma.auditEvent.findMany({ where: { tenantId: tenant.id } })
    expect(JSON.stringify(audit)).not.toContain('must-not-persist')
  })

  it('creates an L1 request without a write, then executes the canonical close writer after one owner vote', async () => {
    await staffSubject('PSN-agw-close-requester', 'U-agw-close-requester')
    const target = await customer('U-agw-close-customer', 'T-agw-close')
    const requestResult = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-close-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    expect(requestResult).toMatchObject({ executed: false, approvalRequired: true, tier: 'L1', quorum: 1 })
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')

    const [reviewer] = await owners('agw-close-owner', 1)
    const decision = await decideAgentApprovalRequest(prisma, {
      requestId: requestResult.approvalRequestId, personId: reviewer.id, decision: 'APPROVE',
    })
    expect(decision.request.status).toBe('APPROVED')
    const executed = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-close-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: requestResult.approvalRequestId,
    })
    expect(executed.executed).toBe(true)
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('CLOSED')
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: requestResult.approvalRequestId } })).status).toBe('EXECUTED')
  })

  it('requires two distinct L2 owners, rejects duplicate votes, and invalidates changed input', async () => {
    await staffSubject('PSN-agw-l2-requester', 'U-agw-l2-requester')
    const target = await customer('U-agw-l2-customer', 'T-agw-l2')
    const requestResult = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l2-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
    })
    expect(requestResult.quorum).toBe(2)
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).lifecycleStage).toBe('LEAD')
    const reviewers = await owners('agw-l2-owner', 2)
    await decideAgentApprovalRequest(prisma, { requestId: requestResult.approvalRequestId, personId: reviewers[0].id, decision: 'APPROVE' })
    await expect(decideAgentApprovalRequest(prisma, {
      requestId: requestResult.approvalRequestId, personId: reviewers[0].id, decision: 'APPROVE',
    })).rejects.toThrow()
    await decideAgentApprovalRequest(prisma, { requestId: requestResult.approvalRequestId, personId: reviewers[1].id, decision: 'APPROVE' })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l2-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'ACTIVE' },
      approvalRequestId: requestResult.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_BINDING_MISMATCH/)
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).lifecycleStage).toBe('LEAD')
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: requestResult.approvalRequestId } })).status).toBe('STALE')
  })

  it('returns the same ACTION_PENDING request for an exact under-quorum retry without writing', async () => {
    await staffSubject('PSN-agw-pending-requester', 'U-agw-pending-requester')
    const target = await customer('U-agw-pending-customer', 'T-agw-pending')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-pending-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
    })
    const reviewers = await owners('agw-pending-owner', 2)
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewers[0].id, decision: 'APPROVE',
    })

    const pending = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-pending-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
      approvalRequestId: created.approvalRequestId,
    })
    expect(pending).toMatchObject({
      executed: false, approvalRequired: true, approvalRequestId: created.approvalRequestId,
      status: 'PENDING', tier: 'L2', quorum: 2,
    })
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).lifecycleStage).toBe('LEAD')
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('PENDING')
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewers[1].id, decision: 'APPROVE',
    })
    const executed = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-pending-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
      approvalRequestId: created.approvalRequestId,
    })
    expect(executed).toMatchObject({ executed: true, approvalRequestId: created.approvalRequestId })
    const updatedCustomer = await prisma.customer.findUnique({ where: { id: target.customerId } })
    expect(updatedCustomer.lifecycleStage).toBe('CUSTOMER')
    expect(updatedCustomer.version).toBe(2)
  })

  it('rejects execution when the requester or an approving OWNER Person is disabled', async () => {
    const requester = await staffSubject('PSN-agw-disabled-requester', 'U-agw-disabled-requester')
    const target = await customer('U-agw-disabled-customer', 'T-agw-disabled')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-disabled-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    const [reviewer] = await owners('agw-disabled-owner', 1)
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewer.id, decision: 'APPROVE',
    })
    await prisma.person.update({ where: { id: reviewer.id }, data: { accessDisabledAt: new Date() } })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-disabled-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_QUORUM_INVALID/)
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('STALE')
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')

    const secondTarget = await customer('U-agw-disabled-requester-target', 'T-agw-disabled-requester')
    const second = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-disabled-requester', actionName: 'close_conversation',
      target: { conversationId: secondTarget.conversationId },
    })
    await prisma.person.update({ where: { id: requester.id }, data: { accessDisabledAt: new Date() } })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-disabled-requester', actionName: 'close_conversation',
      target: { conversationId: secondTarget.conversationId }, approvalRequestId: second.approvalRequestId,
    })).rejects.toThrow(/AGENT_ACTION_DENIED/)
    expect((await prisma.conversation.findUnique({ where: { id: secondTarget.conversationId } })).status).toBe('OPEN')
  })

  it('races rejection against the quorum-completing approval with a safe CAS outcome', async () => {
    await staffSubject('PSN-agw-race-requester', 'U-agw-race-requester')
    const target = await customer('U-agw-race-customer', 'T-agw-race')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-race-requester', actionName: 'set_customer_lifecycle',
      target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
    })
    const reviewers = await owners('agw-race-owner', 3)
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewers[0].id, decision: 'APPROVE',
    })
    await Promise.allSettled([
      decideAgentApprovalRequest(prisma, {
        requestId: created.approvalRequestId, personId: reviewers[1].id, decision: 'APPROVE',
      }),
      decideAgentApprovalRequest(prisma, {
        requestId: created.approvalRequestId, personId: reviewers[2].id, decision: 'REJECT',
      }),
    ])

    const request = await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })
    const decisions = await prisma.agentApprovalDecision.findMany({ where: { requestId: request.id } })
    expect(['PENDING', 'APPROVED', 'REJECTED']).toContain(request.status)
    if (request.status === 'REJECTED') expect(decisions.filter((row) => row.decision === 'REJECT')).toHaveLength(1)
    else expect(decisions.some((row) => row.decision === 'REJECT')).toBe(false)
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).lifecycleStage).toBe('LEAD')

    if (request.status === 'REJECTED') {
      await expect(executeAgentAction({
        tenantId: tenant.id, lineUserId: 'U-agw-race-requester', actionName: 'set_customer_lifecycle',
        target: { customerId: target.customerId }, payload: { lifecycleStage: 'CUSTOMER' },
        approvalRequestId: created.approvalRequestId,
      })).rejects.toThrow(/AGENT_APPROVAL_REJECTED/)
      expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).lifecycleStage).toBe('LEAD')
    }
  })

  it('rejects a requester vote and makes any owner rejection terminal', async () => {
    const requester = await staffSubject('PSN-agw-reject-requester', 'U-agw-reject-requester', 'OWNER')
    await prisma.membership.create({
      data: { personId: requester.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'OWNER' },
    })
    const target = await customer('U-agw-reject-customer', 'T-agw-reject')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-reject-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    await expect(decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: requester.id, decision: 'APPROVE',
    })).rejects.toThrow(/REQUESTER_CANNOT_VOTE/)
    const [reviewer] = await owners('agw-reject-owner', 1)
    const rejected = await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewer.id, decision: 'REJECT',
    })
    expect(rejected.request.status).toBe('REJECTED')
    await expect(decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewer.id, decision: 'APPROVE',
    })).rejects.toThrow(/REQUEST_NOT_OPEN/)
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')

    await prisma.agentApprovalRequest.update({
      where: { id: created.approvalRequestId }, data: { status: 'PENDING', version: { increment: 1 } },
    })
    const inconsistentRetry = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-reject-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    }).catch((error) => error)
    expect(inconsistentRetry.message).toMatch(/AGENT_APPROVAL_REJECTED/)
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('REJECTED')
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-reject-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_REJECTED/)
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')
  })

  it('runs the L3 quorum only through an isolated registry fixture', async () => {
    await staffSubject('PSN-agw-l3-requester', 'U-agw-l3-requester')
    const target = await customer('U-agw-l3-customer', 'T-agw-l3')
    const registry = createWriteToolRegistry()
    registry.register({
      name: 'isolated_l3_fixture', effect: 'WRITE', sensitivity: 'LOW', approvalTier: 'L3',
      targetKind: 'CUSTOMER', targetField: 'customerId', allowRoles: ['MANAGER'],
      async execute() { return { fixtureOnly: true } },
    })
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l3-requester', actionName: 'isolated_l3_fixture',
      target: { customerId: target.customerId }, payload: { fixture: 'isolated' },
    }, { registry })
    expect(created.quorum).toBe(3)
    const reviewers = await owners('agw-l3-owner', 3)
    await approveAll(created.approvalRequestId, reviewers)
    const result = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l3-requester', actionName: 'isolated_l3_fixture',
      target: { customerId: target.customerId }, payload: { fixture: 'isolated' },
      approvalRequestId: created.approvalRequestId,
    }, { registry })
    expect(result.result).toEqual({ fixtureOnly: true })
  })

  it('requires a HIGH step-up token to be issued strictly after its freshness boundary', async () => {
    const requester = await staffSubject('PSN-agw-stepup-boundary', 'U-agw-stepup-boundary')
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: requester.id })
    const issued = await prisma.identityLinkToken.findUnique({ where: { token } })

    await expect(prisma.$transaction((tx) => consumeStepUp(tx, {
      tenantId: tenant.id, personId: requester.id, token, notBefore: issued.createdAt,
    }))).rejects.toThrow(/STEP_UP_REQUIRED/)
    expect((await prisma.identityLinkToken.findUnique({ where: { token } })).consumedAt).toBeNull()
  })

  it('consumes a HIGH step-up token at most once when two transactions race', async () => {
    const requester = await staffSubject('PSN-agw-stepup-race', 'U-agw-stepup-race')
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: requester.id })

    const results = await Promise.allSettled([
      prisma.$transaction((tx) => consumeStepUp(tx, { tenantId: tenant.id, personId: requester.id, token })),
      prisma.$transaction((tx) => consumeStepUp(tx, { tenantId: tenant.id, personId: requester.id, token })),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await prisma.identityLinkToken.findUnique({ where: { token } })).consumedAt).not.toBeNull()
  })

  it('requires four L4 owners and fresh single-use HIGH step-up at execution', async () => {
    await staffSubject('PSN-agw-l4-requester', 'U-agw-l4-requester')
    const target = await customer('U-agw-l4-customer', 'T-agw-l4')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l4-requester', actionName: 'deactivate_customer',
      target: { customerId: target.customerId },
    })
    const reviewers = await owners('agw-l4-owner', 4)
    for (const reviewer of reviewers.slice(0, 3)) {
      await decideAgentApprovalRequest(prisma, {
        requestId: created.approvalRequestId, personId: reviewer.id, decision: 'APPROVE',
      })
    }
    const { token: staleStepUpToken } = await issueStepUp({
      tenantId: tenant.id, personId: (await prisma.externalIdentity.findFirst({
        where: { tenantId: tenant.id, providerSubject: 'U-agw-l4-requester' }, select: { personId: true },
      })).personId,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewers[3].id, decision: 'APPROVE',
    })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l4-requester', actionName: 'deactivate_customer',
      target: { customerId: target.customerId }, approvalRequestId: created.approvalRequestId,
    })).rejects.toThrow(/STEP_UP_REQUIRED/)
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l4-requester', actionName: 'deactivate_customer',
      target: { customerId: target.customerId }, approvalRequestId: created.approvalRequestId,
      stepUpToken: staleStepUpToken,
    })).rejects.toThrow(/STEP_UP_REQUIRED/)
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).deletedAt).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: (await prisma.externalIdentity.findFirst({
      where: { tenantId: tenant.id, providerSubject: 'U-agw-l4-requester' }, select: { personId: true },
    })).personId })
    const executed = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-l4-requester', actionName: 'deactivate_customer',
      target: { customerId: target.customerId }, approvalRequestId: created.approvalRequestId, stepUpToken: token,
    })
    expect(executed.steppedUp).toBe(true)
    expect((await prisma.customer.findUnique({ where: { id: target.customerId } })).deletedAt).not.toBeNull()
    expect((await prisma.identityLinkToken.findUnique({ where: { token } })).consumedAt).not.toBeNull()
  })

  it('binds execution to the exact LINE ExternalIdentity used to create the approval request', async () => {
    const lineUserId = 'U-agw-bound-identity-requester'
    const requester = await staffSubject('PSN-agw-bound-identity-requester', lineUserId)
    const { token: alternateLinkToken } = await issueLinkToken({ tenantId: tenant.id, personId: requester.id })
    await redeemLinkToken({ tenantId: tenant.id, token: alternateLinkToken, lineUserId: 'U-agw-bound-identity-alternate' })
    const originalIdentity = await prisma.externalIdentity.findUnique({
      where: { tenantId_provider_providerSubject: { tenantId: tenant.id, provider: 'LINE', providerSubject: lineUserId } },
    })
    const alternateIdentity = await prisma.externalIdentity.findUnique({
      where: { tenantId_provider_providerSubject: { tenantId: tenant.id, provider: 'LINE', providerSubject: 'U-agw-bound-identity-alternate' } },
    })
    expect(alternateIdentity.personId).toBe(requester.id)
    expect(alternateIdentity.revokedAt).toBeNull()

    const target = await customer('U-agw-bound-identity-customer', 'T-agw-bound-identity')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    const [reviewer] = await owners('agw-bound-identity-owner', 1)
    await decideAgentApprovalRequest(prisma, {
      requestId: created.approvalRequestId, personId: reviewer.id, decision: 'APPROVE',
    })

    await revokeLineIdentity(tenant.id, lineUserId)
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-bound-identity-alternate', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_BINDING_MISMATCH/)
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('STALE')
    expect((await prisma.externalIdentity.findUnique({ where: { id: originalIdentity.id } })).revokedAt).not.toBeNull()
    expect((await prisma.externalIdentity.findUnique({ where: { id: alternateIdentity.id } })).revokedAt).toBeNull()
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')
  })

  it('does not count revoked owners at execution and expires requests after the fixed 24-hour window', async () => {
    await staffSubject('PSN-agw-revoke-requester', 'U-agw-revoke-requester')
    const target = await customer('U-agw-revoke-customer', 'T-agw-revoke')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-revoke-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    const [reviewer] = await owners('agw-revoke-owner', 1)
    await decideAgentApprovalRequest(prisma, { requestId: created.approvalRequestId, personId: reviewer.id, decision: 'APPROVE' })
    await prisma.membership.updateMany({ where: { personId: reviewer.id, tenantId: tenant.id, businessId: business.id }, data: { status: 'REVOKED' } })
    await expect(executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-revoke-requester', actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    })).rejects.toThrow(/AGENT_APPROVAL_QUORUM_INVALID/)
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')

    const secondTarget = await customer('U-agw-expiry-customer', 'T-agw-expiry')
    const expiring = await executeAgentAction({
      tenantId: tenant.id, lineUserId: 'U-agw-revoke-requester', actionName: 'close_conversation',
      target: { conversationId: secondTarget.conversationId },
    })
    const [activeReviewer] = await owners('agw-expiry-owner', 1)
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000)
    const expired = await decideAgentApprovalRequest(prisma, {
      requestId: expiring.approvalRequestId, personId: activeReviewer.id, decision: 'APPROVE', now: expiredAt,
    })
    expect(expired.request.status).toBe('EXPIRED')
    expect((await prisma.conversation.findUnique({ where: { id: secondTarget.conversationId } })).status).toBe('OPEN')
  })
})
