// @req FR-109, FR-173 — object storage lifecycle is scoped, idempotent and
// readback-verified before a raw artifact becomes READY.
// @spec TASK-ZAI-049 storage spec
// @tested src/modules/knowledge/knowledge-artifact-storage-service.js
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { eraseKnowledgeRawArtifact, readKnowledgeRawArtifact, storeKnowledgeRawArtifact } from '@/modules/knowledge/knowledge-artifact-storage-service'

const scope = { portfolioId: 'portfolio-1', tenantId: 'tenant-1', businessId: 'business-1', workspaceId: 'workspace-1', agentId: 'agent-1', visibility: 'PRIVATE' }

function fakeDb() {
  const storages = new Map()
  const operations = new Map()
  return {
    storages,
    operations,
    knowledgeArtifactStorage: {
      findUnique: vi.fn(async ({ where }) => where.rawArtifactId ? [...storages.values()].find((row) => row.rawArtifactId === where.rawArtifactId) || null : storages.get(where.id) || null),
      create: vi.fn(async ({ data }) => { const row = { id: `storage-${storages.size + 1}`, ...data }; storages.set(row.id, row); return row }),
      update: vi.fn(async ({ where, data }) => { const row = storages.get(where.id); const next = { ...row, ...data, version: data.version?.increment ? row.version + data.version.increment : data.version ?? row.version }; storages.set(row.id, next); return next }),
    },
    knowledgeArtifactOperation: {
      findUnique: vi.fn(async ({ where }) => operations.get(where.idempotencyKey) || null),
      create: vi.fn(async ({ data }) => { const row = { id: `op-${operations.size + 1}`, attempts: 0, ...data }; operations.set(row.idempotencyKey, row); return row }),
      update: vi.fn(async ({ where, data }) => { const row = [...operations.values()].find((item) => item.id === where.id); Object.assign(row, data, { attempts: data.attempts?.increment ? row.attempts + data.attempts.increment : row.attempts }); return row }),
    },
  }
}

describe('TASK-ZAI-049 artifact storage service', () => {
  it('uploads, reads back and commits one READY exact-version reference', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('ใบเสร็จ\nราคา 10', 'utf8')
    const storage = {
      putImmutable: vi.fn(async ({ key, content, expectedSha256 }) => ({ key, versionId: 'version-1', sha256: expectedSha256, byteLength: content.length })),
      readExact: vi.fn(async ({ versionId }) => ({ bytes, versionId, sha256: '0'.repeat(64), byteLength: bytes.length })),
    }
    const expected = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(bytes).digest('hex'))
    storage.readExact.mockResolvedValue({ bytes, versionId: 'version-1', sha256: expected, byteLength: bytes.length })
    const row = await storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-1', content: bytes, contentType: 'text/plain', bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: { retention: '365d' } })
    expect(row).toMatchObject({ rawArtifactId: 'raw-1', status: 'READY', objectVersionId: 'version-1', sha256: expected, byteLength: bytes.length })
    expect(storage.putImmutable).toHaveBeenCalledTimes(1)
    await expect(readKnowledgeRawArtifact({ db, storage, rawArtifactId: 'raw-1', scope, authorize: async () => true })).resolves.toMatchObject({ bytes, rawArtifactId: 'raw-1' })
  })

  it('rejects cross-business reads and erases only after explicit authorization/reason', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('raw')
    const storage = { putImmutable: vi.fn(async ({ key, expectedSha256, content }) => ({ key, versionId: 'version-1', sha256: expectedSha256, byteLength: content.length })), readExact: vi.fn(async ({ versionId }) => ({ bytes, versionId, sha256: 'a'.repeat(64), byteLength: bytes.length })), eraseExactVersions: vi.fn().mockResolvedValue({}) }
    const crypto = await import('node:crypto')
    storage.readExact.mockResolvedValue({ bytes, versionId: 'version-1', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })
    await storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-2', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })
    await expect(readKnowledgeRawArtifact({ db, storage, rawArtifactId: 'raw-2', scope: { ...scope, businessId: 'business-elsewhere' }, authorize: async () => true })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_SCOPE_DENIED' })
    await expect(eraseKnowledgeRawArtifact({ db, storage, rawArtifactId: 'raw-2', scope, authorize: async () => false, reason: 'approved erasure' })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_ERASURE_DENIED' })
    await expect(eraseKnowledgeRawArtifact({ db, storage, rawArtifactId: 'raw-2', scope, authorize: async () => true, reason: 'approved erasure' })).resolves.toMatchObject({ status: 'ERASED' })
    expect(storage.eraseExactVersions).toHaveBeenCalledWith({ key: expect.any(String), versionIds: ['version-1'] })
  })

  it('quarantines a reference on readback corruption', async () => {
    const db = fakeDb()
    const storage = { putImmutable: vi.fn(async ({ key, expectedSha256, content }) => ({ key, versionId: 'version-1', sha256: expectedSha256, byteLength: content.length })), readExact: vi.fn(async ({ versionId }) => ({ bytes: Buffer.from('different'), versionId, sha256: 'b'.repeat(64), byteLength: 9 })) }
    await expect(storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-3', content: Buffer.from('raw'), bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_READBACK_MISMATCH' })
    expect([...db.storages.values()][0].status).toBe('QUARANTINED')
  })

  it('retries the same immutable content idempotently without overwriting a READY version', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('same bytes')
    const storage = {
      putImmutable: vi.fn(async ({ key, expectedSha256, content }) => ({ key, versionId: 'version-stable', sha256: expectedSha256, byteLength: content.length })),
      readExact: vi.fn(async ({ versionId }) => ({ bytes, versionId, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })),
    }
    const first = await storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-idempotent', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })
    const second = await storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-idempotent', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })
    expect(second).toMatchObject({ id: first.id, status: 'READY', objectVersionId: 'version-stable' })
    expect(storage.putImmutable).toHaveBeenCalledTimes(1)
    expect(db.operations.size).toBe(1)
  })

  it('leaves a pending reference and failed operation for a retry after readback outage', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('retry me')
    const storage = {
      putImmutable: vi.fn(async ({ key, expectedSha256, content }) => ({ key, versionId: 'version-retry', sha256: expectedSha256, byteLength: content.length })),
      readExact: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('storage timeout'), { code: 'KNOWLEDGE_STORAGE_TIMEOUT' }))
        .mockImplementation(async ({ versionId }) => ({ bytes, versionId, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })),
    }
    await expect(storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-retry', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_TIMEOUT' })
    expect([...db.storages.values()][0]).toMatchObject({ status: 'PENDING' })
    expect([...db.storages.values()][0].objectVersionId ?? null).toBeNull()
    expect([...db.operations.values()][0]).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'KNOWLEDGE_STORAGE_TIMEOUT' })

    await expect(storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-retry', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })).resolves.toMatchObject({ status: 'READY', objectVersionId: 'version-retry' })
    expect([...db.operations.values()][0]).toMatchObject({ status: 'READY', attempts: 2 })
  })
})
