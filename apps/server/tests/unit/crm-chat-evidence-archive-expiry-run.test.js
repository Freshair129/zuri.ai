import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-245, SEC-034 — stable, per-Tenant archive expiry and one counts-only
//   run audit, with production storage admitted before Tenant work (ADR-093 D5 P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-chat-evidence-archive-expiry-run.test.js
const mocks = vi.hoisted(() => ({ expire: vi.fn(), resolveDir: vi.fn(), assertReady: vi.fn() }))
vi.mock('@/modules/crm/chat-evidence-archive-expiry-service', () => ({ expireChatEvidenceArchive: mocks.expire }))
vi.mock('@/modules/crm/chat-evidence-archive-service', () => ({
  resolveArchiveBaseDir: mocks.resolveDir,
  assertArchiveStorageReady: mocks.assertReady,
}))

import { runChatEvidenceArchiveExpiry } from '@/modules/crm/chat-evidence-archive-expiry-run-service'

function fakeDb() {
  return {
    archiveManifest: { findMany: vi.fn().mockResolvedValue([{ tenantId: 'tenant-b' }, { tenantId: 'tenant-a' }]) },
    customerArchiveKey: { findMany: vi.fn().mockResolvedValue([{ tenantId: 'tenant-c' }, { tenantId: 'tenant-b' }]) },
    legalHoldArchiveKey: { findMany: vi.fn().mockResolvedValue([{ tenantId: 'tenant-a' }, { tenantId: null }]) },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'run-audit', ...data })) },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolveDir.mockReturnValue('/test-archive')
  mocks.assertReady.mockResolvedValue('/archive')
})
afterEach(() => vi.unstubAllEnvs())

describe('runChatEvidenceArchiveExpiry', () => {
  it('visits the sorted union of archive/key Tenants, continues after failure, and reports broken-chain skips without identifiers or paths', async () => {
    const db = fakeDb()
    mocks.expire.mockImplementation(async (_db, { tenantId }) => {
      if (tenantId === 'tenant-b') throw Object.assign(new Error('private customer/file detail'), { code: 'P1001' })
      if (tenantId === 'tenant-c') return {
        skipped: true,
        chainIntegrity: { valid: false, reason: 'MANIFEST_HASH_MISMATCH', brokenAtManifestId: 'manifest-private' },
        destroyedKeys: [], destroyedHoldKeys: [], retiredManifestIds: [], deletedFiles: [], retiredFilesStillPresent: [],
      }
      return {
        skipped: false,
        destroyedKeys: ['customer-private'],
        destroyedHoldKeys: ['hold-private'],
        retiredManifestIds: [],
        deletedFiles: [],
        retiredFilesStillPresent: ['file-still-private'],
        retirementFailureReason: 'ARCHIVE_RETIREMENT_FAILED',
      }
    })

    const result = await runChatEvidenceArchiveExpiry(db, { now: new Date('2026-11-13T00:00:00.000Z'), env: { NODE_ENV: 'test' } })

    expect(mocks.expire.mock.calls.map(([, options]) => options.tenantId)).toEqual(['tenant-a', 'tenant-b', 'tenant-c'])
    expect(result.counts).toEqual({
      tenantsVisited: 3, keysDestroyed: 1, holdKeysDestroyed: 1, manifestsRetired: 0,
      filesDeleted: 0, retiredFilesAlreadyAbsent: 0, retiredFilesStillPresent: 1, skipped: 1, failures: 2,
      tenantsDeferred: 0,
    })
    const auditData = db.auditEvent.create.mock.calls[0][0].data
    expect(auditData).toMatchObject({ entityType: 'ARCHIVE_EXPIRY_RUN', action: 'ARCHIVE_EXPIRY_RUN_COMPLETED', tenantId: null })
    const payload = JSON.parse(auditData.payloadJson)
    expect(payload.tenants).toEqual([
      { tenantId: 'tenant-a', keysDestroyed: 1, holdKeysDestroyed: 1, manifestsRetired: 0, filesDeleted: 0, retiredFilesAlreadyAbsent: 0, retiredFilesStillPresent: 1, skippedReason: null, failureCode: 'ARCHIVE_RETIREMENT_FAILED' },
      { tenantId: 'tenant-b', keysDestroyed: 0, holdKeysDestroyed: 0, manifestsRetired: 0, filesDeleted: 0, retiredFilesAlreadyAbsent: 0, retiredFilesStillPresent: 0, skippedReason: null, failureCode: 'ARCHIVE_EXPIRY_TENANT_FAILED' },
      { tenantId: 'tenant-c', keysDestroyed: 0, holdKeysDestroyed: 0, manifestsRetired: 0, filesDeleted: 0, retiredFilesAlreadyAbsent: 0, retiredFilesStillPresent: 0, skippedReason: 'MANIFEST_HASH_MISMATCH', failureCode: null },
    ])
    expect(payload.timedOut).toBe(false)
    expect(JSON.stringify(payload)).not.toMatch(/customer-private|manifest-private|file-path-private|file-still-private|private detail/i)
  })

  it('checks production storage once before querying or expiring any Tenant and writes no run audit on refusal', async () => {
    const db = fakeDb()
    vi.stubEnv('NODE_ENV', 'production')
    mocks.assertReady.mockRejectedValue(Object.assign(new Error('storage unavailable'), { code: 'ARCHIVE_STORAGE_REQUIRED' }))

    await expect(runChatEvidenceArchiveExpiry(db)).rejects.toMatchObject({ code: 'ARCHIVE_STORAGE_REQUIRED' })

    expect(mocks.assertReady).toHaveBeenCalledTimes(1)
    expect(db.archiveManifest.findMany).not.toHaveBeenCalled()
    expect(mocks.expire).not.toHaveBeenCalled()
    expect(db.auditEvent.create).not.toHaveBeenCalled()
  })

  it('defers every Tenant when its injectable deadline is already past and audits the timeout', async () => {
    const db = fakeDb()
    const result = await runChatEvidenceArchiveExpiry(db, {
      now: new Date('2026-11-13T00:00:00.000Z'),
      deadlineAt: new Date(0),
      env: { NODE_ENV: 'test' },
    })

    expect(mocks.expire).not.toHaveBeenCalled()
    expect(result.counts).toMatchObject({ tenantsVisited: 0, tenantsDeferred: 3 })
    const payload = JSON.parse(db.auditEvent.create.mock.calls[0][0].data.payloadJson)
    expect(payload.timedOut).toBe(true)
    expect(payload.counts.tenantsDeferred).toBe(3)
    expect(payload.tenants).toEqual([])
  })
})
