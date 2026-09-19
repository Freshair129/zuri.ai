import prisma from '@/lib/db'
import { ownsBusiness, seesBusiness, isInstallationOperator } from '@/modules/identity/viewer-authority'

// @req FR-252 — the Phase B Feature records are reached through one scoped PM
// repository boundary. The boundary proves Project -> Workspace -> Business ->
// Tenant before it reads any of the six Phase B families.
// @spec ADR-097; docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md; docs/architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md
// @tested tests/unit/project-feature-repository.test.js

export const PHASE_B_FAMILY_DELEGATES = Object.freeze([
  'governanceSnapshot',
  'projectFeature',
  'featureContribution',
  'featureWorkLink',
  'requirementBinding',
  'projectFeatureMutationReceipt',
])

export const PROJECT_FEATURE_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: 'Serializable',
  maxWait: 10_000,
  timeout: 120_000,
})

const MAX_TRANSACTION_ATTEMPTS = 3

function repositoryError(code, status = 409, details = null) {
  const error = new Error(code)
  error.name = 'ProjectFeatureRepositoryError'
  error.code = code
  error.status = status
  error.retryable = false
  if (details) error.details = details
  return error
}

function requiredId(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw repositoryError(code, 400)
  return value
}

function detectDialect(db, dialect) {
  if (dialect === 'postgres' || dialect === 'sqlite') return dialect
  const provider = db?.dialect
    || db?.provider
    || db?._engineConfig?.activeProvider
    || db?._client?._engineConfig?.activeProvider
    || db?._activeProvider
    || db?._engineConfig?.datasources?.[0]?.activeProvider
    || db?._engineConfig?.datasources?.[0]?.provider
  if (typeof provider === 'string') {
    if (/postgres/i.test(provider)) return 'postgres'
    if (/sqlite/i.test(provider)) return 'sqlite'
    return null
  }
  // The transaction/adaptor must identify its own engine. Environment URLs
  // describe process configuration, not the client currently holding a
  // transaction, and must never select an RLS or locking protocol for it.
  return null
}

function retryableTransactionFailure(error) {
  return error?.code === 'P2034'
    || /could not serialize|serialization failure|deadlock detected|database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(error?.message || '')
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function transaction(db, callback, { postgres, transactionOptions } = {}) {
  if (typeof db.$transaction !== 'function') return callback(db)
  return db.$transaction(callback, postgres ? transactionOptions : { maxWait: transactionOptions.maxWait, timeout: transactionOptions.timeout })
}

async function executeRaw(tx, sql, params = []) {
  if (typeof tx.$executeRawUnsafe === 'function') return tx.$executeRawUnsafe(sql, ...params)
  if (typeof tx.$executeRaw === 'function') return tx.$executeRaw(sql, ...params)
  throw repositoryError('PHASE_B_SCOPE_BINDING_UNAVAILABLE', 503)
}

async function queryRaw(tx, sql, params = []) {
  if (typeof tx.$queryRawUnsafe === 'function') return tx.$queryRawUnsafe(sql, ...params)
  if (typeof tx.$queryRaw === 'function') return tx.$queryRaw(sql, ...params)
  throw repositoryError('PHASE_B_PROJECT_LOCK_UNAVAILABLE', 503)
}

function authorityScope(authority) {
  if (!authority || typeof authority !== 'object') return null
  return {
    tenantId: authority.tenantId || authority.scope?.tenantId || null,
    businessId: authority.businessId || authority.scope?.businessId || null,
  }
}

function viewerForAuthority(authority) {
  return authority?.viewer || null
}

function authorizeScope({ viewer, authority, mode, tenantId, businessId }) {
  const bound = authorityScope(authority)
  const internal = mode === 'erase' || mode === 'erasure' || Boolean(authority)

  if (internal) {
    if (!bound || bound.tenantId !== tenantId || bound.businessId !== businessId) {
      throw repositoryError('PHASE_B_SCOPE_MISMATCH', 404)
    }
    const trustedViewer = viewerForAuthority(authority)
    if (!trustedViewer || (!isInstallationOperator(trustedViewer) && !ownsBusiness(trustedViewer, businessId))) {
      throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)
    }
    return
  }

  if (!viewer) throw new Error('ProjectFeatureRepository: viewer is required')
  const allowed = mode === 'write' || mode === 'mutation'
    ? ownsBusiness(viewer, businessId)
    : viewer.isPlatform === true || seesBusiness(viewer, businessId)
  if (!allowed) throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)
}

/**
 * Resolve and authorize the complete project ancestry. This function deliberately
 * does not touch a Phase B model. Callers must finish it before querying any of
 * the six protected delegates.
 */
export async function resolveProjectFeatureScope(
  projectId,
  { db = prisma, viewer, authority = null, mode = 'read' } = {},
) {
  requiredId(projectId, 'PHASE_B_PROJECT_ID_REQUIRED')

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, businessId: true, workspaceId: true, deletedAt: true },
  })
  if (!project || project.deletedAt) throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)

  const workspace = await db.workspace.findUnique({
    where: { id: project.workspaceId },
    select: { id: true, scopeType: true, tenantId: true, businessId: true, portfolioId: true, status: true },
  })
  if (!workspace || workspace.status === 'DELETED') throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)

  // Phase B records require the Project's own Business binding. The workspace
  // value is checked below according to its scope type, never used to infer a
  // missing Project owner or to choose one side of a corrupt hierarchy.
  const businessId = project.businessId || null
  if (!project.businessId || (workspace.businessId && project.businessId !== workspace.businessId)) {
    throw repositoryError('PHASE_B_SCOPE_UNBOUND', 403)
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, status: true },
  })
  if (!business || business.status === 'DELETED') throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)

  const tenant = await db.tenant.findUnique({
    where: { id: business.tenantId },
    select: { id: true, portfolioId: true, status: true },
  })
  if (!tenant || tenant.status === 'DELETED') throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)

  if ((workspace.tenantId && workspace.tenantId !== tenant.id)
    || (workspace.scopeType === 'BUSINESS' && workspace.businessId && workspace.businessId !== business.id)) {
    throw repositoryError('PHASE_B_SCOPE_INVALID', 404)
  }

  const workspaceMatchesScope = workspace.scopeType === 'BUSINESS'
    ? workspace.businessId === business.id && (!workspace.tenantId || workspace.tenantId === tenant.id)
    : workspace.scopeType === 'TENANT'
      ? workspace.tenantId === tenant.id
      : workspace.scopeType === 'PORTFOLIO'
        ? workspace.tenantId === tenant.id && workspace.portfolioId === tenant.portfolioId
        : false
  if (!workspaceMatchesScope) throw repositoryError('PHASE_B_SCOPE_INVALID', 404)

  authorizeScope({ viewer, authority, mode, tenantId: tenant.id, businessId: business.id })
  return { project, workspace, business, tenant, tenantId: tenant.id, businessId: business.id }
}

async function bindPostgresScope(tx, scope) {
  await executeRaw(
    tx,
    "SELECT set_config('zuri.pm_tenant_id', $1, true), set_config('zuri.pm_business_id', $2, true)",
    [scope.tenantId, scope.businessId],
  )
  const rows = await queryRaw(
    tx,
    "SELECT NULLIF(current_setting('zuri.pm_tenant_id', true), '') AS \"tenantId\", NULLIF(current_setting('zuri.pm_business_id', true), '') AS \"businessId\"",
  )
  const bound = rows?.[0]
  if (!bound || bound.tenantId !== scope.tenantId || bound.businessId !== scope.businessId) {
    throw repositoryError('PHASE_B_SCOPE_BINDING_MISMATCH', 503)
  }
}

async function lockProject(tx, projectId, { postgres, lockProject: adapterLock } = {}) {
  if (typeof adapterLock === 'function') {
    await adapterLock(tx, projectId)
    return
  }
  if (postgres) {
    const rows = await queryRaw(tx, 'SELECT "id" FROM "Project" WHERE "id" = $1 FOR UPDATE', [projectId])
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)
    }
    return
  }
  // SQLite BEGIN IMMEDIATE (when supplied by the adapter) serializes all writes.
  // Prisma's fallback interactive transaction also serializes a write; the
  // lookup retains the explicit existence check without starting a nested tx.
  if (typeof tx.project?.findUnique === 'function') {
    const locked = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!locked) throw repositoryError('PHASE_B_PROJECT_NOT_FOUND', 404)
    return
  }
  throw repositoryError('PHASE_B_PROJECT_LOCK_UNAVAILABLE', 503)
}

async function withImmediateTransaction(db, callback, { postgres, transactionOptions, sqliteTransaction } = {}) {
  if (postgres) return transaction(db, callback, { postgres, transactionOptions })
  if (typeof sqliteTransaction === 'function') return sqliteTransaction(callback)
  if (typeof db.$transactionImmediate === 'function') return db.$transactionImmediate(callback)
  if (typeof db.withImmediateTransaction === 'function') return db.withImmediateTransaction(callback)
  return transaction(db, callback, { postgres: false, transactionOptions })
}

async function readFamily(tx, scope, { includeDeleted = false } = {}) {
  // Supporting ProjectRepository is read only and precedes all six family
  // queries. Its IDs prevent a snapshot from another Project being pulled into
  // this aggregate even when its Business happens to match.
  const projectRepositories = typeof tx.projectRepository?.findMany === 'function'
    ? await tx.projectRepository.findMany({ where: { projectId: scope.project.id }, select: { id: true } })
    : []
  const projectRepositoryIds = projectRepositories.map((row) => row.id)
  const featureWhere = { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId }
  if (!includeDeleted) featureWhere.deletedAt = null

  const snapshots = await tx.governanceSnapshot.findMany({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      projectRepositoryId: { in: projectRepositoryIds },
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'asc' }],
  })
  const features = await tx.projectFeature.findMany({
    where: featureWhere,
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
  })
  const featureIds = features.map((row) => row.id)
  const childWhere = (extra) => ({
    ...extra,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    featureId: { in: featureIds },
    ...(!includeDeleted ? { deletedAt: null } : {}),
  })

  const [contributions, workLinks, requirementBindings, mutationReceipts] = await Promise.all([
    tx.featureContribution.findMany({ where: childWhere({}), orderBy: [{ domainId: 'asc' }, { id: 'asc' }] }),
    tx.featureWorkLink.findMany({ where: childWhere({}), orderBy: [{ workItemId: 'asc' }, { id: 'asc' }] }),
    tx.requirementBinding.findMany({ where: childWhere({}), orderBy: [{ sourceNamespace: 'asc' }, { requirementKey: 'asc' }, { id: 'asc' }] }),
    tx.projectFeatureMutationReceipt.findMany({ where: { projectId: scope.project.id, tenantId: scope.tenantId, businessId: scope.businessId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
  ])

  return {
    scope,
    governanceSnapshots: snapshots,
    projectFeatures: features,
    featureContributions: contributions,
    featureWorkLinks: workLinks,
    requirementBindings,
    mutationReceipts,
  }
}

export function createProjectFeatureRepository({
  db = prisma,
  dialect = null,
  transactionOptions = PROJECT_FEATURE_TRANSACTION_OPTIONS,
  maxAttempts = MAX_TRANSACTION_ATTEMPTS,
  sleep: wait = delay,
  sqliteTransaction = null,
  lockProject: adapterLock = null,
} = {}) {
  const detectedDialect = detectDialect(db, dialect)
  const postgres = detectedDialect === 'postgres'

  async function runProjectTransaction({ projectId, viewer, authority = null, mode = 'read', transaction: suppliedTx = null } = {}, callback) {
    requiredId(projectId, 'PHASE_B_PROJECT_ID_REQUIRED')
    if (typeof callback !== 'function') throw new TypeError('ProjectFeatureRepository callback is required')
    if (!detectedDialect) throw repositoryError('PHASE_B_DATABASE_DIALECT_UNAVAILABLE', 503)
    const writeMode = mode === 'write' || mode === 'mutation' || mode === 'erase' || mode === 'erasure'
    if (writeMode && !suppliedTx
      && typeof db.$transaction !== 'function'
      && typeof sqliteTransaction !== 'function'
      && typeof db.$transactionImmediate !== 'function'
      && typeof db.withImmediateTransaction !== 'function') {
      throw repositoryError('PHASE_B_TRANSACTION_REQUIRED', 503)
    }

    const execute = async (tx) => {
      let scope = await resolveProjectFeatureScope(projectId, { db: tx, viewer, authority, mode })
      if (mode === 'write' || mode === 'mutation' || mode === 'erase' || mode === 'erasure') {
        await lockProject(tx, projectId, { postgres, lockProject: adapterLock })
        // A mutation must re-prove the full hierarchy after taking the Project
        // lock. This closes the proof-to-write race for parent scope changes.
        scope = await resolveProjectFeatureScope(projectId, { db: tx, viewer, authority, mode })
      }
      if (postgres) await bindPostgresScope(tx, scope)
      return callback(tx, scope)
    }

    // Explicit transaction clients are reused directly. This is the seam used
    // by Identity composition and is what prevents nested Prisma transactions.
    if (suppliedTx) return execute(suppliedTx)

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await withImmediateTransaction(db, execute, { postgres, transactionOptions, sqliteTransaction })
      } catch (error) {
        if (!retryableTransactionFailure(error) || attempt === maxAttempts - 1) throw error
        await wait(5 * (attempt + 1))
      }
    }
    throw repositoryError('PHASE_B_TRANSACTION_UNAVAILABLE', 503)
  }

  async function readProjectFeatureFamily(projectId, options = {}) {
    return runProjectTransaction({ ...options, projectId, mode: 'read' }, (tx, scope) => readFamily(tx, scope, options))
  }

  async function getProjectFeature(projectId, featureId, options = {}) {
    requiredId(featureId, 'PHASE_B_FEATURE_ID_REQUIRED')
    const family = await readProjectFeatureFamily(projectId, options)
    const feature = family.projectFeatures.find((row) => row.id === featureId)
    if (!feature) throw repositoryError('PHASE_B_FEATURE_NOT_FOUND', 404)
    return {
      ...feature,
      contributions: family.featureContributions.filter((row) => row.featureId === featureId),
      workLinks: family.featureWorkLinks.filter((row) => row.featureId === featureId),
      requirementBindings: family.requirementBindings.filter((row) => row.featureId === featureId),
      scope: family.scope,
    }
  }

  return Object.freeze({
    dialect: detectedDialect,
    resolveProjectScope: (projectId, options = {}) => resolveProjectFeatureScope(projectId, { ...options, db }),
    withProjectTransaction: runProjectTransaction,
    runInProjectTransaction: runProjectTransaction,
    readProjectFeatureFamily,
    getProjectFeatureFamily: readProjectFeatureFamily,
    getProjectFeature,
    listProjectFeatures: async (projectId, options = {}) => {
      const family = await readProjectFeatureFamily(projectId, options)
      return { ...family, features: family.projectFeatures }
    },
  })
}

export default createProjectFeatureRepository
