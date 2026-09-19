import { describe, expect, it, vi } from 'vitest'
import { createProjectFeatureRepository } from '@/modules/project-manager/application/project-feature-repository'
import { makeViewer } from '../factories/viewer'

// @req FR-252 — Project Feature reads and writes prove the complete Project →
// Workspace → Business → Tenant ancestry before touching any protected family.
// @spec ADR-097; docs/architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md
// @tested tests/unit/project-feature-repository.test.js

const projectId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const businessId = '33333333-3333-4333-8333-333333333333'
const workspaceId = '44444444-4444-4444-8444-444444444444'

function baseScope() {
  return {
    project: { id: projectId, businessId, workspaceId, deletedAt: null },
    workspace: { id: workspaceId, scopeType: 'BUSINESS', tenantId, businessId, portfolioId: null, status: 'ACTIVE' },
    business: { id: businessId, tenantId, status: 'ACTIVE' },
    tenant: { id: tenantId, status: 'ACTIVE' },
  }
}

function fakeDb({ scope = baseScope(), log = [], transaction = null } = {}) {
  const model = (name, result = []) => ({
    findUnique: vi.fn(async (args) => {
      log.push(`${name}.findUnique`)
      if (name === 'project') return scope.project
      if (name === 'workspace') return scope.workspace
      if (name === 'business') return scope.business
      if (name === 'tenant') return scope.tenant
      return null
    }),
    findMany: vi.fn(async () => {
      log.push(`${name}.findMany`)
      return result
    }),
  })

  const db = {
    project: model('project'),
    workspace: model('workspace'),
    business: model('business'),
    tenant: model('tenant'),
    projectRepository: model('projectRepository'),
    governanceSnapshot: model('governanceSnapshot'),
    projectFeature: model('projectFeature'),
    featureContribution: model('featureContribution'),
    featureWorkLink: model('featureWorkLink'),
    requirementBinding: model('requirementBinding'),
    projectFeatureMutationReceipt: model('projectFeatureMutationReceipt'),
  }
  if (transaction) db.$transaction = transaction
  return db
}

const owner = makeViewer({
  visibleBusinessIds: [businessId],
  ownedBusinessIds: [businessId],
})

describe('Project Feature repository boundary', () => {
  it('proves the full ancestry before any of the six protected family delegates', async () => {
    const log = []
    const db = fakeDb({ log })
    const repository = createProjectFeatureRepository({
      db,
      dialect: 'sqlite',
      sqliteTransaction: async (callback) => callback(db),
    })

    const family = await repository.readProjectFeatureFamily(projectId, { viewer: owner })

    expect(family.scope).toMatchObject({ tenantId, businessId })
    expect(log.slice(0, 4)).toEqual([
      'project.findUnique',
      'workspace.findUnique',
      'business.findUnique',
      'tenant.findUnique',
    ])
    expect(log.slice(4)).toEqual(expect.arrayContaining([
      'projectRepository.findMany',
      'governanceSnapshot.findMany',
      'projectFeature.findMany',
      'featureContribution.findMany',
      'featureWorkLink.findMany',
      'requirementBinding.findMany',
      'projectFeatureMutationReceipt.findMany',
    ]))
  })

  it('refuses an unowned Business before querying a protected family', async () => {
    const log = []
    const db = fakeDb({ log })
    const repository = createProjectFeatureRepository({
      db,
      dialect: 'sqlite',
      sqliteTransaction: async (callback) => callback(db),
    })
    const merelySees = makeViewer({ visibleBusinessIds: [businessId], ownedBusinessIds: [] })

    await expect(repository.withProjectTransaction(
      { projectId, viewer: merelySees, mode: 'write' },
      async () => 'unexpected',
    )).rejects.toMatchObject({
      code: 'PHASE_B_PROJECT_NOT_FOUND', status: 404,
    })
    expect(log.slice(0, 4)).toEqual([
      'project.findUnique',
      'workspace.findUnique',
      'business.findUnique',
      'tenant.findUnique',
    ])
    expect(db.projectFeature.findMany).not.toHaveBeenCalled()
  })

  it('binds a Postgres write to the proven scope and locks the Project', async () => {
    const calls = []
    const log = []
    let boundScope = { tenantId: null, businessId: null }
    const db = fakeDb({ log, transaction: async (callback, options) => {
      calls.push({ kind: 'transaction', options })
      return callback(db)
    } })
    db.$queryRawUnsafe = vi.fn(async (sql) => {
      calls.push({ kind: 'query', sql })
      if (sql.includes('current_setting')) return [boundScope]
      if (sql.includes('FOR UPDATE')) return [{ id: projectId }]
      return []
    })
    db.$executeRawUnsafe = vi.fn(async (sql, ...params) => {
      calls.push({ kind: 'execute', sql, params })
      if (sql.includes('set_config')) boundScope = { tenantId: params[0] || null, businessId: params[1] || null }
      return 1
    })
    const repository = createProjectFeatureRepository({ db, dialect: 'postgres' })

    await repository.withProjectTransaction({ projectId, viewer: owner, mode: 'write' }, async (tx, scope) => {
      expect(tx).toBe(db)
      expect(scope).toMatchObject({ tenantId, businessId })
    })

    expect(calls[0].kind).toBe('transaction')
    expect(calls.find((call) => call.kind === 'execute')).toMatchObject({ params: [tenantId, businessId] })
    expect(calls.find((call) => call.kind === 'query' && call.sql.includes('FOR UPDATE'))).toBeTruthy()
    expect(db.project.findUnique).toHaveBeenCalledTimes(2)
    expect(db.workspace.findUnique).toHaveBeenCalledTimes(2)
    expect(db.business.findUnique).toHaveBeenCalledTimes(2)
    expect(db.tenant.findUnique).toHaveBeenCalledTimes(2)
  })

  it('refuses a PostgreSQL Project lock that returns no row', async () => {
    const db = fakeDb()
    db.$transaction = vi.fn(async (callback) => callback(db))
    db.$queryRawUnsafe = vi.fn(async (sql) => sql.includes('FOR UPDATE') ? [] : [{ tenantId, businessId }])
    db.$executeRawUnsafe = vi.fn(async () => 1)
    const repository = createProjectFeatureRepository({ db, dialect: 'postgres' })

    await expect(repository.withProjectTransaction(
      { projectId, viewer: owner, mode: 'write' },
      async () => 'unexpected',
    )).rejects.toMatchObject({ code: 'PHASE_B_PROJECT_NOT_FOUND', status: 404 })
  })

  it('fails closed when an injected client omits its dialect even if process URLs are configured', async () => {
    const prior = process.env.DATABASE_POSTGRES_URL
    process.env.DATABASE_POSTGRES_URL = 'postgresql://decoy.invalid/db'
    try {
      const db = fakeDb()
      const repository = createProjectFeatureRepository({ db })
      await expect(repository.readProjectFeatureFamily(projectId, { viewer: owner }))
        .rejects.toMatchObject({ code: 'PHASE_B_DATABASE_DIALECT_UNAVAILABLE', status: 503 })
    } finally {
      if (prior === undefined) delete process.env.DATABASE_POSTGRES_URL
      else process.env.DATABASE_POSTGRES_URL = prior
    }
  })

  it('reuses an explicit transaction and retries only a serialization failure', async () => {
    const log = []
    const db = fakeDb({ log })
    const transaction = vi.fn()
    transaction
      .mockRejectedValueOnce(Object.assign(new Error('could not serialize access'), { code: 'P2034' }))
      .mockImplementationOnce(async (callback) => callback(db))
    db.$transaction = transaction
    const sleep = vi.fn(async () => {})
    const repository = createProjectFeatureRepository({ db, dialect: 'sqlite', maxAttempts: 2, sleep })

    await repository.withProjectTransaction({ projectId, viewer: owner, mode: 'read' }, async () => 'ok')
    expect(transaction).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)

    const suppliedTx = fakeDb({ log: [] })
    const suppliedRepository = createProjectFeatureRepository({ db, dialect: 'sqlite' })
    await suppliedRepository.withProjectTransaction({ projectId, viewer: owner, transaction: suppliedTx }, async (tx) => {
      expect(tx).toBe(suppliedTx)
    })
    expect(transaction).toHaveBeenCalledTimes(2)
  })
})
