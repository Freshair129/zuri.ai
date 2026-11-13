// @req FR-164, FR-161, FR-003, FR-004 — generated human codes remain unique after a stale allocation read
// @spec BR-002; ADR-064; ADR-066
// @tested tests/integration/code-allocation-retry.test.js
// Real Promise.all races reproduce only on PostgreSQL; SQLite serializes writers,
// so these tests inject the stale read between allocation and the unique insert.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { humanCode } from '@/lib/ids'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { staleCodeReads } from '../factories/stale-code-reads'
import { createSupplier } from '@/modules/procurement/application/supplier-service'
import { createPurchaseOrder } from '@/modules/procurement/application/purchase-order-service'
import { createSalesTask } from '@/modules/crm/sales-task-service'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createContainer } from '@/modules/project-manager/application/work-service'
import { createTeam } from '@/modules/project-manager/application/team-service'
import { createWorkspace as createWorkspaceInScope, createBusinessInGroup } from '@/modules/project-manager/application/scope-service'
import { createAccount } from '@/modules/identity/signup-service'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createReservation } from '@/modules/inventory/application/inventory-atp-service'
import { smartgiftWriteTools } from '@/modules/agent/tools/smartgift-inventory-tools'
import { executeAgentAction, issueStepUp } from '@/modules/agent'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'

const SAME_DAY = new Date('2026-09-06T03:00:00Z')
const PROCUREMENT_DOMAINS = ['projects', 'platform', 'procurement', 'inventory']
const CRM_DOMAINS = ['projects', 'platform', 'customer']

let poRetry, poExhaustion, taskRetry, taskExhaustion, projectContext

async function createBusinessContext(prefix, visibleDomains) {
  const tenant = await createTenant({
    portfolioId: portfolio.id,
    name: `${prefix} Tenant`,
    code: `TNT-C9-${prefix}`,
  })
  const business = await createBusiness({
    tenantId: tenant.id,
    name: `${prefix} Business`,
    code: `BUS-C9-${prefix}`,
  })
  const viewer = makeViewer({
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    visibleDomains,
  })
  return { tenant, business, viewer }
}

let portfolio

async function addSupplier(context, prefix) {
  context.supplier = await createSupplier({
    businessId: context.business.id,
    code: `SUP-C9-${prefix}`,
    name: `${prefix} Supplier`,
  }, { viewer: context.viewer })
  return context
}

function purchaseOrderInput(context) {
  return {
    businessId: context.business.id,
    supplierId: context.supplier.id,
    lines: [{ description: 'Allocation retry item', qty: 1, unitCost: 10 }],
  }
}

function createTask(context, title) {
  return createSalesTask({
    businessId: context.business.id,
    title,
    dueDate: '2026-09-06',
  }, { viewer: context.viewer, now: SAME_DAY })
}

function staleFirstGateReservationReads() {
  const originalTransaction = prisma.$transaction.bind(prisma)
  let transactionCalls = 0
  let staleReads = 0
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation((callback, ...options) => {
    if (typeof callback !== 'function') return originalTransaction(callback, ...options)
    const attempt = ++transactionCalls
    return originalTransaction(async (tx) => {
      const readSpies = []
      if (attempt === 1) {
        readSpies.push(vi.spyOn(tx.stockReservation, 'count').mockImplementationOnce(async () => {
          staleReads += 1
          return 0
        }))
        readSpies.push(vi.spyOn(tx.stockReservation, 'findUnique').mockImplementationOnce(async () => {
          staleReads += 1
          return null
        }))
      }
      try {
        return await callback(tx)
      } finally {
        for (const spy of readSpies.reverse()) spy.mockRestore()
      }
    }, ...options)
  })
  return {
    get transactionCalls() { return transactionCalls },
    get staleReads() { return staleReads },
    restore() { transactionSpy.mockRestore() },
  }
}

describe('human-code allocation retries', () => {
  beforeAll(async () => {
    portfolio = await createPortfolio({ name: 'Code Retry Group', code: 'PF-C9' })

    poRetry = await addSupplier(await createBusinessContext('PO-RETRY', PROCUREMENT_DOMAINS), 'PO-RETRY')
    poExhaustion = await addSupplier(await createBusinessContext('PO-EXHAUST', PROCUREMENT_DOMAINS), 'PO-EXHAUST')
    taskRetry = await createBusinessContext('TASK-RETRY', CRM_DOMAINS)
    taskExhaustion = await createBusinessContext('TASK-EXHAUST', CRM_DOMAINS)

    projectContext = await createBusinessContext('PROJECT', ['projects', 'platform'])
    projectContext.workspace = await createWorkspace({
      name: 'Project Code Retry Space',
      scopeType: 'BUSINESS',
      businessId: projectContext.business.id,
      code: 'WS-C9-PROJECT',
    })
  })

  it('reallocates a purchase-order day sequence after the first insert loses the code race', async () => {
    const first = await createPurchaseOrder(purchaseOrderInput(poRetry), { viewer: poRetry.viewer, now: SAME_DAY })
    expect(first.code).toBe('PO-20260906-001')

    const stale = staleCodeReads(prisma, {
      reads: { purchaseOrder: ['count', 'findUnique'] },
    })
    const retried = await createPurchaseOrder(purchaseOrderInput(poRetry), {
      viewer: poRetry.viewer,
      db: stale,
      now: SAME_DAY,
    })

    expect(retried.code).toBe('PO-20260906-002')
    expect(stale.transactionCalls).toBe(2)
    const orders = await prisma.purchaseOrder.findMany({
      where: { businessId: poRetry.business.id },
      select: { id: true, code: true, lines: { select: { id: true } } },
    })
    expect(orders).toHaveLength(2)
    expect(new Set(orders.map((order) => order.code)).size).toBe(2)
    expect(orders.map((order) => order.lines).flat()).toHaveLength(2)

    const audits = await prisma.auditEvent.findMany({
      where: {
        entityType: 'PURCHASE_ORDER',
        action: 'PURCHASE_ORDER_CREATED',
        entityId: { in: orders.map((order) => order.id) },
      },
    })
    expect(audits.map((audit) => audit.entityId).sort()).toEqual(orders.map((order) => order.id).sort())
  })

  it('reports purchase-order code exhaustion without leaving a partial order, line, or audit', async () => {
    const first = await createPurchaseOrder(purchaseOrderInput(poExhaustion), { viewer: poExhaustion.viewer, now: SAME_DAY })
    const stale = staleCodeReads(prisma, {
      reads: { purchaseOrder: ['count', 'findUnique'] },
      staleAttempts: Infinity,
    })

    await expect(createPurchaseOrder(purchaseOrderInput(poExhaustion), {
      viewer: poExhaustion.viewer,
      db: stale,
      now: SAME_DAY,
    })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_CODE_EXHAUSTED' })
    expect(stale.transactionCalls).toBeGreaterThan(1)

    const orders = await prisma.purchaseOrder.findMany({
      where: { businessId: poExhaustion.business.id },
      select: { id: true, code: true, lines: { select: { id: true } } },
    })
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ id: first.id, code: 'PO-20260906-001' })
    expect(orders[0].lines).toHaveLength(1)
    expect(await prisma.auditEvent.count({
      where: { entityId: first.id, action: 'PURCHASE_ORDER_CREATED' },
    })).toBe(1)
  })

  it('reallocates a SalesTask day sequence after the first insert loses the code race', async () => {
    const first = await createTask(taskRetry, 'Retry the first follow-up')
    expect(first.code).toBe('TSK-20260906-001')

    const stale = staleCodeReads(prisma, {
      reads: { salesTask: ['count', 'findUnique'] },
    })
    const retried = await createSalesTask({
      businessId: taskRetry.business.id,
      title: 'Retry the second follow-up',
      dueDate: '2026-09-06',
    }, { viewer: taskRetry.viewer, db: stale, now: SAME_DAY })

    expect(retried.code).toBe('TSK-20260906-002')
    expect(stale.transactionCalls).toBe(2)
    const tasks = await prisma.salesTask.findMany({
      where: { businessId: taskRetry.business.id },
      select: { id: true, code: true },
    })
    expect(tasks).toHaveLength(2)
    expect(new Set(tasks.map((task) => task.code)).size).toBe(2)

    const audits = await prisma.auditEvent.findMany({
      where: {
        entityType: 'SALES_TASK',
        action: 'SALES_TASK_CREATED',
        entityId: { in: tasks.map((task) => task.id) },
      },
    })
    expect(audits.map((audit) => audit.entityId).sort()).toEqual(tasks.map((task) => task.id).sort())
  })

  it('reports SalesTask code exhaustion without creating another task or audit', async () => {
    const first = await createTask(taskExhaustion, 'Keep the existing follow-up')
    const stale = staleCodeReads(prisma, {
      reads: { salesTask: ['count', 'findUnique'] },
      staleAttempts: Infinity,
    })

    await expect(createSalesTask({
      businessId: taskExhaustion.business.id,
      title: 'The conflicting follow-up',
      dueDate: '2026-09-06',
    }, { viewer: taskExhaustion.viewer, db: stale, now: SAME_DAY }))
      .rejects.toMatchObject({ status: 409, message: 'SALES_TASK_CODE_EXHAUSTED' })
    expect(stale.transactionCalls).toBeGreaterThan(1)

    const tasks = await prisma.salesTask.findMany({
      where: { businessId: taskExhaustion.business.id },
      select: { id: true, code: true },
    })
    expect(tasks).toEqual([{ id: first.id, code: 'TSK-20260906-001' }])
    expect(await prisma.auditEvent.count({
      where: { entityId: first.id, action: 'SALES_TASK_CREATED' },
    })).toBe(1)
  })

  it('retries a name-derived project code when its first existence read is stale', async () => {
    const first = await createProject({
      workspaceId: projectContext.workspace.id,
      name: 'Alpha Rollout',
    }, { viewer: projectContext.viewer })
    expect(first.code).toBe('PRJ-ALPHA-ROLLOUT')

    const stale = staleCodeReads(prisma, { reads: { project: ['findUnique'] } })
    const retried = await createProject({
      workspaceId: projectContext.workspace.id,
      name: 'Alpha Rollout',
    }, { viewer: projectContext.viewer, db: stale })

    expect(retried.code).toBe('PRJ-ALPHA-ROLLOUT-2')
    expect(stale.transactionCalls).toBe(2)
    expect(retried.id).not.toBe(first.id)
    expect(await prisma.project.count({ where: { workspaceId: projectContext.workspace.id } })).toBe(2)
    expect(stale.staleReads).toBe(1)
  })

  it('makes only the configured number of direct model reads stale', async () => {
    const project = await createProject({
      workspaceId: projectContext.workspace.id,
      name: 'Direct Read Target',
      code: 'PRJ-C9-DIRECT-READ',
    }, { viewer: projectContext.viewer })
    const stale = staleCodeReads(prisma, {
      reads: { project: ['findUnique'] },
      staleAttempts: 2,
    })
    const lookup = { where: { code: project.code } }

    // Prisma returns a lazy thenable, not a native Promise, so await before asserting.
    expect(await stale.project.findUnique(lookup)).toBeNull()
    expect(await stale.project.findUnique(lookup)).toBeNull()
    expect(await stale.project.findUnique(lookup)).toMatchObject({ id: project.id })
    expect(stale.staleReads).toBe(2)
  })

  it('does not retry or mask a duplicate explicitly supplied project code', async () => {
    const input = {
      workspaceId: projectContext.workspace.id,
      name: 'Explicit Code Project',
      code: 'PRJ-C9-EXPLICIT',
    }
    await createProject(input, { viewer: projectContext.viewer })
    const stale = staleCodeReads(prisma, { reads: { project: ['findUnique'] } })

    await expect(createProject(input, { viewer: projectContext.viewer, db: stale }))
      .rejects.toMatchObject({ code: 'P2002' })
    expect(stale.transactionCalls).toBe(1)
  })

  it('reallocates a Team code after the first existence read is stale', async () => {
    const input = { businessId: projectContext.business.id, name: 'Team Retry C9' }
    const first = await createTeam(input, { viewer: projectContext.viewer })
    const stale = staleCodeReads(prisma, { reads: { team: ['findUnique'] } })

    const retried = await createTeam(input, { viewer: projectContext.viewer, db: stale })

    expect(retried.code).toBe(`${first.code}-2`)
    expect(stale.staleReads).toBe(1)
    expect(await prisma.team.count({ where: { businessId: projectContext.business.id, name: input.name } })).toBe(2)
  })

  it('reallocates a WorkContainer code after a stale read inside its transaction', async () => {
    const project = await createProject({
      workspaceId: projectContext.workspace.id,
      name: 'Container Retry Project',
    }, { viewer: projectContext.viewer })
    const workstream = await createWorkstream({
      projectId: project.id,
      name: 'Container Retry Stream',
      executionMode: 'SOFTWARE_SPRINT',
    }, { viewer: projectContext.viewer })
    const input = { workstreamId: workstream.id, subtype: 'SPRINT', title: 'Container Retry C9' }
    const first = await createContainer(input, { viewer: projectContext.viewer })
    const stale = staleCodeReads(prisma, { reads: { workContainer: ['findUnique'] } })

    const retried = await createContainer(input, { viewer: projectContext.viewer, db: stale })

    expect(retried.code).toBe(`${first.code}-2`)
    expect(stale.transactionCalls).toBe(2)
    expect(stale.staleReads).toBe(1)
  })

  it('reallocates a scope Workspace code after a stale module-level read', async () => {
    const input = {
      name: 'Scope Workspace Retry C9',
      scopeType: 'BUSINESS',
      businessId: projectContext.business.id,
    }
    const first = await createWorkspaceInScope(input, { viewer: projectContext.viewer })
    const originalFindUnique = prisma.workspace.findUnique.bind(prisma.workspace)
    let injectedStaleRead = false
    const findUniqueSpy = vi.spyOn(prisma.workspace, 'findUnique').mockImplementation(async (args) => {
      if (!injectedStaleRead && args?.where?.code === first.code) {
        injectedStaleRead = true
        return null
      }
      return originalFindUnique(args)
    })

    let retried
    let findUniqueCalls = 0
    try {
      retried = await createWorkspaceInScope(input, { viewer: projectContext.viewer })
      findUniqueCalls = findUniqueSpy.mock.calls.length
    } finally {
      findUniqueSpy.mockRestore()
    }

    expect(injectedStaleRead).toBe(true)
    expect(findUniqueCalls).toBe(3)
    expect(retried.code).toBe(`${first.code}-2`)
  })

  it('reallocates a signup Person code after a stale read inside its transaction', async () => {
    const displayName = 'Signup Retry C9'
    const first = await createAccount({
      email: 'signup-retry-first@example.test',
      displayName,
      password: 'ValidPassword123!',
    })
    const stale = staleCodeReads(prisma, { reads: { person: ['findUnique'] } })

    const retried = await createAccount({
      email: 'signup-retry-second@example.test',
      displayName,
      password: 'ValidPassword123!',
      db: stale,
    })

    expect(retried.code).toBe(`${first.code}-2`)
    expect(stale.transactionCalls).toBe(2)
    expect(stale.staleReads).toBe(1)
  })

  it('retries generated Tenant codes in createBusinessInGroup with an explicit Business code', async () => {
    const name = 'Group Retry C9'
    const tenantBase = humanCode('TNT', name)
    await createTenant({ portfolioId: portfolio.id, name: 'Prior Tenant', code: tenantBase })
    const founderPerson = await prisma.person.create({
      data: { code: 'PER-C9-GROUP-RETRY', displayName: 'Group Retry Founder' },
    })
    const viewer = makeViewer({
      principal: { id: founderPerson.id, code: founderPerson.code, displayName: founderPerson.displayName },
      visibleBusinessIds: [],
      ownedBusinessIds: [],
    })
    const stale = staleCodeReads(prisma, { reads: { tenant: ['findUnique'] } })

    const result = await createBusinessInGroup({ name, code: 'BUS-C9-GROUP-RETRY' }, { viewer, db: stale })

    expect(result.business.code).toBe('BUS-C9-GROUP-RETRY')
    expect(result.tenant.code).toBe(`${tenantBase}-2`)
    expect(stale.transactionCalls).toBe(2)
    expect(stale.staleReads).toBe(1)
  })

  it('preserves the raw Prisma error for a duplicate explicit Business code', async () => {
    const founderPerson = await prisma.person.create({
      data: { code: 'PER-C9-GROUP-DUP', displayName: 'Group Duplicate Founder' },
    })
    const viewer = makeViewer({
      principal: { id: founderPerson.id, code: founderPerson.code, displayName: founderPerson.displayName },
      visibleBusinessIds: [],
      ownedBusinessIds: [],
    })
    const input = { name: 'First Explicit Group C9', code: 'BUS-C9-GROUP-DUP' }
    await createBusinessInGroup(input, { viewer })
    const countingDb = staleCodeReads(prisma)

    await expect(createBusinessInGroup({ ...input, name: 'Duplicate Explicit Group C9' }, { viewer, db: countingDb }))
      .rejects.toMatchObject({ code: 'P2002' })
    expect(countingDb.transactionCalls).toBe(1)
  })

  it('retries SmartGift code conflicts at the action-gate transaction boundary', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
    const context = await createBusinessContext(`GATE-${suffix}`, ['projects', 'platform', 'inventory'])
    const { tenant, business } = context
    const category = await createCategory({
      businessId: business.id,
      code: `CAT-GATE-${suffix}`,
      nameTh: 'ชุดทดสอบ',
      nameEn: 'Gate retry fixture',
    }, { viewer: context.viewer })
    const master = await createProductMaster({
      businessId: business.id,
      code: `PM-GATE-${suffix}`,
      categoryId: category.id,
      nameTh: 'สินค้า',
      nameEn: 'Gate retry product',
    }, { viewer: context.viewer })
    const product = await createProduct({
      businessId: business.id,
      code: `SKU-GATE-${suffix}`,
      productMasterId: master.id,
      name: 'Gate retry product',
    }, { viewer: context.viewer })
    const location = await createLocation({
      businessId: business.id,
      code: `LOC-GATE-${suffix}`,
      name: 'คลังทดสอบ',
      type: 'TH_CENTRAL_RAW',
    }, { viewer: context.viewer })
    await recordMovement({
      businessId: business.id,
      productId: product.id,
      kind: 'RECEIPT',
      quantity: 10,
      targetLocationId: location.id,
      costSatang: 10000,
      occurredAt: SAME_DAY,
    }, { viewer: context.viewer })

    const staff = await prisma.person.create({ data: { code: `PER-GATE-${suffix}`, displayName: 'Gate retry staff' } })
    await prisma.membership.create({ data: {
      personId: staff.id,
      tenantId: tenant.id,
      businessId: business.id,
      scopeType: 'BUSINESS',
      role: 'OWNER',
    } })
    const link = await issueLinkToken({ tenantId: tenant.id, personId: staff.id })
    const lineUserId = `U-GATE-${suffix}`
    await redeemLinkToken({ tenantId: tenant.id, token: link.token, lineUserId })
    const customer = await ingestLineMessage({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: `U-GATE-CUSTOMER-${suffix}`,
      threadId: `T-GATE-${suffix}`,
      text: 'Please hold one item',
    })

    const approver = await prisma.person.create({ data: { code: `PER-GATE-APP-${suffix}`, displayName: 'Gate retry approver' } })
    await prisma.membership.create({ data: {
      personId: approver.id,
      tenantId: tenant.id,
      businessId: business.id,
      scopeType: 'BUSINESS',
      role: 'OWNER',
    } })
    const actionViewer = makeViewer({
      principal: { id: staff.id, code: staff.code, displayName: staff.displayName },
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      visibleDomains: ['projects', 'platform', 'inventory'],
    })
    const smartgiftAction = smartgiftWriteTools({ viewer: actionViewer, businessId: business.id, now: () => SAME_DAY })
      .get('create_quote_stock_reservation')
    const action = {
      ...smartgiftAction,
      name: `create_quote_stock_reservation_${suffix}`,
      sensitivity: 'HIGH',
      approvalTier: 'L1',
      targetKind: 'CONVERSATION',
      targetField: 'conversationId',
    }
    const registry = { get: (name) => name === action.name ? action : undefined }
    const request = await executeAgentAction({
      tenantId: tenant.id,
      lineUserId,
      actionName: action.name,
      target: { conversationId: customer.conversationId },
      payload: { skuCode: product.code, quantity: 1 },
    }, { registry })
    expect(request.approvalRequired).toBe(true)
    await decideAgentApprovalRequest(prisma, {
      requestId: request.approvalRequestId,
      personId: approver.id,
      decision: 'APPROVE',
    })
    const approvedStepUp = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    const existingReservation = await createReservation({
      businessId: business.id,
      productId: product.id,
      quantity: 1,
      purpose: 'QUOTE',
    }, { viewer: actionViewer, now: SAME_DAY })
    expect(existingReservation.code).toBe('RSV-20260906-001')

    const approvedReads = staleFirstGateReservationReads()
    let approvedResult
    try {
      approvedResult = await executeAgentAction({
        tenantId: tenant.id,
        lineUserId,
        actionName: action.name,
        target: { conversationId: customer.conversationId },
        payload: { skuCode: product.code, quantity: 1 },
        approvalRequestId: request.approvalRequestId,
        stepUpToken: approvedStepUp.token,
      }, { registry })
    } finally {
      approvedReads.restore()
    }

    expect(approvedReads.transactionCalls).toBe(2)
    expect(approvedReads.staleReads).toBe(2)
    expect(approvedResult).toMatchObject({ executed: true, steppedUp: true })
    expect(approvedResult.result.reservations[0].code).toBe('RSV-20260906-002')
    expect(await prisma.agentApprovalRequest.findUnique({ where: { id: request.approvalRequestId } }))
      .toMatchObject({ status: 'EXECUTED' })
    expect(await prisma.auditEvent.count({
      where: { entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.approvalRequestId, action: 'EXECUTED' },
    })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'AGENT_ACTION', entityId: action.name, action: 'EXECUTED' },
    })).toBe(1)
    expect(await prisma.identityLinkToken.count({
      where: { token: approvedStepUp.token, provider: 'STEPUP', consumedAt: { not: null } },
    })).toBe(1)

    action.approvalTier = 'NONE'
    const directStepUp = await issueStepUp({ tenantId: tenant.id, personId: staff.id })
    const directReads = staleFirstGateReservationReads()
    let directResult
    try {
      directResult = await executeAgentAction({
        tenantId: tenant.id,
        lineUserId,
        actionName: action.name,
        target: { conversationId: customer.conversationId },
        payload: { skuCode: product.code, quantity: 1 },
        stepUpToken: directStepUp.token,
      }, { registry })
    } finally {
      directReads.restore()
    }

    expect(directReads.transactionCalls).toBe(2)
    expect(directReads.staleReads).toBe(2)
    expect(directResult).toMatchObject({ executed: true, steppedUp: true })
    expect(directResult.result.reservations[0].code).toBe('RSV-20260906-003')
    expect(await prisma.identityLinkToken.count({
      where: { token: directStepUp.token, provider: 'STEPUP', consumedAt: { not: null } },
    })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { entityType: 'AGENT_ACTION', entityId: action.name, action: 'EXECUTED' },
    })).toBe(2)
  })
})
