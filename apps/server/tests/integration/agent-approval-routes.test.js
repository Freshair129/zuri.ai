import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { defaultWriteTools } from '@/modules/agent/write-tools'
import { createAgentApprovalRequest } from '@/modules/agent/approval-gateway'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

const { GET: getQueue } = await import('@/app/api/agent/approval-requests/route')
const { POST: postDecision } = await import('@/app/api/agent/approval-requests/[id]/decision/route')

let tenant, business, owner, requestRow

function requestWithViewer(url, viewer, init = {}) {
  const request = new Request(url, init)
  if (viewer) request.__viewer = viewer
  return request
}

describe('Agent approval API (FR-026)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Approval API Group', code: 'PF-AGAPI' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Approval API Tenant', code: 'TNT-AGAPI' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Approval API Business', code: 'BUS-AGAPI' })
    owner = await prisma.person.create({ data: { code: 'PSN-AGAPI-OWNER', displayName: 'API Owner' } })
    await prisma.membership.create({
      data: { personId: owner.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'OWNER' },
    })
    const requester = await prisma.person.create({ data: { code: 'PSN-AGAPI-REQUESTER', displayName: 'Requester' } })
    await prisma.membership.create({
      data: { personId: requester.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MANAGER' },
    })
    const customer = await prisma.customer.create({
      data: { code: 'CUS-AGAPI-1', tenantId: tenant.id, businessId: business.id, personId: requester.id, displayName: 'Customer' },
    })
    const action = defaultWriteTools().get('set_customer_lifecycle')
    requestRow = await prisma.$transaction((tx) => createAgentApprovalRequest(tx, {
      tenantId: tenant.id, requesterPersonId: requester.id, action,
      target: { customerId: customer.id }, payload: { lifecycleStage: 'CUSTOMER' },
    }))
  })

  it('requires an authenticated viewer before returning an owner approval queue', async () => {
    const unauthenticated = await getQueue(requestWithViewer(`http://local/api/agent/approval-requests?businessId=${business.id}`))
    expect(unauthenticated.status).toBe(401)
    const response = await getQueue(requestWithViewer(
      `http://local/api/agent/approval-requests?businessId=${business.id}`,
      { principal: { id: owner.id } },
    ))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0]).toMatchObject({
      id: requestRow.id, actionName: 'set_customer_lifecycle', tier: 2, quorum: 2,
      inputSummary: { lifecycleStage: 'CUSTOMER' }, approvedCount: 0,
    })
    expect(body.requests[0]).not.toHaveProperty('inputDigest')
  })

  it('derives the voter from the authenticated viewer and records one decision', async () => {
    const response = await postDecision(requestWithViewer(
      `http://local/api/agent/approval-requests/${requestRow.id}/decision`,
      { principal: { id: owner.id } },
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'APPROVE', personId: 'attacker' }) },
    ), { params: { id: requestRow.id } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.decision.personId).toBe(owner.id)
    expect(body.request.status).toBe('PENDING')
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: requestRow.id } })).toBe(1)
  })

  it('rejects a user without an exact active same-Business OWNER Membership', async () => {
    const other = await prisma.person.create({ data: { code: 'PSN-AGAPI-OTHER', displayName: 'Other' } })
    const response = await getQueue(requestWithViewer(
      `http://local/api/agent/approval-requests?businessId=${business.id}`,
      { principal: { id: other.id } },
    ))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'AGENT_APPROVAL_OWNER_REQUIRED' })
  })
})
