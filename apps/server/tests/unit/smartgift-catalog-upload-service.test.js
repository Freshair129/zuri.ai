// @req FR-187 — catalog JSON uploaded from the Knowledge intake is validated
// before storage, stored on the private knowledge store, and admitted with the
// structured format.
// @tested tests/unit/smartgift-catalog-upload-service.test.js
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createManagedBlobFileAsset = vi.fn()
vi.mock('@/modules/project-manager/application/file-asset-service', () => ({
  createManagedBlobFileAsset: (...args) => createManagedBlobFileAsset(...args),
  resolveFileAssetContent: vi.fn(),
}))
const assertKnowledgeBusinessWritable = vi.fn()
vi.mock('@/modules/knowledge/knowledge-authorization', () => ({
  assertKnowledgeBusinessWritable: (...args) => assertKnowledgeBusinessWritable(...args),
}))

const { uploadSmartGiftCatalogFile } = await import('@/modules/knowledge/smartgift-catalog-upload-service')
const {
  createConfiguredKnowledgeManagedBlobPort,
  isKnowledgeManagedBlobRef,
  knowledgeManagedBlobRef,
  parseKnowledgeManagedBlobRef,
} = await import('@/platform/storage/s3-object-storage')

const fixture = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/genesisrag17/smartgift-catalog/products.json'))
const base64 = fixture.toString('base64')
const sha = createHash('sha256').update(fixture).digest('hex')

function memoryStorage() {
  const objects = new Map()
  return {
    objects,
    put: vi.fn(async ({ key, content }) => { const ref = `s3://knowledge/${key}?versionId=v1`; objects.set(ref, Buffer.from(content)); return { ref } }),
    get: vi.fn(async ({ ref }) => objects.get(ref)),
    remove: vi.fn(async ({ ref }) => { objects.delete(ref) }),
  }
}

function fakeDb(existing = null) {
  return {
    fileAsset: { findFirst: vi.fn(async () => existing) },
    business: { findUnique: vi.fn(async ({ where }) => (where.id === 'biz-1' ? { tenantId: 'tenant-1' } : null)) },
  }
}

const viewer = { principal: { id: 'user-1' } }
const admission = { format: 'SMARTGIFT_CATALOG_V1', recordCount: 5, admittedCount: 5, unchangedCount: 0, deniedCount: 0 }

beforeEach(() => {
  createManagedBlobFileAsset.mockReset()
  assertKnowledgeBusinessWritable.mockReset()
  createManagedBlobFileAsset.mockImplementation(async (input) => ({ id: 'asset-new', ...input }))
})

describe('uploadSmartGiftCatalogFile', () => {
  it('stores the bytes, creates a managed blob and admits it with the structured format', async () => {
    const storage = memoryStorage()
    const admit = vi.fn(async () => admission)
    const result = await uploadSmartGiftCatalogFile(
      { businessId: 'biz-1', name: 'products.json', contentBase64: base64 },
      { db: fakeDb(), viewer, objectStoragePort: storage, admit },
    )
    expect(assertKnowledgeBusinessWritable).toHaveBeenCalledWith(viewer, 'biz-1', expect.anything())
    expect(storage.put).toHaveBeenCalledTimes(1)
    const put = storage.put.mock.calls[0][0]
    // The store's application credential may write only under knowledge/raw/<tenant>/<business>/.
    expect(put.key).toMatch(new RegExp(`^knowledge/raw/tenant-1/biz-1/catalog-files/${sha}/[0-9a-f-]+\\.json$`))
    expect(Buffer.compare(put.content, fixture)).toBe(0)
    expect(createManagedBlobFileAsset.mock.calls[0][0]).toMatchObject({
      businessId: 'biz-1', name: 'products.json', mime: 'application/json', size: fixture.length, sha256: sha, blobRef: `s3://knowledge/${put.key}?versionId=v1`,
    })
    expect(admit.mock.calls[0][0]).toEqual({
      businessId: 'biz-1', projectId: null, idempotencyKey: 'smartgift-catalog-upload:asset-new',
      source: { kind: 'FILE', fileAssetId: 'asset-new', format: 'SMARTGIFT_CATALOG_V1' },
    })
    expect(result).toMatchObject({ fileAssetId: 'asset-new', sha256: sha, recordCount: 5, reused: false, admission })
  })

  it('refuses a file that is not a SmartGift catalog before storing anything', async () => {
    const storage = memoryStorage()
    const admit = vi.fn()
    const bad = Buffer.from(JSON.stringify([{ entityType: 'CustomerOrder' }])).toString('base64')
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'x.json', contentBase64: bad }, { db: fakeDb(), viewer, objectStoragePort: storage, admit }))
      .rejects.toMatchObject({ status: 422, code: 'KNOWLEDGE_STRUCTURED_RECORD_INVALID' })
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'x.json', contentBase64: Buffer.from('not json').toString('base64') }, { db: fakeDb(), viewer, objectStoragePort: storage, admit }))
      .rejects.toMatchObject({ status: 422 })
    expect(storage.put).not.toHaveBeenCalled()
    expect(admit).not.toHaveBeenCalled()
  })

  it('requires a .json name and write authority', async () => {
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'x.md', contentBase64: base64 }, { db: fakeDb(), viewer, objectStoragePort: memoryStorage(), admit: vi.fn() })).rejects.toThrow()
    assertKnowledgeBusinessWritable.mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }))
    const storage = memoryStorage()
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'x.json', contentBase64: base64 }, { db: fakeDb(), viewer, objectStoragePort: storage, admit: vi.fn() })).rejects.toMatchObject({ status: 403 })
    expect(storage.put).not.toHaveBeenCalled()
  })

  it('reuses an active managed blob with the same bytes instead of storing a copy', async () => {
    const storage = memoryStorage()
    const admit = vi.fn(async () => admission)
    const result = await uploadSmartGiftCatalogFile(
      { businessId: 'biz-1', name: 'products.json', contentBase64: base64 },
      { db: fakeDb({ id: 'asset-old', name: 'products.json' }), viewer, objectStoragePort: storage, admit },
    )
    expect(storage.put).not.toHaveBeenCalled()
    expect(createManagedBlobFileAsset).not.toHaveBeenCalled()
    expect(result).toMatchObject({ fileAssetId: 'asset-old', reused: true })
  })

  it('removes the stored object when the FileAsset cannot be created', async () => {
    const storage = memoryStorage()
    createManagedBlobFileAsset.mockRejectedValueOnce(new Error('db down'))
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'products.json', contentBase64: base64 }, { db: fakeDb(), viewer, objectStoragePort: storage, admit: vi.fn() })).rejects.toThrow('db down')
    expect(storage.remove).toHaveBeenCalledTimes(1)
    expect(storage.objects.size).toBe(0)
  })

  it('refuses an unsafe key segment rather than build a path from it', async () => {
    const { catalogObjectKey } = await import('@/modules/knowledge/smartgift-catalog-upload-service')
    expect(() => catalogObjectKey({ tenantId: '../x', businessId: 'biz-1', sha256: sha })).toThrow()
    expect(catalogObjectKey({ tenantId: 'tenant-1', businessId: 'biz-1', sha256: sha })).toMatch(/^knowledge\/raw\/tenant-1\/biz-1\/catalog-files\//)
  })

  it('refuses when the private knowledge store is not enabled', async () => {
    await expect(uploadSmartGiftCatalogFile({ businessId: 'biz-1', name: 'products.json', contentBase64: base64 }, { db: fakeDb(), viewer, env: {}, admit: vi.fn() }))
      .rejects.toMatchObject({ status: 503, code: 'KNOWLEDGE_STORAGE_UNAVAILABLE' })
  })
})

describe('knowledge managed blob refs', () => {
  it('round-trips a versioned ref and recognises only the knowledge bucket', () => {
    const ref = knowledgeManagedBlobRef({ bucket: 'zuri-knowledge-local', key: 'smartgift-catalog/b/s/u.json', versionId: 'a/b+c' })
    expect(parseKnowledgeManagedBlobRef(ref)).toEqual({ bucket: 'zuri-knowledge-local', key: 'smartgift-catalog/b/s/u.json', versionId: 'a/b+c' })
    const env = { ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local' }
    expect(isKnowledgeManagedBlobRef(ref, env)).toBe(true)
    expect(isKnowledgeManagedBlobRef('supabase://knowledge-catalog/x.json', env)).toBe(false)
    expect(isKnowledgeManagedBlobRef(ref, {})).toBe(false)
    expect(() => parseKnowledgeManagedBlobRef('s3://bucket/key-without-version')).toThrow()
  })

  it('is null unless the private knowledge store is enabled', () => {
    expect(createConfiguredKnowledgeManagedBlobPort({})).toBeNull()
  })

  it('puts immutably, reads the exact version back and erases only that version', async () => {
    const calls = []
    const fetchFn = vi.fn(async (url, init) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers })
      if (init.method === 'PUT') return new Response(null, { status: 200, headers: { 'x-amz-version-id': 'ver-1' } })
      if (init.method === 'GET') return new Response(fixture, { status: 200, headers: { 'x-amz-version-id': 'ver-1', 'content-type': 'application/json' } })
      return new Response(null, { status: 204 })
    })
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      ZURI_KNOWLEDGE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY: 'a',
      ZURI_KNOWLEDGE_STORAGE_SECRET_KEY: 'b',
      ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local',
    }
    const port = createConfiguredKnowledgeManagedBlobPort(env, { fetchFn })
    const { ref } = await port.put({ key: 'smartgift-catalog/biz/sha/u.json', content: fixture, mime: 'application/json' })
    expect(ref).toBe('s3://zuri-knowledge-local/smartgift-catalog/biz/sha/u.json?versionId=ver-1')
    expect(calls[0].headers['if-none-match']).toBe('*')
    expect(Buffer.compare(Buffer.from(await port.get({ ref })), fixture)).toBe(0)
    expect(calls[1].url).toContain('versionId=ver-1')
    await port.remove({ ref })
    expect(calls[2].method).toBe('DELETE')
    expect(calls[2].url).toContain('versionId=ver-1')
    await expect(port.get({ ref: 's3://other-bucket/k?versionId=v' })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_REF_INVALID' })
  })
})
