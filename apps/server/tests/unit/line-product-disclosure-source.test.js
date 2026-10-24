import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
  smartGiftSourceKey,
  splitSmartGiftCatalogRecords,
} from '@/modules/knowledge/smartgift-catalog-adapter'
import { hashGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'

const modulePath = '@/modules/knowledge/line-product-disclosure-source'
const sourcePromise = import(modulePath).catch(() => null)
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const tenantId = id(1)
const businessId = id(2)
const accountId = id(3)
const productId = id(4)

function requireResolver(module) {
  expect(typeof module?.resolveLineProductDisclosureSource).toBe('function')
  return module.resolveLineProductDisclosureSource
}

function productRecord(externalId, { nameTh = 'Mug model', ...overrides } = {}) {
  return {
    entityType: 'ProductMaster', externalId, code: externalId, nameTh,
    nameEn: 'Mug', category: 'Drinkware', productFamily: 'Ceramic',
    flowaccountModelCode: 'private-model-code',
    dimensionsCm: { height: 10, length: 20, width: 3 }, unitWeightKg: 0.25,
    srpPriceThbQty1: 98765, priceTiersThb: [], catalogVersionDate: null,
    provenance: { upstreamFile: 'private-provenance-file', upstreamRecordId: 'private-source-record' },
    ...overrides,
  }
}

function fixture({ multipleRows = false } = {}) {
  const first = productRecord('vendor-product-17', { nameTh: multipleRows ? 'Sibling private name' : 'Mug model' })
  const second = multipleRows ? productRecord('vendor-product-42') : first
  const sourceRecord = multipleRows ? second : first
  const content = JSON.stringify(multipleRows ? [first, second] : [first])
  const asset = {
    id: id(5), tenantId, businessId, projectId: null, code: `PCAT-${'a'.repeat(64)}`,
    name: 'products.json', mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
    size: Buffer.byteLength(content), sha256: sha256(content), version: 2,
    status: 'ACTIVE', deletedAt: null, storageKind: 'MANAGED_BLOB', blobRef: 'private-blob-location',
  }
  const split = splitSmartGiftCatalogRecords({ content, fileAssetId: asset.id, fileSha256: asset.sha256, fileName: asset.name })
  const admitted = split.records.find((row) => row.externalId === sourceRecord.externalId)
  const sourceId = id(6)
  const ingestionId = id(7)
  const source = {
    id: sourceId, corpusId: id(8), sourceKey: smartGiftSourceKey({ fileName: asset.name, recordCode: sourceRecord.externalId }),
    kind: 'FILE', title: `ProductMaster ${sourceRecord.externalId}`, fileAssetId: asset.id,
    activeIngestionId: ingestionId, desiredRevision: 3, version: 4, revokedAt: null, deletedAt: null,
  }
  const descriptor = {
    format: SMARTGIFT_CATALOG_FORMAT, provider: SMARTGIFT_CATALOG_PROVIDER,
    entityType: 'ProductMaster', contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
    externalId: sourceRecord.externalId, recordIndex: multipleRows ? 1 : 0,
    recordCount: split.recordCount, fileSha256: asset.sha256,
  }
  const sourceMeta = {
    kind: 'FILE', title: source.title, sourceKey: source.sourceKey, fileAssetId: asset.id,
    fileAssetVersion: asset.version, mime: asset.mime, size: Buffer.byteLength(admitted.content),
    storageKind: asset.storageKind, sourceVersion: asset.sha256, contentHash: admitted.contentHash,
    structured: descriptor,
  }
  const ingestion = {
    id: ingestionId, corpusId: source.corpusId, sourceId: source.id,
    status: 'PUBLISHED', revision: source.desiredRevision, sourceVersion: asset.sha256,
    contentHash: admitted.contentHash, content: admitted.content,
    executionRunId: id(9), snapshotId: 'snapshot-1', snapshotGeneration: 'generation-1',
    receiptHash: 'b'.repeat(64), rawArtifactId: 'raw-artifact-1', parsedArtifactId: 'parsed-artifact-1',
    sourceMetaJson: JSON.stringify(sourceMeta),
  }
  const entry = {
    scope: { tenantId, businessId }, title: source.title, sourceId: source.id,
    ingestionId: ingestion.id, fileAssetId: asset.id, revision: ingestion.revision,
    sourceVersion: ingestion.sourceVersion, contentHash: ingestion.contentHash,
    executionRunId: ingestion.executionRunId, snapshotId: ingestion.snapshotId,
    generation: ingestion.snapshotGeneration, receiptHash: ingestion.receiptHash,
    rawArtifactId: ingestion.rawArtifactId, parsedArtifactId: ingestion.parsedArtifactId,
  }
  const manifest = {
    scope: { tenantId, businessId }, corpusId: source.corpusId,
    corpusGeneration: 8, manifestHash: 'c'.repeat(64), entries: [entry],
  }
  const business = { id: businessId, tenantId, status: 'ACTIVE', deletedAt: null }
  const account = {
    id: accountId, tenantId, businessId, status: 'CONNECTED', transportMode: 'CLOUD',
    serverEnabled: false, archivedAt: null, version: 6,
  }
  const product = {
    id: productId, tenantId, businessId, code: 'SKU-42', name: 'Live mug', unit: 'EA',
    productMasterId:id(15),productMaster:{id:id(15),tenantId,businessId,status:'ACTIVE',nature:'GOOD',version:1},
    status: 'ACTIVE', itemKind: 'FINISHED_SET', dedicatedCustomerId: null,
    dedicatedSalesOrderId: null, archivedAt: null, version: 11,
  }
  const db = {
    business: { findUnique: vi.fn(async () => structuredClone(business)) },
    lineOaAccount: { findFirst: vi.fn(async () => structuredClone(account)) },
    product: { findFirst: vi.fn(async () => structuredClone(product)) },
    knowledgeSource: { findUnique: vi.fn(async () => structuredClone(source)) },
    knowledgeIngestion: { findUnique: vi.fn(async () => structuredClone(ingestion)) },
    fileAsset: { findUnique: vi.fn(async () => structuredClone(asset)) },
  }
  const readManifest = vi.fn(async () => manifest)
  const fileContentResolver = vi.fn(async () => ({ asset, content: Buffer.from(content) }))
  return {
    input: { tenantId, businessId, accountId, productId, sourceId, fields: ['nameTh', 'nameEn', 'dimensionsCm', 'unitWeightKg', 'sku', 'unit'] },
    options: { db, env: {}, readManifest, fileContentResolver },
    manifest, entry, source, ingestion, asset, product, business, account, sourceRecord,
    content, readManifest, fileContentResolver, db,
  }
}

describe('verified LINE product disclosure source', () => {
  it('projects only selected public fields and binds the explicit Product/source pair', async () => {
    const f = fixture()
    const resolve = requireResolver(await sourcePromise)
    const result = await resolve(f.input, f.options)

    expect(result.values).toEqual([
      { field: 'sku', value: 'SKU-42' },
      { field: 'nameTh', value: 'Mug model' },
      { field: 'nameEn', value: 'Mug' },
      { field: 'unit', value: 'EA' },
      { field: 'dimensionsCm', value: { height: 10, length: 20, width: 3 } },
      { field: 'unitWeightKg', value: 0.25 },
    ])
    expect(f.db.product.findFirst.mock.calls[0][0].where.id).toBe(productId)
    expect(result.binding).toMatchObject({
      tenantId, businessId, accountId,
      source: { id: f.source.id },
      ingestion: { id: f.ingestion.id },
      record: { entityType: 'ProductMaster', externalIdSha256: sha256('vendor-product-17'), recordIndex: 0, recordCount: 1 },
      product: { id: productId, version: 11, identitySha256: expect.any(String) },
    })
    expect(JSON.parse(JSON.stringify(result.binding))).toEqual(result.binding)
    expect(result.projectionSha256).toBe(hashGenesisRag17Json({
      schema: 'zuri.line-product-disclosure.projection.v1',
      values: result.values,
    }))
    expect(result.retrievalRef).toEqual({
      sourceId: f.source.id, ingestionId: f.ingestion.id, snapshotId: 'snapshot-1',
      generation: 'generation-1', manifestHash: f.manifest.manifestHash, corpusGeneration: 8,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/98765|private-provenance|private-source-record|private-model-code|private-blob|raw-artifact|parsed-artifact|citationId|Sibling private name/)
  })

  it('accepts a multi-row asset only through its exact split single-record ingestion', async () => {
    const f = fixture({ multipleRows: true })
    const resolve = requireResolver(await sourcePromise)
    const result = await resolve(f.input, f.options)

    expect(result.values.find((row) => row.field === 'nameTh')).toEqual({ field: 'nameTh', value: 'Mug model' })
    expect(JSON.stringify(result.values)).not.toContain('Sibling private name')
    f.ingestion.content = JSON.stringify([f.sourceRecord])
    await expect(resolve(f.input, f.options)).rejects.toMatchObject({ code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE' })
  })

  it.each([
    ['inactive product', (f) => { f.product.status = 'INACTIVE' }],
    ['dedicated product', (f) => { f.product.dedicatedCustomerId = id(44) }],
    ['custom component', (f) => { f.product.itemKind = 'CUSTOM_COMPONENT' }],
    ['wrong tenant account', (f) => { f.account.tenantId = id(44) }],
    ['disconnected account', (f) => { f.account.status = 'DRAFT' }],
    ['wrong business', (f) => { f.business.status = 'INACTIVE' }],
  ])('refuses an %s binding', async (_name, mutate) => {
    const f = fixture()
    mutate(f)
    const resolve = requireResolver(await sourcePromise)
    await expect(resolve(f.input, f.options)).rejects.toMatchObject({ code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE' })
  })

  it.each(['source', 'asset bytes', 'descriptor', 'receipt tuple', 'commerce mapping'])(
    'refuses a mismatched %s identity', async (kind) => {
      const f = fixture()
      if (kind === 'source') f.input.sourceId = id(99)
      if (kind === 'asset bytes') f.fileContentResolver.mockResolvedValue({ asset: f.asset, content: Buffer.from('wrong bytes') })
      if (kind === 'descriptor') {
        const meta = JSON.parse(f.ingestion.sourceMetaJson)
        meta.structured.recordIndex = 22
        f.ingestion.sourceMetaJson = JSON.stringify(meta)
      }
      if (kind === 'receipt tuple') f.manifest.entries[0].snapshotId = 'foreign-snapshot'
      if (kind === 'commerce mapping') {
        const meta = JSON.parse(f.ingestion.sourceMetaJson)
        meta.structured.externalId = `commerce-sku:${id(88)}`
        f.ingestion.sourceMetaJson = JSON.stringify(meta)
        f.ingestion.content = f.ingestion.content.replace('vendor-product-17', `commerce-sku:${id(88)}`)
        f.ingestion.contentHash = hashGenesisRag17Text(f.ingestion.content)
        f.manifest.entries[0].contentHash = f.ingestion.contentHash
      }
      const resolve = requireResolver(await sourcePromise)
      await expect(resolve(f.input, f.options)).rejects.toMatchObject({ code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE' })
    },
  )

  it.each(['status','nature','scope'])('rejects changed ProductMaster eligibility: %s',async key=>{
    const f=fixture()
    if(key==='status') f.product.productMaster.status='ARCHIVED'
    if(key==='nature') f.product.productMaster.nature='SERVICE'
    if(key==='scope') f.product.productMaster.businessId=id(99)
    const resolve=requireResolver(await sourcePromise)
    await expect(resolve(f.input,f.options)).rejects.toMatchObject({code:'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE'})
  })
  it('rejects ProductMaster changes across the file read even when Product version is unchanged',async()=>{
    const f=fixture()
    f.fileContentResolver.mockImplementation(async()=>{
      f.product.productMaster.version++
      return {asset:f.asset,content:Buffer.from(f.content)}
    })
    const resolve=requireResolver(await sourcePromise)
    await expect(resolve(f.input,f.options)).rejects.toMatchObject({code:'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE'})
  })
  it('rejects a manifest or Product change during the asynchronous file read', async () => {
    const changedManifest = fixture()
    changedManifest.readManifest
      .mockResolvedValueOnce(changedManifest.manifest)
      .mockResolvedValueOnce({ ...changedManifest.manifest, manifestHash: 'd'.repeat(64), corpusGeneration: 9 })
    const resolve = requireResolver(await sourcePromise)
    await expect(resolve(changedManifest.input, changedManifest.options)).rejects.toMatchObject({ code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE' })

    const changedProduct = fixture()
    changedProduct.fileContentResolver.mockImplementation(async () => {
      changedProduct.product.version += 1
      return { asset: changedProduct.asset, content: Buffer.from(changedProduct.content) }
    })
    await expect(resolve(changedProduct.input, changedProduct.options)).rejects.toMatchObject({ code: 'LINE_PRODUCT_DISCLOSURE_SOURCE_UNAVAILABLE' })
  })
})
