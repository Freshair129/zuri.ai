// @req FR-253, FR-291 — computed PCAT sources use the configured private catalog
// storage path and retain byte-stable managed-blob reads for verified lineage.
// @tested tests/unit/fr253-pricing-catalog-storage.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  assertMayView: vi.fn(),
  createAsset: vi.fn(),
  recordAudit: vi.fn(),
  assertKnowledgeBusinessWritable: vi.fn(),
  resolveKnowledgeRuntimeBinding: vi.fn(),
  admitKnowledge: vi.fn(),
  parseSmartGiftCatalogFile: vi.fn((text) => JSON.parse(text)),
  normalizePricingInput: vi.fn((value) => value),
  pricingHash: vi.fn(() => 'a'.repeat(64)),
  buildPricingCatalogProjection: vi.fn((product, quantity, unitPriceSatang) => ({
    productRecord: { entityType: 'ProductMaster', externalId: `commerce-sku:${product.id}` },
    priceRecord: { entityType: 'PriceListEntry', qty: quantity, unitPriceSatang },
    fileName: 'catalog.json',
  })),
  getActivePricingRuleSet: vi.fn(),
  priceLandedInventoryQuote: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: {} }))
vi.mock('@/modules/inventory', () => ({ assertMayView: (...args) => mocks.assertMayView(...args) }))
vi.mock('@/modules/inventory/domain/inventory-costing', () => ({ weightedAverageUnitCostSatang: vi.fn(() => 100) }))
vi.mock('@/modules/project-manager/application/file-asset-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createManagedBlobFileAsset: (...args) => mocks.createAsset(...args) }
})
vi.mock('@/modules/project-manager/application/audit', () => ({ recordAudit: (...args) => mocks.recordAudit(...args) }))
vi.mock('@/modules/knowledge/knowledge-authorization', () => ({ assertKnowledgeBusinessWritable: (...args) => mocks.assertKnowledgeBusinessWritable(...args) }))
vi.mock('@/modules/knowledge/knowledge-runtime', () => ({ resolveKnowledgeRuntimeBinding: (...args) => mocks.resolveKnowledgeRuntimeBinding(...args) }))
vi.mock('@/modules/knowledge/knowledge-admission-service', () => ({ admitKnowledge: (...args) => mocks.admitKnowledge(...args) }))
vi.mock('@/modules/knowledge/smartgift-catalog-adapter', () => ({
  parseSmartGiftCatalogFile: (...args) => mocks.parseSmartGiftCatalogFile(...args),
  SMARTGIFT_CATALOG_FORMAT: 'SMARTGIFT_CATALOG_V1',
}))
vi.mock('@/modules/commerce/domain/pricing-engine', () => ({
  normalizePricingInput: (...args) => mocks.normalizePricingInput(...args),
  pricingHash: (...args) => mocks.pricingHash(...args),
}))
vi.mock('@/modules/commerce/domain/pricing-catalog-projection', () => ({ buildPricingCatalogProjection: (...args) => mocks.buildPricingCatalogProjection(...args) }))
vi.mock('@/modules/commerce/application/pricing-rules-service', () => ({ getActivePricingRuleSet: (...args) => mocks.getActivePricingRuleSet(...args) }))
vi.mock('@/modules/commerce/application/pricing-inventory-service', () => ({ priceLandedInventoryQuote: (...args) => mocks.priceLandedInventoryQuote(...args) }))

const { admitPricingCatalog } = await import('@/modules/commerce/application/pricing-catalog-service')

const PREVIEW_HASH = 'a'.repeat(64)
const businessId = 'business-1'
const tenantId = 'tenant-1'
const activeRules = { id: 'rules-1', tenantId, businessId, version: 1, rulesHash: 'b'.repeat(64) }
const product = { id: 'product-1', businessId, tenantId, status: 'ACTIVE', itemKind: 'SINGLE', code: 'SKU-1' }
const viewer = makeViewer({ visibleBusinessIds: [businessId], ownedBusinessIds: [businessId], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
const input = {
  businessId,
  productId: product.id,
  expectedRuleSetId: activeRules.id,
  expectedRuleVersion: activeRules.version,
  quantities: [5],
  reason: 'Owner reviewed computed catalog',
  idempotencyKey: 'private-catalog-storage',
  previewHash: PREVIEW_HASH,
}

function makeFetch() {
  const requests = []
  const objects = new Map()
  const fetchFn = vi.fn(async (rawUrl, init) => {
    const url = new URL(rawUrl)
    const method = init.method
    const key = url.pathname
    requests.push({ method, url, init })
    if (method === 'PUT') {
      objects.set(key, Buffer.from(init.body))
      return new Response(null, { status: 200, headers: { 'x-amz-version-id': 'version-1' } })
    }
    if (method === 'GET') {
      const bytes = objects.get(key)
      if (!bytes) return new Response(null, { status: 404 })
      return new Response(bytes, { status: 200, headers: { 'x-amz-version-id': url.searchParams.get('versionId'), 'content-type': 'application/json' } })
    }
    if (method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected object-storage method: ${method}`)
  })
  return { fetchFn, requests, objects }
}

function makeSupabaseFetch() {
  const requests = []
  const objects = new Map()
  const fetchFn = vi.fn(async (rawUrl, init) => {
    const url = new URL(rawUrl)
    const method = init.method
    const basePath = `/storage/v1/object/zuri-knowledge-catalog/`
    requests.push({ method, url, init })
    if (method === 'POST') {
      objects.set(url.pathname, Buffer.from(init.body))
      return new Response(null, { status: 200 })
    }
    if (method === 'GET') {
      const bytes = objects.get(url.pathname)
      if (!bytes) return new Response(null, { status: 404 })
      return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'DELETE') {
      const { prefixes } = JSON.parse(init.body)
      for (const prefix of prefixes) objects.delete(`${basePath}${prefix}`)
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected object-storage method: ${method}`)
  })
  return { fetchFn, requests, objects }
}

function makeDatabase() {
  const calculations = []
  const assetsByCode = new Map()
  const assetsById = new Map()
  let nextCalculationId = 0
  const tx = {
    pricingCalculation: {
      findMany: vi.fn(async ({ where }) => calculations.filter((row) => row.businessId === where.businessId && row.idempotencyKey.startsWith(where.idempotencyKey.startsWith))),
      create: vi.fn(async ({ data }) => {
        const row = { id: `calculation-${++nextCalculationId}`, ...data }
        calculations.push(row)
        return row
      }),
    },
    product: { findFirst: vi.fn(async () => product) },
    stockMovement: { findMany: vi.fn(async () => [{ id: 'receipt-1', quantity: 1, costSatang: 100, occurredAt: new Date('2026-10-01T00:00:00.000Z') }]) },
  }
  const db = {
    $transaction: vi.fn(async (callback) => callback(tx)),
    fileAsset: { findUnique: vi.fn(async ({ where }) => where.code ? assetsByCode.get(where.code) ?? null : assetsById.get(where.id) ?? null) },
  }
  return { db, tx, calculations, assetsByCode, assetsById }
}

describe('FR-253 default pricing catalog storage', () => {
  let state

  beforeEach(() => {
    vi.clearAllMocks()
    state = makeDatabase()
    mocks.getActivePricingRuleSet.mockResolvedValue(activeRules)
    mocks.priceLandedInventoryQuote.mockImplementation(async ({ quantity }) => ({
      ruleSetId: activeRules.id,
      rulesHash: activeRules.rulesHash,
      ruleRevision: activeRules.version,
      input: { quantity, sourceRefs: [{ kind: 'INVENTORY_LEDGER' }] },
      rulesJson: '{}',
      result: { currency: 'THB', unitPriceSatang: 25000, totalPriceSatang: quantity * 25000, evaluatorVersion: 'pricing-v1', inputHash: 'c'.repeat(64) },
    }))
    mocks.createAsset.mockImplementation(async (assetInput) => {
      const asset = { id: 'asset-1', status: 'ACTIVE', deletedAt: null, storageKind: 'MANAGED_BLOB', ...assetInput }
      state.assetsByCode.set(asset.code, asset)
      state.assetsById.set(asset.id, asset)
      return asset
    })
    mocks.admitKnowledge.mockImplementation(async (request, options) => {
      const resolved = await options.fileContentResolver(request.source.fileAssetId, { visibleBusinessIds: [businessId] })
      return { recordCount: JSON.parse(resolved.content.toString('utf8')).length, admittedCount: 1, deniedCount: 0 }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('stores with the private Knowledge store and reads the exact managed-blob version with MinIO-only configuration', async () => {
    const provider = makeFetch()
    vi.stubGlobal('fetch', provider.fetchFn)
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      ZURI_KNOWLEDGE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY: 'fixture-access',
      ZURI_KNOWLEDGE_STORAGE_SECRET_KEY: 'fixture-secret',
      ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local',
    }

    const result = await admitPricingCatalog(input, { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env })

    expect(result).toMatchObject({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED' })
    const put = provider.requests.find((request) => request.method === 'PUT')
    expect(put.url.pathname).toMatch(/^\/zuri-knowledge-local\/knowledge\/raw\/tenant-1\/business-1\/catalog-files\/[a-f0-9]{64}\/[0-9a-f-]+\.json$/)
    expect(put.init.headers['if-none-match']).toBe('*')
    expect(provider.requests.find((request) => request.method === 'GET').url.searchParams.get('versionId')).toBe('version-1')
    const stored = await provider.objects.get(put.url.pathname)
    const asset = state.assetsById.get(result.fileAssetId)
    expect(put.url.origin).toBe('http://minio.test:9000')
    expect(put.url.pathname.split('/')[7]).toBe(result.contentHash)
    expect(asset.blobRef).toBe(`s3://zuri-knowledge-local${put.url.pathname.slice('/zuri-knowledge-local'.length)}?versionId=version-1`)
    expect(asset.sha256).toBe(createHash('sha256').update(stored).digest('hex'))
    expect(result.contentHash).toBe(asset.sha256)
    expect(result.calculationIds).toEqual(state.calculations.map((row) => row.id))
    expect(state.calculations[0]).toMatchObject({ inputProvenance: 'INVENTORY_LEDGER', rulesHash: activeRules.rulesHash, inputHash: 'c'.repeat(64) })
    expect(provider.requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    expect(stored.toString('utf8')).toContain('PriceListEntry')
  })

  it('uses the dedicated Knowledge catalog bucket when private Knowledge storage is disabled', async () => {
    const provider = makeSupabaseFetch()
    vi.stubGlobal('fetch', provider.fetchFn)
    const env = {
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'fixture-service-role',
      ZURI_ASSET_EVIDENCE_BUCKET: 'zuri-evidence',
      ZURI_KNOWLEDGE_CATALOG_BUCKET: 'zuri-knowledge-catalog',
    }

    const result = await admitPricingCatalog(input, { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env })

    expect(result).toMatchObject({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED' })
    expect(provider.requests.map(({ method, url }) => [method, url.pathname])).toEqual(expect.arrayContaining([
      ['POST', expect.stringMatching(/^\/storage\/v1\/object\/zuri-knowledge-catalog\/commerce-pricing\/business-1\//)],
      ['GET', expect.stringMatching(/^\/storage\/v1\/object\/zuri-knowledge-catalog\/commerce-pricing\/business-1\//)],
    ]))
    expect(provider.requests.every(({ url }) => !url.pathname.includes('/zuri-evidence/'))).toBe(true)
    expect(state.assetsById.get(result.fileAssetId).blobRef).toMatch(/^supabase:\/\/zuri-knowledge-catalog\/commerce-pricing\/business-1\//)
  })

  it('fails closed before freezing calculations when neither private nor catalog storage is configured', async () => {
    await expect(admitPricingCatalog(input, { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env: {} }))
      .rejects.toMatchObject({ status: 503 })

    expect(state.db.$transaction).not.toHaveBeenCalled()
    expect(state.tx.pricingCalculation.create).not.toHaveBeenCalled()
    expect(mocks.admitKnowledge).not.toHaveBeenCalled()
    expect(state.assetsById.size).toBe(0)
  })

  it('does not fall back to Supabase when enabled private storage is misconfigured', async () => {
    const provider = makeSupabaseFetch()
    vi.stubGlobal('fetch', provider.fetchFn)
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'fixture-service-role',
      ZURI_ASSET_EVIDENCE_BUCKET: 'zuri-evidence',
      ZURI_KNOWLEDGE_CATALOG_BUCKET: 'zuri-knowledge-catalog',
    }

    await expect(admitPricingCatalog(input, { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env }))
      .rejects.toMatchObject({ status: 503, code: 'KNOWLEDGE_STORAGE_CONFIG_INVALID' })

    expect(provider.requests).toHaveLength(0)
    expect(state.db.$transaction).not.toHaveBeenCalled()
    expect(state.tx.pricingCalculation.create).not.toHaveBeenCalled()
  })

  it('reuses the exact frozen asset and performs no duplicate object write on retry', async () => {
    const provider = makeFetch()
    vi.stubGlobal('fetch', provider.fetchFn)
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      ZURI_KNOWLEDGE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY: 'fixture-access',
      ZURI_KNOWLEDGE_STORAGE_SECRET_KEY: 'fixture-secret',
      ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local',
    }
    const options = { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env }

    const first = await admitPricingCatalog(input, options)
    const retry = await admitPricingCatalog(input, options)

    expect(retry.fileAssetId).toBe(first.fileAssetId)
    expect(retry.contentHash).toBe(first.contentHash)
    expect(retry.calculationIds).toEqual(first.calculationIds)
    expect(provider.requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    expect(state.tx.pricingCalculation.create).toHaveBeenCalledTimes(1)
    expect(mocks.createAsset).toHaveBeenCalledTimes(1)
  })

  it('reads a legacy evidence-bucket PCAT ref on retry while MinIO remains the selected writer', async () => {
    const now = new Date('2026-10-10T00:00:00.000Z')
    const projection = mocks.buildPricingCatalogProjection(product, input.quantities[0], 25000, now)
    const content = Buffer.from(JSON.stringify([projection.productRecord, projection.priceRecord]), 'utf8')
    const contentHash = createHash('sha256').update(content).digest('hex')
    const requestKey = 'a'.repeat(64)
    const legacyAsset = {
      id: 'legacy-asset', code: `PCAT-${requestKey}`, businessId, tenantId,
      status: 'ACTIVE', deletedAt: null, storageKind: 'MANAGED_BLOB',
      sha256: contentHash, blobRef: 'supabase://zuri-evidence/commerce-pricing/business-1/legacy.json',
    }
    state.assetsByCode.set(legacyAsset.code, legacyAsset)
    state.assetsById.set(legacyAsset.id, legacyAsset)
    state.calculations.push({
      id: 'calculation-existing', tenantId, businessId, ruleSetId: activeRules.id,
      ruleVersion: activeRules.version, rulesHash: activeRules.rulesHash,
      inputProvenance: 'INVENTORY_LEDGER', requestHash: requestKey,
      idempotencyKey: `catalog:${requestKey}:5`,
      resultJson: JSON.stringify({
        currency: 'THB', unitPriceSatang: 25000, totalPriceSatang: 125000,
        evaluatorVersion: 'pricing-v1', inputHash: 'c'.repeat(64), catalogProjection: projection,
      }),
    })
    const requests = []
    const fetchFn = vi.fn(async (rawUrl, init) => {
      const url = new URL(rawUrl)
      requests.push({ url, method: init.method })
      if (url.origin === 'https://supabase.test' && init.method === 'GET') return new Response(content, { status: 200 })
      throw new Error(`Unexpected storage request: ${init.method} ${url.origin}${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchFn)
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      ZURI_KNOWLEDGE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY: 'fixture-access',
      ZURI_KNOWLEDGE_STORAGE_SECRET_KEY: 'fixture-secret',
      ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local',
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'fixture-service-role',
      ZURI_ASSET_EVIDENCE_BUCKET: 'zuri-evidence',
      ZURI_KNOWLEDGE_CATALOG_BUCKET: 'zuri-knowledge-catalog',
    }

    const result = await admitPricingCatalog(input, { viewer, db: state.db, now, env })

    expect(result).toMatchObject({ fileAssetId: 'legacy-asset', contentHash, calculationIds: ['calculation-existing'] })
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url.pathname).toBe('/storage/v1/object/zuri-evidence/commerce-pricing/business-1/legacy.json')
    expect(mocks.createAsset).not.toHaveBeenCalled()
    expect(state.tx.pricingCalculation.create).not.toHaveBeenCalled()
  })

  it('removes the exact uploaded version after metadata failure and retries from frozen calculations', async () => {
    const provider = makeFetch()
    vi.stubGlobal('fetch', provider.fetchFn)
    mocks.createAsset.mockRejectedValueOnce(new Error('file metadata insert failed'))
    const env = {
      ZURI_KNOWLEDGE_STORAGE_ENABLED: '1',
      ZURI_KNOWLEDGE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      ZURI_KNOWLEDGE_STORAGE_ACCESS_KEY: 'fixture-access',
      ZURI_KNOWLEDGE_STORAGE_SECRET_KEY: 'fixture-secret',
      ZURI_KNOWLEDGE_STORAGE_BUCKET: 'zuri-knowledge-local',
    }
    const options = { viewer, db: state.db, now: new Date('2026-10-10T00:00:00.000Z'), env }

    await expect(admitPricingCatalog(input, options)).rejects.toThrow('file metadata insert failed')
    const put = provider.requests.find((request) => request.method === 'PUT')
    const deletion = provider.requests.find((request) => request.method === 'DELETE')
    expect(deletion.url.pathname).toBe(put.url.pathname)
    expect(deletion.url.searchParams.get('versionId')).toBe('version-1')
    expect(provider.objects.has(put.url.pathname)).toBe(false)

    const retry = await admitPricingCatalog(input, options)
    expect(retry).toMatchObject({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED' })
    expect(state.tx.pricingCalculation.create).toHaveBeenCalledTimes(1)
    expect(provider.requests.filter((request) => request.method === 'PUT')).toHaveLength(2)
    expect(mocks.createAsset).toHaveBeenCalledTimes(2)
  })
})
