import { marketingConflict, marketingNotFound } from '@/modules/marketing/application/marketing-authority'

// @req FR-157 — Content persistence is Business/Tenant scoped, append-only for
// revisions/reviews/decisions and optimistic-CAS guarded at the brief root.
// @spec SDD-088, BR-001, SEC-001, SEC-003
// @tested tests/integration/marketing-content.test.js

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
    throw new Error('Marketing content repository tenantId is required')
  }
  if (!scope?.businessId || typeof scope.businessId !== 'string') {
    throw new Error('Marketing content repository businessId is required')
  }
}

function assertBriefScope(brief, scope) {
  if (!brief || brief.tenantId !== scope.tenantId || brief.businessId !== scope.businessId) {
    throw marketingNotFound('Marketing content brief not found')
  }
}

function assertChildBrief(child, briefId) {
  if (!child || child.briefId !== briefId) {
    throw marketingNotFound('Marketing content brief not found')
  }
}

function uniqueConflict(error) {
  return error?.code === 'P2002'
}

function requireCount(result, message) {
  if (!result || result.count !== 1) throw marketingConflict(message)
}

export function createMarketingContentRepository(prisma, scope) {
  assertScope(scope)
  assertModel(prisma?.marketingContentBrief, 'MarketingContentBrief', ['create', 'findMany', 'findUnique', 'updateMany'])
  assertModel(prisma?.marketingContentVersion, 'MarketingContentVersion', ['create', 'findMany', 'findUnique'])
  assertModel(prisma?.marketingContentReview, 'MarketingContentReview', ['create', 'findMany'])
  assertModel(prisma?.marketingContentDecision, 'MarketingContentDecision', ['create', 'findMany'])

  const scopeWhere = { tenantId: scope.tenantId, businessId: scope.businessId, deletedAt: null }

  async function findBrief(id) {
    if (!id || typeof id !== 'string') return null
    const brief = typeof prisma.marketingContentBrief.findFirst === 'function'
      ? await prisma.marketingContentBrief.findFirst({ where: { id, ...scopeWhere } })
      : await prisma.marketingContentBrief.findUnique({ where: { id } })
    if (!brief) return null
    assertBriefScope(brief, scope)
    if (brief.deletedAt) return null
    return brief
  }

  async function listBriefs({ limit = 100 } = {}) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100
    const briefs = await prisma.marketingContentBrief.findMany({
      where: scopeWhere,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: boundedLimit + 1,
    })
    const truncated = briefs.length > boundedLimit
    const rows = truncated ? briefs.slice(0, boundedLimit) : briefs
    rows.forEach((brief) => assertBriefScope(brief, scope))
    return { briefs: rows, truncated }
  }

  async function listChildren(model, briefId, orderBy) {
    const rows = await model.findMany({ where: { briefId }, ...(orderBy ? { orderBy } : {}) })
    rows.forEach((row) => assertChildBrief(row, briefId))
    return rows
  }

  async function load(briefId) {
    const brief = await findBrief(briefId)
    if (!brief) return null
    const [revisions, reviews, decisions] = await Promise.all([
      listChildren(prisma.marketingContentVersion, brief.id, { revision: 'asc' }),
      listChildren(prisma.marketingContentReview, brief.id, { createdAt: 'asc' }),
      listChildren(prisma.marketingContentDecision, brief.id, { createdAt: 'asc' }),
    ])
    return { brief, revisions, reviews, decisions }
  }

  async function loadByVersionId(versionId) {
    if (!versionId || typeof versionId !== 'string') return null
    const version = await prisma.marketingContentVersion.findUnique({ where: { id: versionId } })
    if (!version) return null
    return load(version.briefId)
  }

  async function createBrief(data) {
    if (data.tenantId !== scope.tenantId || data.businessId !== scope.businessId) {
      throw marketingNotFound('Marketing content brief not found')
    }
    try {
      const brief = await prisma.marketingContentBrief.create({ data })
      assertBriefScope(brief, scope)
      return brief
    } catch (error) {
      if (uniqueConflict(error)) throw marketingConflict('Marketing content brief code already exists')
      throw error
    }
  }

  async function createRevision(data) {
    const brief = await findBrief(data.briefId)
    if (!brief) throw marketingNotFound('Marketing content brief not found')
    const revision = await prisma.marketingContentVersion.create({ data })
    assertChildBrief(revision, brief.id)
    return revision
  }

  async function createReview(data) {
    const brief = await findBrief(data.briefId)
    if (!brief) throw marketingNotFound('Marketing content brief not found')
    const review = await prisma.marketingContentReview.create({ data })
    assertChildBrief(review, brief.id)
    return review
  }

  async function createDecision(data) {
    const brief = await findBrief(data.briefId)
    if (!brief) throw marketingNotFound('Marketing content brief not found')
    const decision = await prisma.marketingContentDecision.create({ data })
    assertChildBrief(decision, brief.id)
    return decision
  }

  async function casUpdateBrief(briefId, expectedVersion, data, message = 'Marketing content brief changed; reload before saving') {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('expectedVersion is required')
    }
    let result
    try {
      result = await prisma.marketingContentBrief.updateMany({
        where: { id: briefId, ...scopeWhere, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      })
    } catch (error) {
      if (uniqueConflict(error)) throw marketingConflict('Marketing content brief code already exists')
      throw error
    }
    requireCount(result, message)
    return findBrief(briefId)
  }

  async function appendRevision({ briefId, expectedVersion, revision, data, updatedAt }) {
    const current = await findBrief(briefId)
    if (!current) throw marketingNotFound('Marketing content brief not found')
    if (current.version !== expectedVersion || current.currentRevision + 1 !== revision) {
      throw marketingConflict('Marketing content brief changed; reload before revising')
    }
    await casUpdateBrief(briefId, expectedVersion, {
      title: data.title,
      status: 'OPEN',
      currentRevision: revision,
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createRevision({
      id: data.id,
      briefId,
      revision,
      payloadJson: data.payloadJson,
      payloadHash: data.payloadHash,
      createdBy: data.createdBy,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    })
    return load(briefId)
  }

  async function appendReview({ briefId, expectedVersion, data, updatedAt }) {
    const current = await findBrief(briefId)
    if (!current) throw marketingNotFound('Marketing content brief not found')
    if (data.sequence !== expectedVersion + 1) {
      throw marketingConflict('Marketing content review sequence is stale')
    }
    await casUpdateBrief(briefId, expectedVersion, {
      status: 'OPEN',
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createReview(data)
    return load(briefId)
  }

  async function appendDecision({ briefId, expectedVersion, data, updatedAt }) {
    const current = await findBrief(briefId)
    if (!current) throw marketingNotFound('Marketing content brief not found')
    if (data.sequence !== expectedVersion + 1) {
      throw marketingConflict('Marketing content decision sequence is stale')
    }
    await casUpdateBrief(briefId, expectedVersion, {
      status: 'OPEN',
      ...(updatedAt ? { updatedAt } : {}),
    })
    await createDecision(data)
    return load(briefId)
  }

  async function archive({ briefId, expectedVersion, updatedAt }) {
    const current = await findBrief(briefId)
    if (!current) throw marketingNotFound('Marketing content brief not found')
    await casUpdateBrief(briefId, expectedVersion, {
      status: 'ARCHIVED',
      ...(updatedAt ? { updatedAt } : {}),
    })
    return load(briefId)
  }

  async function transaction(callback) {
    if (typeof prisma.$transaction !== 'function') {
      return callback(Object.freeze({
        listBriefs,
        load,
        loadByVersionId,
        createBrief,
        createRevision,
        createReview,
        createDecision,
        casUpdateBrief,
        appendRevision,
        appendReview,
        appendDecision,
        archive,
        transaction,
      }), prisma)
    }
    return prisma.$transaction(async (tx) => {
      const txRepository = createMarketingContentRepository(tx, scope)
      return callback(txRepository, tx)
    })
  }

  return Object.freeze({
    listBriefs,
    load,
    loadByVersionId,
    createBrief,
    createRevision,
    createReview,
    createDecision,
    casUpdateBrief,
    appendRevision,
    appendReview,
    appendDecision,
    archive,
    transaction,
  })
}
