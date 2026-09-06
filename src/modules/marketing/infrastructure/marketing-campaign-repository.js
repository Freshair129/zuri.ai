import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'
import { marketingConflict, marketingNotFound } from '@/modules/marketing/application/marketing-authority'

// @req FR-156 — persist Campaign identity and explicit handoff selection behind
// an injected, Business/Tenant-scoped repository.
// @spec SDD-087, SEC-001, SEC-003
// @tested tests/integration/marketing-campaign.test.js

function assertScope(scope) {
  if (!scope?.tenantId || typeof scope.tenantId !== 'string') {
    throw new Error('Marketing campaign repository tenantId is required')
  }
  if (!scope?.businessId || typeof scope.businessId !== 'string') {
    throw new Error('Marketing campaign repository businessId is required')
  }
}

function assertModel(model, name, methods = []) {
  if (!model) throw new Error(`Prisma ${name} model is not available`)
  for (const method of methods) {
    if (typeof model[method] !== 'function') {
      throw new Error(`Prisma ${name} model must support ${method}`)
    }
  }
}

function uniqueConflict(error) {
  return error?.code === 'P2002'
}

function requireCount(result, message) {
  if (!result || result.count !== 1) throw marketingConflict(message)
}

function assertInitiativeScope(initiative, scope) {
  if (!initiative || initiative.tenantId !== scope.tenantId || initiative.businessId !== scope.businessId) {
    throw marketingNotFound('Marketing campaign not found')
  }
}

export function createMarketingCampaignRepository(prisma, scope) {
  assertScope(scope)
  assertModel(prisma?.marketingInitiative, 'MarketingInitiative', ['create', 'findMany', 'updateMany'])
  assertModel(prisma?.marketingPlan, 'MarketingPlan', ['create', 'findUnique', 'findMany', 'updateMany'])
  assertModel(prisma?.marketingPlanVersion, 'MarketingPlanVersion', ['create', 'findMany'])
  assertModel(prisma?.marketingReview, 'MarketingReview', ['create', 'findMany'])
  assertModel(prisma?.marketingDecision, 'MarketingDecision', ['create', 'findMany'])
  assertModel(prisma?.marketingHandoff, 'MarketingHandoff', ['findMany'])

  const planRepository = createMarketingPlanRepository(prisma, scope)
  const scopeWhere = { tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null }

  async function findInitiative(id, { includeDeleted = false } = {}) {
    if (!id || typeof id !== 'string') return null
    const where = { id, ...(includeDeleted ? { tenantId: scope.tenantId, businessId: scope.businessId } : scopeWhere) }
    const initiative = typeof prisma.marketingInitiative.findFirst === 'function'
      ? await prisma.marketingInitiative.findFirst({ where })
      : await prisma.marketingInitiative.findUnique({ where: { id } })
    if (!initiative) return null
    assertInitiativeScope(initiative, scope)
    if (!includeDeleted && initiative.deletedAt) return null
    return initiative
  }

  async function listInitiatives({ limit = 100 } = {}) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100
    const rows = await prisma.marketingInitiative.findMany({
      where: scopeWhere,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: boundedLimit + 1,
    })
    const truncated = rows.length > boundedLimit
    const initiatives = truncated ? rows.slice(0, boundedLimit) : rows
    initiatives.forEach((initiative) => assertInitiativeScope(initiative, scope))
    return { initiatives, truncated }
  }

  async function load(id) {
    const initiative = await findInitiative(id)
    if (!initiative) return null
    const aggregate = await planRepository.load(initiative.planId)
    if (!aggregate?.plan || aggregate.plan.id !== initiative.planId) {
      throw marketingNotFound('Marketing campaign not found')
    }
    if (aggregate.plan.tenantId !== scope.tenantId || aggregate.plan.businessId !== scope.businessId) {
      throw marketingNotFound('Marketing campaign not found')
    }
    return { initiative, ...aggregate }
  }

  async function createInitiative(data) {
    if (data.tenantId !== scope.tenantId || data.businessId !== scope.businessId) {
      throw marketingNotFound('Marketing campaign not found')
    }
    try {
      const initiative = await prisma.marketingInitiative.create({ data })
      assertInitiativeScope(initiative, scope)
      return initiative
    } catch (error) {
      if (uniqueConflict(error)) throw marketingConflict('Marketing campaign code or plan already exists')
      throw error
    }
  }

  async function casUpdateInitiative(id, expectedVersion, data, message = 'Marketing campaign changed; reload before saving') {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('expectedVersion is required')
    }
    let result
    try {
      result = await prisma.marketingInitiative.updateMany({
        where: { id, ...scopeWhere, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      })
    } catch (error) {
      if (uniqueConflict(error)) throw marketingConflict('Marketing campaign code already exists')
      throw error
    }
    requireCount(result, message)
    return findInitiative(id)
  }

  async function findHandoff(id) {
    if (!id || typeof id !== 'string') return null
    if (typeof prisma.marketingHandoff.findUnique === 'function') {
      return prisma.marketingHandoff.findUnique({ where: { id } })
    }
    const rows = await prisma.marketingHandoff.findMany({ where: { id }, take: 1 })
    return rows[0] || null
  }

  async function transaction(callback) {
    if (typeof prisma.$transaction !== 'function') {
      return callback(
        Object.freeze({
          findInitiative,
          listInitiatives,
          load,
          createInitiative,
          casUpdateInitiative,
          findHandoff,
          transaction,
        }),
        prisma,
        planRepository,
      )
    }

    return prisma.$transaction(async (tx) => {
      const txCampaignRepository = createMarketingCampaignRepository(tx, scope)
      const txPlanRepository = createMarketingPlanRepository(tx, scope)
      return callback(txCampaignRepository, tx, txPlanRepository)
    })
  }

  return Object.freeze({
    findInitiative,
    listInitiatives,
    load,
    createInitiative,
    casUpdateInitiative,
    findHandoff,
    transaction,
  })
}
