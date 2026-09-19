import { describe, expect, it, vi } from 'vitest'
import {
  computeProjectFeatureGraphEtag,
  ProjectFeatureMutationError,
  runProjectFeatureMutation,
  toPublicProjectFeatureMutationError,
  zFeatureCreateInput,
  zFeatureWorkGraphInput,
  zMutationReceipt,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — Feature mutation commands, receipts, graph ETags and refusals
// remain strict and machine-readable at the application boundary.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/project-feature-service.test.js

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const FEATURE_A = '22222222-2222-4222-8222-222222222222'
const FEATURE_B = '33333333-3333-4333-8333-333333333333'
const ITEM_A = '44444444-4444-4444-8444-444444444444'
const ITEM_B = '55555555-5555-4555-8555-555555555555'
const RECEIPT_ID = '66666666-6666-4666-8666-666666666666'
const AUDIT_ID = '77777777-7777-4777-8777-777777777777'
const REQUEST_ID = '88888888-8888-4888-8888-888888888888'
const SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999'

const createInput = {
  code: 'FEAT-ONE',
  title: 'Explicit Feature',
  problem: 'Known problem',
  outcome: 'Known outcome',
  primaryDomainId: 'DOM-COMMERCE',
}

const receiptBase = {
  receiptId: RECEIPT_ID,
  targetId: PROJECT_ID,
  targetType: 'PROJECT',
  operation: 'CREATE_FEATURE',
  httpMethod: 'POST',
  resourceId: FEATURE_A,
  resourceType: 'PROJECT_FEATURE',
  status: 'COMMITTED',
  version: 1,
  etag: `"PROJECT_FEATURE/${FEATURE_A}/v1"`,
  recordedAt: '2026-09-17T00:00:00.000Z',
  auditRef: AUDIT_ID,
  requestId: REQUEST_ID,
}

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BUSINESS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WORKSPACE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function postgresAuthorityFixture({ sessionExpiresAt, delayedLockIndex = null }) {
  const lockQueries = []
  const receiptLookup = vi.fn().mockResolvedValue(null)
  const auditCreate = vi.fn().mockResolvedValue({ id: AUDIT_ID })
  const receiptCreate = vi.fn().mockResolvedValue({
    id: RECEIPT_ID,
    targetId: PROJECT_ID,
    targetType: 'PROJECT',
    operation: 'CREATE_FEATURE',
    httpMethod: 'POST',
    resourceId: FEATURE_A,
    resourceType: 'PROJECT_FEATURE',
    version: 1,
    etag: `"PROJECT_FEATURE/${FEATURE_A}/v1"`,
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    auditEventId: AUDIT_ID,
  })
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql) => {
      lockQueries.push(sql)
      if (lockQueries.length === delayedLockIndex) vi.advanceTimersByTime(100)
      return [{ id: `lock-${lockQueries.length}` }]
    }),
    session: {
      findUnique: vi.fn().mockResolvedValue({
        id: RECEIPT_ID,
        personId: REQUEST_ID,
        status: 'ACTIVE',
        expiresAt: sessionExpiresAt,
      }),
    },
    person: {
      findUnique: vi.fn().mockResolvedValue({ id: REQUEST_ID, code: 'PSN-TEST', displayName: 'Test Person' }),
    },
    membership: {
      findMany: vi.fn().mockResolvedValue([{
        tenantId: TENANT_ID,
        businessId: BUSINESS_ID,
        scopeType: 'BUSINESS',
        role: 'OWNER',
        status: 'ACTIVE',
        domainKeysJson: '[]',
        expiresAt: null,
        version: 1,
      }]),
    },
    platformGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue({
        id: PROJECT_ID,
        businessId: BUSINESS_ID,
        workspaceId: WORKSPACE_ID,
        deletedAt: null,
      }),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue({
        id: WORKSPACE_ID,
        scopeType: 'BUSINESS',
        tenantId: TENANT_ID,
        businessId: BUSINESS_ID,
        portfolioId: null,
        status: 'ACTIVE',
      }),
    },
    business: {
      findUnique: vi.fn().mockResolvedValue({ id: BUSINESS_ID, tenantId: TENANT_ID, status: 'ACTIVE' }),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({ id: TENANT_ID, portfolioId: null, status: 'ACTIVE' }),
    },
    projectFeature: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    projectFeatureMutationReceipt: {
      findFirst: receiptLookup,
      create: receiptCreate,
    },
    auditEvent: {
      create: auditCreate,
    },
  }
  const repository = {
    dialect: 'postgres',
    withProjectTransaction: async (_options, callback) => callback(
      tx,
      { project: { id: PROJECT_ID }, tenantId: TENANT_ID, businessId: BUSINESS_ID },
    ),
  }
  return { repository, tx, lockQueries, receiptLookup, auditCreate, receiptCreate }
}

async function runAuthorityClockMutation(repository, callback) {
  return runProjectFeatureMutation({
    repository,
    projectId: PROJECT_ID,
    viewer: { principal: { id: REQUEST_ID } },
    session: { state: 'AUTHENTICATED', principalId: REQUEST_ID, sessionId: RECEIPT_ID },
    operation: 'CREATE_FEATURE',
    httpMethod: 'POST',
    targetType: 'PROJECT',
    targetId: PROJECT_ID,
    resourceType: 'PROJECT_FEATURE',
    command: createInput,
    normalize: (value) => value,
    idempotencyKey: 'authority-clock-test',
    requestId: REQUEST_ID,
    callback,
  })
}

describe('Project Feature mutation contract', () => {
  it('requires canonical key and snapshot to be absent together, null together, or present together', () => {
    expect(zFeatureCreateInput.parse(createInput)).toEqual(createInput)
    expect(zFeatureCreateInput.parse({ ...createInput, canonicalFeatureKey: null, governanceSnapshotId: null })).toMatchObject({
      canonicalFeatureKey: null,
      governanceSnapshotId: null,
    })
    expect(() => zFeatureCreateInput.parse({ ...createInput, canonicalFeatureKey: 'feature.one' })).toThrow()
    expect(() => zFeatureCreateInput.parse({ ...createInput, governanceSnapshotId: SNAPSHOT_ID })).toThrow()
    expect(() => zFeatureCreateInput.parse({ ...createInput, canonicalFeatureKey: 'feature.one', governanceSnapshotId: null })).toThrow()
    expect(() => zFeatureCreateInput.parse({ ...createInput, canonicalFeatureKey: undefined, governanceSnapshotId: SNAPSHOT_ID })).toThrow()
    expect(() => zFeatureCreateInput.parse({ ...createInput, canonicalFeatureKey: 'feature.one', governanceSnapshotId: undefined })).toThrow()
  })

  it('rejects duplicate graph members instead of silently normalizing them', () => {
    const base = {
      allocationMode: 'COMPLETE_SPLIT',
      affectedWorkItemIds: [ITEM_A, ITEM_B],
      featureSets: [{ featureId: FEATURE_A, links: [{ workItemId: ITEM_A, allocationBps: 10000 }] }],
    }
    expect(zFeatureWorkGraphInput.parse(base)).toEqual(base)
    expect(() => zFeatureWorkGraphInput.parse({ ...base, affectedWorkItemIds: [ITEM_A, ITEM_A] })).toThrow()
    expect(() => zFeatureWorkGraphInput.parse({
      ...base,
      featureSets: [...base.featureSets, { featureId: FEATURE_A, links: [] }],
    })).toThrow()
  })

  it('validates receipt discriminators and preserves COMMITTED status on replay', () => {
    expect(zMutationReceipt.parse(receiptBase)).toEqual(receiptBase)
    expect(zMutationReceipt.parse({
      ...receiptBase,
      targetId: FEATURE_A,
      targetType: 'FEATURE',
      operation: 'DELETE_FEATURE',
      httpMethod: 'DELETE',
      version: 2,
    })).toMatchObject({ status: 'COMMITTED', operation: 'DELETE_FEATURE' })
    expect(zMutationReceipt.parse({
      ...receiptBase,
      targetId: PROJECT_ID,
      operation: 'CAPTURE_GOVERNANCE_SNAPSHOT',
      resourceId: SNAPSHOT_ID,
      resourceType: 'GOVERNANCE_SNAPSHOT',
      version: null,
    })).toMatchObject({ status: 'COMMITTED', version: null, resourceType: 'GOVERNANCE_SNAPSHOT' })
    expect(() => zMutationReceipt.parse({ ...receiptBase, operation: 'DELETE_FEATURE' })).toThrow()
    expect(() => zMutationReceipt.parse({ ...receiptBase, version: null })).toThrow()
  })

  it('hashes all ProjectFeature tombstone rows deterministically into a quoted graph ETag', () => {
    const rows = [
      { id: FEATURE_B, version: 3, deletedAt: '2026-09-17T00:00:00.000Z' },
      { id: FEATURE_A, version: 2, deletedAt: null },
    ]
    const first = computeProjectFeatureGraphEtag(PROJECT_ID, rows)
    const second = computeProjectFeatureGraphEtag(PROJECT_ID, [...rows].reverse())
    expect(first).toBe(second)
    expect(first).toMatch(new RegExp(`^"PROJECT_FEATURE_GRAPH/${PROJECT_ID}/[a-f0-9]{64}"$`))
    expect(computeProjectFeatureGraphEtag(PROJECT_ID, [{ ...rows[0], version: 4 }, rows[1]])).not.toBe(first)
  })

  it('redacts unknown failures as a retryable service refusal while preserving typed conflicts', () => {
    expect(toPublicProjectFeatureMutationError(new Error('unexpected'))).toMatchObject({
      status: 503, code: 'SESSION_UNAVAILABLE', retryable: true,
    })
    const conflict = new ProjectFeatureMutationError('VERSION_MISMATCH', 412, false, {
      currentVersion: 4,
      currentEtag: `"PROJECT_FEATURE/${FEATURE_A}/v4"`,
    })
    expect(toPublicProjectFeatureMutationError(conflict)).toMatchObject({
      status: 412, code: 'VERSION_MISMATCH', currentVersion: 4, currentEtag: conflict.currentEtag,
    })
    expect(toPublicProjectFeatureMutationError(Object.assign(new Error('foreign project'), {
      code: 'PHASE_B_PROJECT_NOT_FOUND', status: 404,
    }))).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND', retryable: false })
    expect(toPublicProjectFeatureMutationError(Object.assign(new Error('scope binding unavailable'), {
      code: 'PHASE_B_SCOPE_BINDING_UNAVAILABLE', status: 503,
    }))).toMatchObject({ status: 503, code: 'DATA_INTEGRITY_UNAVAILABLE', retryable: true })
  })

  it('reproves a supplied live Session before any mutation callback or receipt lookup', async () => {
    const callback = vi.fn()
    const repository = {
      dialect: 'sqlite',
      withProjectTransaction: async (_options, run) => run(
        { session: { findUnique: vi.fn().mockResolvedValue(null) } },
        { project: { id: PROJECT_ID }, tenantId: 'tenant-a', businessId: 'business-a' },
      ),
    }
    await expect(runProjectFeatureMutation({
      repository,
      projectId: PROJECT_ID,
      viewer: { principal: { id: REQUEST_ID } },
      session: { state: 'AUTHENTICATED', principalId: REQUEST_ID, sessionId: RECEIPT_ID },
      operation: 'CREATE_FEATURE',
      httpMethod: 'POST',
      targetType: 'PROJECT',
      targetId: PROJECT_ID,
      resourceType: 'PROJECT_FEATURE',
      command: createInput,
      idempotencyKey: 'session-proof-test',
      requestId: REQUEST_ID,
      callback,
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 })
    expect(callback).not.toHaveBeenCalled()
  })

  it.each([
    ['Session', 1],
    ['Membership', 2],
    ['PlatformGrant', 3],
  ])('fails closed when the %s authority lock wait crosses Session expiry', async (_authorityRow, delayedLockIndex) => {
    vi.useFakeTimers()
    const baseNow = new Date('2026-09-17T00:00:00.000Z')
    vi.setSystemTime(baseNow)
    const fixture = postgresAuthorityFixture({
      sessionExpiresAt: new Date(baseNow.getTime() + 50),
      delayedLockIndex,
    })
    const callback = vi.fn(async () => ({
      resourceId: FEATURE_A,
      featureId: FEATURE_A,
      version: 1,
      etag: `"PROJECT_FEATURE/${FEATURE_A}/v1"`,
      auditEntityId: FEATURE_A,
    }))

    try {
      await expect(runAuthorityClockMutation(fixture.repository, callback)).rejects.toMatchObject({
        code: 'AUTH_REQUIRED',
        status: 401,
      })
      expect(callback).not.toHaveBeenCalled()
      expect(fixture.receiptLookup).not.toHaveBeenCalled()
      expect(fixture.receiptCreate).not.toHaveBeenCalled()
      expect(fixture.auditCreate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the post-authority-lock clock for the effect context', async () => {
    vi.useFakeTimers()
    const baseNow = new Date('2026-09-17T00:00:00.000Z')
    vi.setSystemTime(baseNow)
    const fixture = postgresAuthorityFixture({
      sessionExpiresAt: new Date(baseNow.getTime() + 1000),
      delayedLockIndex: 1,
    })
    let effectNow = null
    const callback = vi.fn(async (_tx, _scope, context) => {
      effectNow = context.now
      return {
        resourceId: FEATURE_A,
        featureId: FEATURE_A,
        version: 1,
        etag: `"PROJECT_FEATURE/${FEATURE_A}/v1"`,
        auditEntityId: FEATURE_A,
      }
    })

    try {
      const result = await runAuthorityClockMutation(fixture.repository, callback)
      expect(result.receipt.operation).toBe('CREATE_FEATURE')
      expect(callback).toHaveBeenCalledOnce()
      expect(effectNow).toEqual(new Date(baseNow.getTime() + 100))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an invalid direct request id before opening the mutation transaction', async () => {
    const repository = { withProjectTransaction: vi.fn() }
    await expect(runProjectFeatureMutation({
      repository,
      projectId: PROJECT_ID,
      viewer: { principal: { id: REQUEST_ID } },
      operation: 'CREATE_FEATURE',
      httpMethod: 'POST',
      targetType: 'PROJECT',
      targetId: PROJECT_ID,
      resourceType: 'PROJECT_FEATURE',
      command: createInput,
      idempotencyKey: 'request-id-test',
      requestId: 'invalid-request-id',
      callback: vi.fn(),
    })).rejects.toMatchObject({ code: 'MALFORMED_REQUEST', status: 400 })
    expect(repository.withProjectTransaction).not.toHaveBeenCalled()
  })
})
