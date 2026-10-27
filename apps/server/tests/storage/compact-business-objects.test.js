// @req FR-137, FR-138, FR-045, FR-173 — real private bytes, scope and DB failure/loss boundaries.
// @spec ADR-115, SEC-001, SEC-024
// @tested src/platform/storage/private-business-object-storage.js
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createConfiguredAssetObjectStoragePort, createConfiguredKnowledgeCatalogObjectStoragePort, createConfiguredManagedBlobObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import { resolveFileAssetContent, createManagedBlobFileAsset } from '@/modules/project-manager/application/file-asset-service'
import { uploadAssetEvidence, extractAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { startCompactBusinessStorage, businessStorageObservation } from '../helpers/compact-business-storage.mjs'
import { createS3ObjectStoragePort } from '@/platform/storage/s3-object-storage'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { compactPricingCatalogFixture } from '../helpers/compact-pricing-catalog'

describe('Compact actual private business objects', () => {
  let fixture, business, owner, assetPort, catalogPort, reader, uploaded
  const completedCases = new Set()
  const content = Buffer.from('%PDF-1.7\nowned evidence')
  beforeAll(async () => {
    fixture = await startCompactBusinessStorage()
    assetPort = createConfiguredAssetObjectStoragePort(fixture.env); catalogPort = createConfiguredKnowledgeCatalogObjectStoragePort(fixture.env)
    reader = createConfiguredManagedBlobObjectStoragePort(fixture.env)
    const code = randomUUID().slice(0, 8).toUpperCase(), portfolio = await createPortfolio({ code: `PF-C4-${code}`, name: 'Compact TEST' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-C4-${code}`, name: 'Compact TEST' })
    business = await createBusiness({ tenantId: tenant.id, code: `BUS-C4-${code}`, name: 'Compact TEST' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })
  afterAll(async () => {
    let cleanup = 'FAIL', cleanupError
    try { if (fixture) { await fixture.close(); cleanup = 'PASS' } } catch (error) { cleanupError = error }
    if (process.env.COMPACT_STORAGE_EVIDENCE_FILE) await writeFile(process.env.COMPACT_STORAGE_EVIDENCE_FILE,
      JSON.stringify(businessStorageObservation({ evidence: fixture?.evidence, completedCases, cleanup }), null, 2))
    if (cleanupError) throw cleanupError
  })

  it('uploads real evidence, reads authorized FileAsset bytes and refuses current foreign visibility before provider I/O', async () => {
    uploaded = await uploadAssetEvidence({ businessId: business.id, name: 'receipt.pdf', mime: 'application/pdf', content }, { viewer: owner, objectStoragePort: assetPort })
    await expect(resolveFileAssetContent(uploaded.id, { visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: reader })).resolves.toMatchObject({ content })
    const spy = { get: vi.fn() }
    await expect(resolveFileAssetContent(uploaded.id, { visibleBusinessIds: [], objectStoragePort: spy })).rejects.toThrow(/not visible/)
    expect(spy.get).not.toHaveBeenCalled()
    const row = await prisma.fileAsset.findUnique({ where: { id: uploaded.id } })
    await expect(assetPort.put({ key: `business-catalog/${business.tenantId}/${business.id}/hash/other.json`, content })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: row.blobRef, businessId: 'foreign', tenantId: business.tenantId })).rejects.toMatchObject({ status: 400 })
    completedCases.add('upload')
  })

  it('uses a distinct version-pinned catalog namespace and provider credentials cannot read or write another purpose', async () => {
    const key = `business-catalog/${business.tenantId}/${business.id}/hash/${randomUUID()}.json`, bytes = Buffer.from('{"catalog":true}')
    const stored = await catalogPort.put({ key, content: bytes, mime: 'application/json' })
    const file = await createManagedBlobFileAsset({ businessId: business.id, name: 'catalog.json', mime: 'application/json', size: bytes.length, blobRef: stored.ref }, { viewer: owner })
    await expect(resolveFileAssetContent(file.id, { visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: reader })).resolves.toMatchObject({ content: bytes })
    const wrongCredentialPort = createConfiguredKnowledgeCatalogObjectStoragePort({ ...fixture.env, ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY: fixture.env.ZURI_ASSET_STORAGE_ACCESS_KEY, ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY: fixture.env.ZURI_ASSET_STORAGE_SECRET_KEY })
    await expect(wrongCredentialPort.get({ ref: stored.ref })).rejects.toMatchObject({ status: 503 })
    await expect(wrongCredentialPort.put({ key: key + '.foreign', content: bytes })).rejects.toMatchObject({ status: 503 })
    await expect(catalogPort.put({ key, content: bytes })).rejects.toMatchObject({ status: 409 })
    await catalogPort.remove({ ref: stored.ref })
    await expect(reader.get({ ref: stored.ref })).rejects.toMatchObject({ status: 404 })
    completedCases.add('catalog')
  })

  it('feeds the actual authorized evidence bytes into extraction without running a live model', async () => {
    const suffix = randomUUID(), intake = await prisma.assetIntake.create({ data: { tenantId: business.tenantId, businessId: business.id, intakeCode: `COMPACT-${suffix}`, schemaVersion: '1.0', sourceChannel: 'WEB', sourceCorrelationId: suffix, origin: 'MANUAL' } })
    const evidence = await prisma.assetEvidence.create({ data: { tenantId: business.tenantId, businessId: business.id, intakeId: intake.id, fileAssetId: uploaded.id, role: 'RECEIPT' } })
    const extractor = { extract: vi.fn().mockResolvedValue({ provider: 'TEST', model: 'none', responseId: 'test-read', fields: [] }) }
    await extractAssetEvidence(evidence.id, { viewer: owner, objectStoragePort: reader, extractor })
    expect(extractor.extract).toHaveBeenCalledWith(expect.objectContaining({ content, fileAssetId: uploaded.id }))
    const stranger = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    extractor.extract.mockClear()
    await expect(extractAssetEvidence(evidence.id, { viewer: stranger, objectStoragePort: reader, extractor })).rejects.toMatchObject({ status: 404 })
    expect(extractor.extract).not.toHaveBeenCalled()
    completedCases.add('extraction')
  })

  it('refuses pinned bytes inconsistent with FileAsset metadata before extraction effects', async () => {
    const bytes = Buffer.from('%PDF-1.7\nmetadata integrity test')
    const file = await uploadAssetEvidence({ businessId: business.id, name: 'integrity.pdf', mime: 'application/pdf', content: bytes }, { viewer: owner, objectStoragePort: assetPort })
    const suffix = randomUUID(), intake = await prisma.assetIntake.create({ data: { tenantId: business.tenantId, businessId: business.id, intakeCode: `COMPACT-${suffix}`, schemaVersion: '1.0', sourceChannel: 'WEB', sourceCorrelationId: suffix, origin: 'MANUAL' } })
    const evidence = await prisma.assetEvidence.create({ data: { tenantId: business.tenantId, businessId: business.id, intakeId: intake.id, fileAssetId: file.id, role: 'RECEIPT' } })
    const extractor = { extract: vi.fn().mockResolvedValue({ provider: 'TEST', model: 'none', responseId: 'integrity-read', fields: [] }) }, before = await prisma.auditEvent.count()
    for (const changed of [{ sha256: '0'.repeat(64) }, { size: bytes.length + 1 }, { sha256: null, size: bytes.length + 1 }]) {
      await prisma.fileAsset.update({ where: { id: file.id }, data: { sha256: file.sha256, size: bytes.length, ...changed } })
      await expect(extractAssetEvidence(evidence.id, { viewer: owner, objectStoragePort: reader, extractor })).rejects.toMatchObject({ status: 409, code: 'BUSINESS_STORAGE_UNAVAILABLE' })
      expect(extractor.extract).not.toHaveBeenCalled()
      expect(await prisma.assetEvidence.findUnique({ where: { id: evidence.id } })).toEqual(evidence)
      expect(await prisma.auditEvent.count()).toBe(before)
    }
    // Nullable legacy hashes remain supported; known size is still checked.
    await prisma.fileAsset.update({ where: { id: file.id }, data: { sha256: null, size: bytes.length } })
    await expect(resolveFileAssetContent(file.id, { visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: reader })).resolves.toMatchObject({ content: bytes })
    await prisma.fileAsset.update({ where: { id: file.id }, data: { sha256: file.sha256, size: bytes.length } })
    await expect(resolveFileAssetContent(file.id, { visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: reader })).resolves.toMatchObject({ content: bytes })
    completedCases.add('integrity')
  })

  it('admits real owner-reviewed pricing through configured S3, with stable replay and no unauthorized writes', async () => {
    const catalog = await compactPricingCatalogFixture({ db: prisma, business, storageEnv: fixture.env })
    const options = { db: prisma, viewer: catalog.owner, now: catalog.now, env: catalog.env }
    const requests = [], originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (raw, init) => {
      const url = new URL(raw)
      if (url.origin !== fixture.endpoint) throw new Error('COMPACT_TEST_UNEXPECTED_STORAGE_TARGET')
      requests.push({ method: init?.method, path: url.pathname, version: url.searchParams.get('versionId') })
      return originalFetch(raw, init)
    })
    try {
      const counts = async () => ({ assets: await prisma.fileAsset.count(), prices: await prisma.pricingCalculation.count(), jobs: await prisma.knowledgeIngestion.count(), audits: await prisma.auditEvent.count() })
      const before = await counts()
      const stranger = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['commerce', 'inventory', 'knowledge'] })
      await expect(admitPricingCatalog({ ...catalog.request, previewOnly: true }, { ...options, viewer: stranger })).rejects.toMatchObject({ status: 404 })
      const preview = await admitPricingCatalog({ ...catalog.request, previewOnly: true }, options)
      expect(await counts()).toEqual(before)
      expect(requests).toHaveLength(0)
      const request = { ...catalog.request, previewHash: preview.previewHash }
      const result = await admitPricingCatalog(request, options)
      expect(result).toMatchObject({ status: 'ADMITTED', publicationStatus: 'NOT_VERIFIED', admission: { recordCount: 3, admittedCount: 3, deniedCount: 0 } })
      const file = await prisma.fileAsset.findUnique({ where: { id: result.fileAssetId } })
      expect(file.blobRef).toMatch(/^s3-business:\/\/catalog\//)
      const admissionReads = requests.filter(row => row.method === 'GET')
      expect(admissionReads.length).toBeGreaterThan(0)
      expect(admissionReads.every(row => row.version === new URL(file.blobRef).searchParams.get('versionId'))).toBe(true)
      const { content: storedBytes } = await resolveFileAssetContent(file.id, { visibleBusinessIds: catalog.owner.visibleBusinessIds, objectStoragePort: reader })
      expect(createHash('sha256').update(storedBytes).digest('hex')).toBe(file.sha256)
      expect(storedBytes.length).toBe(file.size)
      const records = JSON.parse(storedBytes.toString('utf8'))
      expect(records.map(row => row.entityType)).toEqual(['ProductMaster', 'PriceListEntry', 'PriceListEntry'])
      expect(storedBytes.toString('utf8')).not.toMatch(/costSatang|unitLandedCost|grossProfit|rulesJson|receiptId|margin/i)
      const sources = await prisma.knowledgeSource.findMany({ where: { fileAssetId: file.id } })
      const jobs = await prisma.knowledgeIngestion.findMany({ where: { sourceId: { in: sources.map(source => source.id) } } })
      expect(jobs).toHaveLength(3)
      expect(jobs.every(job => job.status === 'QUEUED' && job.executionRunId === null)).toBe(true)
      await recordMovement({ businessId: business.id, productId: catalog.product.id, kind: 'RECEIPT', quantity: 100, costSatang: 15000 }, options)
      const replay = await admitPricingCatalog(request, options)
      expect(replay.fileAssetId).toBe(file.id)
      expect(replay.calculationIds).toEqual(result.calculationIds)
      expect(requests.filter(row => row.method === 'PUT')).toHaveLength(1)
      expect(requests.every(row => row.path.startsWith(`/${fixture.buckets.catalog}/business-catalog/`))).toBe(true)
      expect(requests.filter(row => row.method === 'GET').every(row => typeof row.version === 'string' && row.version.length > 0)).toBe(true)
      const after = await counts(), requestCount = requests.length
      await expect(admitPricingCatalog(request, { ...options, viewer: stranger })).rejects.toMatchObject({ status: 404 })
      expect(await counts()).toEqual(after)
      expect(requests).toHaveLength(requestCount)
      completedCases.add('pricingAdmission')
    } finally { vi.unstubAllGlobals() }
  })

  it('removes the exact just-written object on metadata failure and does not report success', async () => {
    let ref
    const tracked = { put: async input => { const result = await assetPort.put(input); ref = result.ref; return result }, remove: input => assetPort.remove(input) }
    const db = Object.create(prisma)
    db.$transaction = async () => { throw new Error('COMPACT_TEST_DB_WRITE_FAILED') }
    await expect(uploadAssetEvidence({ businessId: business.id, name: 'different.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.7\nDB failure') }, { db, viewer: owner, objectStoragePort: tracked })).rejects.toThrow('COMPACT_TEST_DB_WRITE_FAILED')
    expect(ref).toBeTruthy()
    await expect(reader.get({ ref })).rejects.toMatchObject({ status: 404 })
    completedCases.add('metadataFailure')
  })

  it('keeps an old ref pinned after another version appears, and erases only its selected version', async () => {
    const key = `business-catalog/${business.tenantId}/${business.id}/versions/${randomUUID()}.json`
    const oldBytes = Buffer.from('{"version":1}'), newBytes = Buffer.from('{"version":2}')
    const first = await catalogPort.put({ key, content: oldBytes, mime: 'application/json' })
    await fixture.replaceForVersionTest({ bucket: fixture.buckets.catalog, key, content: newBytes })
    await expect(reader.get({ ref: first.ref })).resolves.toEqual(oldBytes)
    const native = createS3ObjectStoragePort({ endpoint: fixture.endpoint, bucket: fixture.buckets.catalog, accessKeyId: fixture.env.ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY, secretAccessKey: fixture.env.ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY })
    const latest = await native.recoverImmutable({ key, expectedSha256: createHash('sha256').update(newBytes).digest('hex'), byteLength: newBytes.length })
    const latestRef = first.ref.replace(/versionId=.*/, `versionId=${encodeURIComponent(latest.versionId)}`)
    expect(latestRef).not.toBe(first.ref)
    await catalogPort.remove({ ref: first.ref })
    await expect(reader.get({ ref: first.ref })).rejects.toMatchObject({ status: 404 })
    await expect(reader.get({ ref: latestRef })).resolves.toEqual(newBytes)
    await catalogPort.remove({ ref: latestRef })
    completedCases.add('versions')
  })

  it('does not turn restored metadata into recovered bytes after exact object loss', async () => {
    const metadata = await prisma.fileAsset.findUnique({ where: { id: uploaded.id } })
    await assetPort.remove({ ref: metadata.blobRef })
    // Metadata is deliberately retained: a DB-only restore would present the same ref.
    await expect(resolveFileAssetContent(metadata.id, { visibleBusinessIds: owner.visibleBusinessIds, objectStoragePort: reader })).rejects.toMatchObject({ status: 404 })
    expect(await prisma.fileAsset.findUnique({ where: { id: metadata.id } })).toMatchObject({ blobRef: metadata.blobRef, status: 'ACTIVE' })
    completedCases.add('objectLoss')
  })

  it('refuses a provider null version before metadata publication and never erases latest as cleanup', async () => {
    await fixture.suspendVersioningForTest('asset')
    const before = await prisma.fileAsset.count({ where: { businessId: business.id } }), remove = vi.fn()
    await expect(uploadAssetEvidence({ businessId: business.id, name: 'unversioned.pdf', mime: 'application/pdf', content: Buffer.from('%PDF-1.7\nUnversioned refusal') }, { viewer: owner, objectStoragePort: { put: input => assetPort.put(input), remove } })).rejects.toMatchObject({ status: 503 })
    expect(await prisma.fileAsset.count({ where: { businessId: business.id } })).toBe(before)
    expect(remove).not.toHaveBeenCalled()
    completedCases.add('unversionedRefusal')
  })
})
