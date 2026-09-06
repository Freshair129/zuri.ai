import { marketingConflict, marketingNotFound } from '@/modules/marketing/application/marketing-authority'

// @req FR-159 — Marketing plan persistence is an injected, Business/Tenant
// scoped repository with immutable children and optimistic parent CAS.
// @spec SDD-086, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-plan.test.js

function assertModel(model, name, methods = []) {
  if (!model) throw new Error(`Prisma ${name} model is not available`)
  for (const method of methods) {
    if (typeof model[method] !== 'function') {
      throw new Error(`Prisma ${name} model must support ${method}`)
    }
  }
}

function assertScope(scope) {
  if (!scope?.tenantId || typeof scope.tenantId !== 'string') {
    throw new Error('Marketing plan repository tenantId is required')
  }
  if (!scope?.businessId || typeof scope.businessId !== 'string') {
    throw new Error('Marketing plan repository businessId is required')
  }
}

function assertPlanScope(plan, scope) {
  if (!plan || plan.tenantId !== scope.tenantId || plan.businessId !== scope.businessId) {
    throw marketingNotFound('Marketing plan not found')
  }
}

function assertChildPlan(child, planId) {
  if (!child || child.planId !== planId) {
    throw marketingNotFound('Marketing plan not found')
  }
}

function uniqueConflict(error) {
  return error?.code === 'P2002'
}

function requireCount(result, message) {
  if (!result || result.count !== 1) throw marketingConflict(message)
}

export function createMarketingPlanRepository(prisma, scope) {
  assertScope(scope)
  assertModel(prisma?.marketingPlan, 'MarketingPlan', ['create', 'findMany', 'findUnique', 'updateMany'])
  assertModel(prisma?.marketingPlanVersion, 'MarketingPlanVersion', ['create', 'findMany'])
  assertModel(prisma?.marketingReview, 'MarketingReview', ['create', 'findMany'])
  assertModel(prisma?.marketingDecision, 'MarketingDecision', ['create', 'findMany'])
  assertModel(prisma?.marketingHandoff, 'MarketingHandoff', ['findMany'])

  const scopeWhere = { tenantId: scope.tenantId, businessId: scope.businessId }

  async function findPlan(id) {
    if (!id || typeof id !== 'string') return null
    const plan = typeof prisma.marketingPlan.findFirst === 'function'
      ? await prisma.marketingPlan.findFirst({ where: { id, ...scopeWhere } })
      : await prisma.marketingPlan.findUnique({ where: { id } })
    if (!plan) return null
    assertPlanScope(plan, scope)
    return plan
  }

  async function listPlans({ limit = 100 } = {}) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100
    const plans = await prisma.marketingPlan.findMany({
      where: scopeWhere,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: boundedLimit + 1,
    })
    const truncated = plans.length > boundedLimit
    const rows = truncated ? plans.slice(0, boundedLimit) : plans
    rows.forEach((plan) => assertPlanScope(plan, scope))
    return { plans: rows, truncated }
  }

  async function listChildren(model, planId, orderBy) {
    const rows = await model.findMany({ where: { planId }, ...(orderBy ? { orderBy } : {}) })
    rows.forEach((row) => assertChildPlan(row, planId))
    return rows
  }

  async function load(planId) {
    const plan = await findPlan(planId)
    if (!plan) return null

    const [revisions, reviews, decisions] = await Promise.all([
      listChildren(prisma.marketingPlanVersion, plan.id, { revision: 'asc' }),
      listChildren(prisma.marketingReview, plan.id, { createdAt: 'asc' }),
      listChildren(prisma.marketingDecision, plan.id, { createdAt: 'asc' }),
    ])

    const handoffs = await listChildren(prisma.marketingHandoff, plan.id, { createdAt: 'asc' })

    return { plan, revisions, reviews, decisions, handoffs }
  }

  async function createPlan(data) {
    if (data.tenantId !== scope.tenantId || data.businessId !== scope.businessId) {
      throw marketingNotFound('Marketing plan not found')
    }
    const plan = await prisma.marketingPlan.create({ data })
    assertPlanScope(plan, scope)
    return plan
  }

  async function createRevision(data) {
    const plan = await findPlan(data.planId)
    if (!plan) throw marketingNotFound('Marketing plan not found')
    const revision = await prisma.marketingPlanVersion.create({ data })
    assertChildPlan(revision, plan.id)
    return revision
  }

  async function createReview(data) {
    const plan = await findPlan(data.planId)
    if (!plan) throw marketingNotFound('Marketing plan not found')
    const review = await prisma.marketingReview.create({ data })
    assertChildPlan(review, plan.id)
    return review
  }

  async function createDecision(data) {
    const plan = await findPlan(data.planId)
    if (!plan) throw marketingNotFound('Marketing plan not found')
    const decision = await prisma.marketingDecision.create({ data })
    assertChildPlan(decision, plan.id)
    return decision
  }

  async function casUpdatePlan(planId, expectedVersion, data, message = 'Marketing plan changed; reload before saving') {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('expectedVersion is required')
    }
    let result
    try {
      result = await prisma.marketingPlan.updateMany({
        where: { id: planId, ...scopeWhere, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      })
    } catch (error) {
      if (uniqueConflict(error)) throw marketingConflict('Marketing plan code already exists')
      throw error
    }
    requireCount(result, message)
    return findPlan(planId)
  }

  async function appendRevision({ planId, expectedVersion, revision, data, updatedAt }) {
    const current = await findPlan(planId)
    if (!current) throw marketingNotFound('Marketing plan not found')
    if (current.version !== expectedVersion || current.currentRevision + 1 !== revision) {
      throw marketingConflict('Marketing plan changed; reload before revising')
    }

    // The caller places this operation inside transaction(). The CAS update and
    // immutable child insert therefore commit or roll back together.
    await casUpdatePlan(planId, expectedVersion, {
      title: data.title,
      status: 'DRAFT',
      currentRevision: revision,
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createRevision({
      id: data.id,
      planId,
      revision,
      payloadJson: data.payloadJson,
      payloadHash: data.payloadHash,
      createdBy: data.createdBy,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    })
    return load(planId)
  }

  async function appendReview({ planId, expectedVersion, status = 'DRAFT', data, updatedAt }) {
    const current = await findPlan(planId)
    if (!current) throw marketingNotFound('Marketing plan not found')
    await casUpdatePlan(planId, expectedVersion, {
      status,
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createReview(data)
    return load(planId)
  }

  async function appendDecision({ planId, expectedVersion, data, status, updatedAt }) {
    const current = await findPlan(planId)
    if (!current) throw marketingNotFound('Marketing plan not found')
    await casUpdatePlan(planId, expectedVersion, {
      status,
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createDecision(data)
    return load(planId)
  }

  async function archive({ planId, expectedVersion, updatedAt }) {
    const current = await findPlan(planId)
    if (!current) throw marketingNotFound('Marketing plan not found')
    await casUpdatePlan(planId, expectedVersion, {
      status: 'ARCHIVED',
      ...(updatedAt ? { updatedAt } : {}),
    })
    return load(planId)
  }

  async function transaction(callback) {
    if (typeof prisma.$transaction !== 'function') {
      return callback(Object.freeze({
        listPlans,
        load,
        createPlan,
        createRevision,
        createReview,
        createDecision,
        casUpdatePlan,
        appendRevision,
        appendReview,
        appendDecision,
        archive,
        transaction,
      }), prisma)
    }

    return prisma.$transaction(async (tx) => {
      const txRepository = createMarketingPlanRepository(tx, scope)
      return callback(txRepository, tx)
    })
  }

  return Object.freeze({
    listPlans,
    load,
    createPlan,
    createRevision,
    createReview,
    createDecision,
    casUpdatePlan,
    appendRevision,
    appendReview,
    appendDecision,
    archive,
    transaction,
  })
}
