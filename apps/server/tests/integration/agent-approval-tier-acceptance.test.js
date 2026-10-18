import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { executeAgentAction } from '@/modules/agent/action-gate'
import { createWriteToolRegistry } from '@/modules/agent/write-tools'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'
import { issueStepUp } from '@/modules/agent/step-up'

let tenant, business

async function staffSubject(code, lineUserId) {
  const person = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({
    data: { personId: person.id, tenantId: tenant.id, scopeType: 'TENANT', role: 'MANAGER' },
  })
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
    threadId, text: 'approval tier acceptance fixture',
  })
}

async function approve(requestId, reviewers) {
  for (const reviewer of reviewers) {
    await decideAgentApprovalRequest(prisma, { requestId, personId: reviewer.id, decision: 'APPROVE' })
  }
}

async function actionExecutionAudits(actionName, approvalRequestId) {
  const rows = await prisma.auditEvent.findMany({
    where: {
      tenantId: tenant.id, businessId: business.id,
      entityType: 'AGENT_ACTION', entityId: actionName, action: 'EXECUTED',
    },
    select: { payloadJson: true },
  })
  return rows.filter(({ payloadJson }) => JSON.parse(payloadJson).approvalRequestId === approvalRequestId)
}

describe('Agent approval tier acceptance gaps (TASK-ZAI-010)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'TASK-ZAI-010 Tier Acceptance Group', code: 'PF-T010-TIER-AC' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'TASK-ZAI-010 Tier Acceptance Tenant', code: 'TNT-T010-TIER-AC' })
    business = await createBusiness({ tenantId: tenant.id, name: 'TASK-ZAI-010 Tier Acceptance Business', code: 'BUS-T010-TIER-AC' })
  })

  it('keeps an L1 action pending with zero approvals and no execution audit', async () => {
    const lineUserId = 'U-t010-tier-l1-requester'
    await staffSubject('PSN-T010-tier-l1-requester', lineUserId)
    const target = await customer('U-t010-tier-l1-customer', 'T-t010-tier-l1')
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'close_conversation',
      target: { conversationId: target.conversationId },
    })
    const auditsBefore = await actionExecutionAudits('close_conversation', created.approvalRequestId)

    const pending = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'close_conversation',
      target: { conversationId: target.conversationId }, approvalRequestId: created.approvalRequestId,
    })

    expect(pending).toMatchObject({
      executed: false, approvalRequired: true, approvalRequestId: created.approvalRequestId,
      status: 'PENDING', tier: 'L1', quorum: 1,
    })
    expect((await prisma.conversation.findUnique({ where: { id: target.conversationId } })).status).toBe('OPEN')
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('PENDING')
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: created.approvalRequestId } })).toBe(0)
    expect(await actionExecutionAudits('close_conversation', created.approvalRequestId)).toEqual(auditsBefore)
  })

  it('keeps an isolated L3 action pending with two of three distinct owners', async () => {
    const lineUserId = 'U-t010-tier-l3-requester'
    await staffSubject('PSN-T010-tier-l3-requester', lineUserId)
    const target = await customer('U-t010-tier-l3-customer', 'T-t010-tier-l3')
    const registry = createWriteToolRegistry()
    let executions = 0
    registry.register({
      name: 'task010_l3_acceptance_fixture', effect: 'WRITE', sensitivity: 'LOW', approvalTier: 'L3',
      targetKind: 'CUSTOMER', targetField: 'customerId', allowRoles: ['MANAGER'],
      async execute() { executions += 1; return { fixtureOnly: true } },
    })
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'task010_l3_acceptance_fixture',
      target: { customerId: target.customerId }, payload: { fixtureOnly: true },
    }, { registry })
    const reviewers = await owners('T010-tier-l3-owner', 2)
    await approve(created.approvalRequestId, reviewers)
    const beforeTarget = await prisma.customer.findUnique({ where: { id: target.customerId } })
    const auditsBefore = await actionExecutionAudits('task010_l3_acceptance_fixture', created.approvalRequestId)

    const pending = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'task010_l3_acceptance_fixture',
      target: { customerId: target.customerId }, payload: { fixtureOnly: true },
      approvalRequestId: created.approvalRequestId,
    }, { registry })

    expect(pending).toMatchObject({
      executed: false, approvalRequired: true, approvalRequestId: created.approvalRequestId,
      status: 'PENDING', tier: 'L3', quorum: 3,
    })
    expect(executions).toBe(0)
    expect(await prisma.customer.findUnique({ where: { id: target.customerId } })).toMatchObject({
      deletedAt: beforeTarget.deletedAt, lifecycleStage: beforeTarget.lifecycleStage, version: beforeTarget.version,
    })
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('PENDING')
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: created.approvalRequestId } })).toBe(2)
    expect(await actionExecutionAudits('task010_l3_acceptance_fixture', created.approvalRequestId)).toEqual(auditsBefore)
  })

  it.each([0, 1, 2, 3])('refuses L4 execution with %i of four approvals and preserves target, request, audit, and step-up', async (approvedCount) => {
    const lineUserId = `U-t010-tier-l4-requester-${approvedCount}`
    const requester = await staffSubject(`PSN-T010-tier-l4-requester-${approvedCount}`, lineUserId)
    const target = await customer(`U-t010-tier-l4-customer-${approvedCount}`, `T-t010-tier-l4-${approvedCount}`)
    const created = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'deactivate_customer',
      target: { customerId: target.customerId },
    })
    const reviewers = await owners(`T010-tier-l4-owner-${approvedCount}`, approvedCount)
    await approve(created.approvalRequestId, reviewers)
    const beforeTarget = await prisma.customer.findUnique({ where: { id: target.customerId } })
    const auditsBefore = await actionExecutionAudits('deactivate_customer', created.approvalRequestId)
    const { token } = await issueStepUp({ tenantId: tenant.id, personId: requester.id })

    const pending = await executeAgentAction({
      tenantId: tenant.id, lineUserId, actionName: 'deactivate_customer',
      target: { customerId: target.customerId }, approvalRequestId: created.approvalRequestId, stepUpToken: token,
    })

    expect(pending).toMatchObject({
      executed: false, approvalRequired: true, approvalRequestId: created.approvalRequestId,
      status: 'PENDING', tier: 'L4', quorum: 4,
    })
    expect(await prisma.customer.findUnique({ where: { id: target.customerId } })).toMatchObject({
      deletedAt: beforeTarget.deletedAt, lifecycleStage: beforeTarget.lifecycleStage, version: beforeTarget.version,
    })
    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: created.approvalRequestId } })).status).toBe('PENDING')
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: created.approvalRequestId } })).toBe(approvedCount)
    expect(await actionExecutionAudits('deactivate_customer', created.approvalRequestId)).toEqual(auditsBefore)
    expect((await prisma.identityLinkToken.findUnique({ where: { token } })).consumedAt).toBeNull()
  })
})
