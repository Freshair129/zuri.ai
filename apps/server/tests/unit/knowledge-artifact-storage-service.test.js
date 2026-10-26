// @req FR-109, FR-173 — object storage lifecycle is scoped, idempotent and
// readback-verified before a raw artifact becomes READY.
// @spec TASK-ZAI-049 storage spec
// @tested src/modules/knowledge/knowledge-artifact-storage-service.js
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { eraseKnowledgeRawArtifact, readKnowledgeRawArtifact, storeKnowledgeRawArtifact } from '@/modules/knowledge/knowledge-artifact-storage-service'
import { createS3ObjectStoragePort } from '@/platform/storage/s3-object-storage'

const scope = { portfolioId: 'portfolio-1', tenantId: 'tenant-1', businessId: 'business-1', workspaceId: 'workspace-1', agentId: 'agent-1', visibility: 'PRIVATE' }

function fakeDb() {
  const storages = new Map()
  const operations = new Map()
  return {
    storages,
    operations,
    knowledgeArtifactStorage: {
      findUnique: vi.fn(async ({ where }) => where.rawArtifactId ? [...storages.values()].find((row) => row.rawArtifactId === where.rawArtifactId) || null : storages.get(where.id) || null),
      create: vi.fn(async ({ data }) => { const row = { id: `storage-${storages.size + 1}`, version: 1, objectVersionId: null, ...data }; storages.set(row.id, row); return row }),
      update: vi.fn(async ({ where, data }) => { const row = storages.get(where.id); const next = { ...row, ...data, version: data.version?.increment ? row.version + data.version.increment : data.version ?? row.version }; storages.set(row.id, next); return next }),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = storages.get(where.id)
        if (!row || Object.entries(where).some(([key, value]) => value?.in ? !value.in.includes(row[key]) : row[key] !== value)) return { count: 0 }
        storages.set(row.id, { ...row, ...data, version: data.version?.increment ? row.version + data.version.increment : row.version })
        return { count: 1 }
      }),
    },
    knowledgeArtifactOperation: {
      findUnique: vi.fn(async ({ where }) => operations.get(where.idempotencyKey) || null),
      create: vi.fn(async ({ data }) => { const row = { id: `op-${operations.size + 1}`, attempts: 0, ...data }; operations.set(row.idempotencyKey, row); return row }),
      update: vi.fn(async ({ where, data }) => { const row = [...operations.values()].find((item) => item.id === where.id); Object.assign(row, data, { attempts: data.attempts?.increment ? row.attempts + data.attempts.increment : row.attempts }); return row }),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = [...operations.values()].find(item => item.id === where.id)
        if (!row || !where.status.in.includes(row.status)) return { count: 0 }
        Object.assign(row, data, { attempts: data.attempts?.increment ? row.attempts + data.attempts.increment : row.attempts })
        return { count: 1 }
      }),
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
    expect([...db.storages.values()][0].objectVersionId).toBe('version-retry')
    expect([...db.operations.values()][0]).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'KNOWLEDGE_STORAGE_TIMEOUT' })

    await expect(storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-retry', content: bytes, bindingId: 'minio-local', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })).resolves.toMatchObject({ status: 'READY', objectVersionId: 'version-retry' })
    expect([...db.operations.values()][0]).toMatchObject({ status: 'READY', attempts: 2 })
    expect(storage.putImmutable).toHaveBeenCalledTimes(1)
  })

  it('reconciles a remotely committed PUT with a lost reply before retrying any write', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('ข้อมูลไทยที่บันทึกแล้ว')
    let committed = false
    const fetchFn = vi.fn(async (url, request) => {
      if (request.method === 'PUT') {
        if (committed) return new Response(null, { status: 412 })
        committed = true
        throw new Error('reply lost after remote commit')
      }
      if (request.method === 'HEAD') return new Response(null, { headers: { 'x-amz-version-id': 'v-committed' } })
      expect(new URL(url).searchParams.get('versionId')).toBe('v-committed')
      return new Response(bytes, { headers: { 'x-amz-version-id': 'v-committed' } })
    })
    const storage = createS3ObjectStoragePort({ endpoint: 'http://storage.test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'knowledge-raw', fetchFn })
    const input = { db, storage, scope, rawArtifactId: 'raw-lost-reply', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_UNAVAILABLE' })
    await expect(storeKnowledgeRawArtifact(input)).resolves.toMatchObject({ status: 'READY', objectVersionId: 'v-committed' })
    expect(fetchFn.mock.calls.filter(([, request]) => request.method === 'PUT')).toHaveLength(1)
    expect(db.storages.size).toBe(1)
    expect([...db.operations.values()][0]).toMatchObject({ status: 'READY', attempts: 2, errorCode: null })
  })

  it.each(['ERASED', 'QUARANTINED'])('never resurrects a %s reference on replay', async (status) => {
    const db = fakeDb()
    const bytes = Buffer.from('same bytes')
    const storage = {
      putImmutable: vi.fn(async ({ key }) => ({ key, versionId: 'v-1' })),
      readExact: vi.fn(async () => ({ bytes, versionId: 'v-1', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })),
    }
    const input = { db, storage, scope, rawArtifactId: 'raw-terminal', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    const row = await storeKnowledgeRawArtifact(input)
    db.storages.set(row.id, { ...row, status })
    storage.putImmutable.mockClear()
    storage.readExact.mockClear()
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_NOT_RESUMABLE' })
    expect(storage.putImmutable).not.toHaveBeenCalled()
    expect(storage.readExact).not.toHaveBeenCalled()
    expect(db.storages.get(row.id).status).toBe(status)
  })

  it('retries an absent object and reconciles a competing immutable writer without overwriting', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('race')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const storage = {
      putImmutable: vi.fn().mockRejectedValueOnce(Object.assign(new Error('outage'), { code: 'KNOWLEDGE_STORAGE_TIMEOUT' }))
        .mockRejectedValueOnce(Object.assign(new Error('winner exists'), { code: 'KNOWLEDGE_STORAGE_OBJECT_EXISTS' })),
      recoverImmutable: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ versionId: 'winner' }),
      readExact: vi.fn(async () => ({ bytes, versionId: 'winner', sha256: digest, byteLength: bytes.length })),
    }
    const input = { db, storage, scope, rawArtifactId: 'raw-race', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_TIMEOUT' })
    await expect(storeKnowledgeRawArtifact(input)).resolves.toMatchObject({ status: 'READY', objectVersionId: 'winner' })
    expect(storage.recoverImmutable).toHaveBeenCalledTimes(2)
    expect(storage.putImmutable).toHaveBeenCalledTimes(2)
    expect(storage.readExact).toHaveBeenCalledWith({ key: expect.any(String), versionId: 'winner' })
  })

  it.each([false, true])('does not overwrite erasure while readback is pending (corrupt=%s)', async (corrupt) => {
    const db = fakeDb()
    const bytes = Buffer.from('erase during read')
    let release
    let reading
    const readStarted = new Promise(resolve => { reading = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const storage = {
      putImmutable: vi.fn(async () => ({ versionId: 'v-erasure' })),
      readExact: vi.fn(async () => {
        reading()
        await gate
        return { bytes, versionId: 'v-erasure', sha256: corrupt ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
      }),
      eraseExactVersions: vi.fn(async () => ({})),
    }
    const pending = storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-erasure-race', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })
    const rejected = expect(pending).rejects.toMatchObject({ code: corrupt ? 'KNOWLEDGE_STORAGE_READBACK_MISMATCH' : 'KNOWLEDGE_STORAGE_CONFLICT' })
    await readStarted
    await eraseKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-erasure-race', authorize: async () => true, reason: 'erase request' })
    release()
    await rejected
    expect([...db.storages.values()][0].status).toBe('ERASED')
    expect([...db.operations.values()].find(row => row.operation === 'PUT').status).not.toBe('READY')
  })

  it('keeps an interrupted erasure fenced until its exact-version retry succeeds', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('erase safely')
    const storage = {
      putImmutable: vi.fn(async () => ({ versionId: 'v-delete' })),
      readExact: vi.fn(async () => ({ bytes, versionId: 'v-delete', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })),
      eraseExactVersions: vi.fn().mockRejectedValueOnce(new Error('delete response lost')).mockResolvedValue({}),
    }
    const input = { db, storage, scope, rawArtifactId: 'raw-erase-retry', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    await storeKnowledgeRawArtifact(input)
    const erase = { db, storage, scope, rawArtifactId: input.rawArtifactId, authorize: async () => true, reason: 'erase request' }
    await expect(eraseKnowledgeRawArtifact(erase)).rejects.toThrow('delete response lost')
    expect([...db.storages.values()][0].status).toBe('ERASURE_PENDING')
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_NOT_RESUMABLE' })
    await expect(readKnowledgeRawArtifact({ ...erase })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_NOT_READY' })
    await expect(eraseKnowledgeRawArtifact(erase)).resolves.toMatchObject({ status: 'ERASED' })
  })

  it('preserves a successful PUT journal when a delayed duplicate fails during erasure', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('duplicate recovery')
    const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
    const firstRead = deferred(), secondRead = deferred(), firstStarted = deferred(), secondStarted = deferred(), deleting = deferred(), finishDelete = deferred()
    let reads = 0
    const storage = {
      putImmutable: vi.fn().mockRejectedValue(Object.assign(new Error('reply lost'), { code: 'KNOWLEDGE_STORAGE_TIMEOUT' })),
      recoverImmutable: vi.fn(async () => ({ versionId: 'v-shared' })),
      readExact: vi.fn(async () => { reads++; if (reads === 1) { firstStarted.resolve(); return firstRead.promise } secondStarted.resolve(); return secondRead.promise }),
      eraseExactVersions: vi.fn(async () => { deleting.resolve(); await finishDelete.promise }),
    }
    const input = { db, storage, scope, rawArtifactId: 'raw-duplicates', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_TIMEOUT' })
    const a = storeKnowledgeRawArtifact(input)
    await firstStarted.promise
    const b = storeKnowledgeRawArtifact(input)
    const bRejected = expect(b).rejects.toThrow('read lost')
    await secondStarted.promise
    firstRead.resolve({ bytes, versionId: 'v-shared', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length })
    await a
    const erasure = eraseKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: input.rawArtifactId, authorize: async () => true, reason: 'erase request' })
    await deleting.promise
    secondRead.reject(new Error('read lost'))
    await bRejected
    const putStatus = [...db.operations.values()].find(row => row.operation === 'PUT').status
    finishDelete.resolve()
    await erasure
    expect(putStatus).toBe('READY')
    expect([...db.storages.values()][0].status).toBe('ERASED')
  })

  it('quarantines the same version when a late duplicate detects corruption after another read succeeded', async () => {
    const db = fakeDb()
    const bytes = Buffer.from('verify both reads')
    let finishGood, finishBad, goodStarted, badStarted
    const goodReady = new Promise(resolve => { goodStarted = resolve })
    const badReady = new Promise(resolve => { badStarted = resolve })
    const goodGate = new Promise(resolve => { finishGood = resolve })
    const badGate = new Promise(resolve => { finishBad = resolve })
    let reads = 0
    const storage = {
      putImmutable: vi.fn().mockRejectedValue(Object.assign(new Error('reply lost'), { code: 'KNOWLEDGE_STORAGE_TIMEOUT' })),
      recoverImmutable: vi.fn(async () => ({ versionId: 'v-integrity' })),
      readExact: vi.fn(async () => {
        const corrupt = ++reads === 2
        if (corrupt) { badStarted(); await badGate } else { goodStarted(); await goodGate }
        return { bytes, versionId: 'v-integrity', sha256: corrupt ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
      }),
    }
    const input = { db, storage, scope, rawArtifactId: 'raw-integrity-race', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} }
    await expect(storeKnowledgeRawArtifact(input)).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_TIMEOUT' })
    const good = storeKnowledgeRawArtifact(input)
    await goodReady
    const bad = storeKnowledgeRawArtifact(input)
    const rejected = expect(bad).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_READBACK_MISMATCH' })
    await badReady
    finishGood()
    await good
    finishBad()
    await rejected
    expect([...db.storages.values()][0].status).toBe('QUARANTINED')
  })

  it.each([false, true])('quarantines corrupted exact reads, including a lying checksum (claimedValid=%s)', async (claimedValid) => {
    const db = fakeDb()
    const bytes = Buffer.from('original raw')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const storage = {
      putImmutable: vi.fn(async () => ({ versionId: 'v-read' })),
      readExact: vi.fn(async () => ({ bytes, versionId: 'v-read', sha256: digest, byteLength: bytes.length })),
    }
    await storeKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-read', content: bytes, bindingId: 'test', bindingRevision: 1, bucket: 'knowledge-raw', policy: {} })
    storage.readExact.mockResolvedValue({ bytes: Buffer.alloc(bytes.length), versionId: 'v-read', sha256: claimedValid ? digest : '0'.repeat(64), byteLength: bytes.length })
    await expect(readKnowledgeRawArtifact({ db, storage, scope, rawArtifactId: 'raw-read', authorize: async () => true })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_INTEGRITY_FAILURE' })
    expect([...db.storages.values()][0].status).toBe('QUARANTINED')
  })
})
