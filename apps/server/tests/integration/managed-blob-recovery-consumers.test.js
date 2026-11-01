// @req FR-292, FR-293 — recovery preserves consumer lineage, current authority and erasure fences.
// @spec ADR-115, FR-137, FR-138, FR-187, FR-253, SEC-024
// @tested tests/integration/managed-blob-recovery-consumers.test.js
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import db from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { compactPricingCatalogFixture } from '../helpers/compact-pricing-catalog'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { createManagedBlobRecoveryService } from '@/modules/project-manager/application/managed-blob-recovery-service'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { createConfiguredAssetObjectStoragePort, createConfiguredKnowledgeCatalogObjectStoragePort, createConfiguredManagedBlobObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import { uploadAssetEvidence, reviewAssetEvidence, extractAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { upsertAssetIntake } from '@/modules/asset-management/application/asset-intake-service'
import { uploadSmartGiftCatalogFile } from '@/modules/knowledge/smartgift-catalog-upload-service'
import { assertKnowledgeFileReadable, assertKnowledgeFileCurrent } from '@/modules/knowledge/knowledge-authorization'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'
import { parseBusinessObjectRef } from '@/platform/storage/private-business-object-storage'

const env = { ZURI_SESSION_SECRET: 'isolated-or4-session-secret-only',
  ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private',
  ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_ASSET_STORAGE_ACCESS_KEY: 'test', ZURI_ASSET_STORAGE_SECRET_KEY: 'test',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY: 'test', ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY: 'test',
  ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private' }
let business, person, membership, owner, foreign, request, root, service, assetPort, catalogPort, reader, pricing
const objects = new Map(), io = vi.fn(), extractor = { extract: vi.fn(() => { throw new Error('No model invocation during recovery') }) }
const ownedFileIds = [], operationIds = []
const bytes = Buffer.from('%PDF-1.7\nOR4 exact original')
const fetchFn = async (url, init) => {
  const u = new URL(url), key = u.pathname, version = u.searchParams.get('versionId')
  io(init.method, key, version)
  if (init.method === 'PUT') { objects.set(key, Buffer.from(init.body)); return new Response('', { headers: { 'x-amz-version-id': 'v1' } }) }
  if (['GET', 'HEAD'].includes(init.method)) {
    if (!objects.has(key) || version && version !== 'v1') return new Response(null, { status: 404 })
    return new Response(init.method === 'HEAD' ? null : objects.get(key), { headers: { 'x-amz-version-id': 'v1' } })
  }
  throw new Error('No provider deletion or other IO in OR4')
}
const row = id => db.fileAsset.findUniqueOrThrow({ where: { id } })
const read = (id, viewer = owner) => resolveFileAssetContent(id, { db, visibleBusinessIds: viewer.visibleBusinessIds, objectStoragePort: reader })
async function recover(id, content) {
  const file = await row(id), before = { ...file }
  const op = await service.prepare({ request, fileId: id, input: { expectedVersion: file.version } })
  operationIds.push(op.operationId)
  const preview = await service.preview({ request, fileId: id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [content] })
  const input = { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version }
  const staged = await service.stage({ request, fileId: id, operationId: op.operationId, input })
  const result = await service.confirm({ request, fileId: id, operationId: op.operationId, input: { ...input, expectedOperationVersion: staged.version } })
  expect(result).toMatchObject({ state: 'COMMITTED', targetCurrent: true, availability: 'VERIFIED' })
  expect(await row(id)).toEqual({ ...before, blobRef: expect.stringContaining('/recovery/'), version: before.version + 1, updatedAt: expect.any(Date) })
  expect(JSON.stringify(result)).not.toMatch(/blobRef|secret|ACCESS_KEY|SECRET_KEY|credential|KEK/)
  await expect(service.cleanup({ request, fileId: id, operationId: op.operationId })).resolves.toMatchObject({ custody: { spoolBytes: 0, unresolved: false } })
  return result
}
async function knowledgeSnapshot() {
  const sources = await db.knowledgeSource.findMany({ where: { fileAssetId: { in: ownedFileIds } }, orderBy: { id: 'asc' } })
  return { sources, ingestions: await db.knowledgeIngestion.findMany({ where: { sourceId: { in: sources.map(s => s.id) } }, orderBy: { id: 'asc' } }),
    calculations: await db.pricingCalculation.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }) }
}
beforeAll(async () => {
  const code = randomUUID(), portfolio = await createPortfolio({ code: 'PF-' + code, name: 'OR4 TEST' })
  const tenant = await createTenant({ portfolioId: portfolio.id, code: 'T-' + code, name: 'OR4 TEST' })
  business = await createBusiness({ tenantId: tenant.id, code: 'B-' + code, name: 'OR4 TEST' })
  const other = await createBusiness({ tenantId: tenant.id, code: 'OTHER-' + code, name: 'Foreign TEST' })
  person = await db.person.create({ data: { code: 'P-' + code, displayName: 'OR4 owner' } })
  membership = await db.membership.create({ data: { tenantId: tenant.id, businessId: business.id, personId: person.id, role: 'OWNER' } })
  owner = makeViewer({ principal: { id: person.id }, visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['assets', 'commerce', 'inventory', 'knowledge'] })
  foreign = ownsElsewhere({ owns: other.id, sees: other.id, visibleDomains: ['assets', 'knowledge'] })
  const sessionId = randomUUID(), token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
  await persistSession({ token, sessionId, personId: person.id, db, env })
  request = new Request('http://localhost/api/files', { headers: { cookie: 'zuri_session=' + token } })
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuri-or4-')))
  // TEST admission only, not product provisioning or installation qualification.
  await db.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation', mode: 'READY', generation: 1 } })
  service = createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn })
  assetPort = createConfiguredAssetObjectStoragePort(env, { fetchFn })
  catalogPort = createConfiguredKnowledgeCatalogObjectStoragePort(env, { fetchFn })
  reader = createConfiguredManagedBlobObjectStoragePort(env, { fetchFn })
  pricing = await compactPricingCatalogFixture({ db, business, storageEnv: env })
})
afterAll(async () => {
  // Scoped cleanup only; other suites may share this disposable PG database.
  await db.managedBlobRecoveryOperation.deleteMany({ where: { id: { in: operationIds } } })
  if (business) {
    await db.assetEvidence.deleteMany({ where: { businessId: business.id } })
    await db.fileAsset.deleteMany({ where: { businessId: business.id } })
  }
  await db.managedBlobRecoveryInstallationFence.deleteMany({ where: { id: 'installation' } })
  if (root) await rm(root, { recursive: true, force: true })
})

describe('OR4 domain invariants after exact-original rebind (controlled provider, no qualification)', () => {
  it('preserves Asset evidence review, intake links and readiness without re-extraction', async () => {
    const file = await uploadAssetEvidence({ businessId: business.id, name: 'receipt.pdf', mime: 'application/pdf', content: bytes }, { db, viewer: owner, objectStoragePort: assetPort })
    ownedFileIds.push(file.id)
    const created = await upsertAssetIntake({ schemaVersion: '1.0', source: { channel: 'WEB', correlationId: randomUUID() }, businessId: business.id,
      origin: 'PROCUREMENT_PURCHASE', item: { name: 'OR4 item', categoryCode: 'IT', quantity: 1, expiryControlled: false },
      evidence: [{ fileAssetId: file.id, role: 'PAYMENT_PROOF' }], procurementRefs: [], lot: null, responsibilities: [], location: null, projectAllocation: null, depreciation: null }, { db, viewer: owner })
    const evidence = created.intake.evidence[0]
    const controlledExtractor = { extract: vi.fn(async input => {
      expect(input).toMatchObject({ content: bytes, fileAssetId: file.id, mime: 'application/pdf' })
      return { provider: 'TEST', model: 'fixture-only', responseId: 'synthetic', fields: [] }
    }) }
    await extractAssetEvidence(evidence.id, { db, viewer: owner, extractor: controlledExtractor, objectStoragePort: reader })
    await reviewAssetEvidence(evidence.id, { decision: 'ACCEPT', note: 'Original human decision', corrections: [] }, { db, viewer: owner })
    const before = await db.assetIntake.findUnique({ where: { id: created.intake.id }, include: { evidence: true, procurementRefs: true } })
    objects.clear() // exact provider loss, not a FileAsset rewrite
    await expect(read(file.id)).rejects.toThrow()
    await recover(file.id, bytes)
    expect(await read(file.id)).toMatchObject({ content: bytes, asset: { id: file.id, mime: 'application/pdf', size: bytes.length, sha256: file.sha256 } })
    expect(await db.assetIntake.findUnique({ where: { id: before.id }, include: { evidence: true, procurementRefs: true } })).toEqual(before)
    expect(extractor.extract).not.toHaveBeenCalled()
    expect(controlledExtractor.extract).toHaveBeenCalledTimes(1)
    io.mockClear()
    await expect(extractAssetEvidence(evidence.id, { db, viewer: foreign, extractor, objectStoragePort: reader })).rejects.toMatchObject({ status: 404 })
    expect(io).not.toHaveBeenCalled(); expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('preserves SmartGift source/ingestion and parsed records without re-admission or publication', async () => {
    const content = readFileSync(path.resolve('tests/fixtures/genesisrag17/smartgift-catalog/products.json'))
    // Existing intake creates durable QUEUED lineage only; no worker/model runs.
    const uploaded = await uploadSmartGiftCatalogFile({ businessId: business.id, name: 'products.json', contentBase64: content.toString('base64') }, { db, viewer: pricing.owner, env: pricing.env, objectStoragePort: catalogPort })
    ownedFileIds.push(uploaded.fileAssetId)
    const before = await knowledgeSnapshot()
    expect(before.sources.some(s => s.fileAssetId === uploaded.fileAssetId)).toBe(true)
    objects.clear()
    await recover(uploaded.fileAssetId, content)
    const current = await assertKnowledgeFileReadable(pricing.owner, uploaded.fileAssetId, { db, businessId: business.id, env: pricing.env })
    expect(current).toBeTruthy()
    expect(JSON.parse((await read(uploaded.fileAssetId)).content.toString())).toEqual(JSON.parse(content))
    expect(await knowledgeSnapshot()).toEqual(before)
  })

  it('composes the selected catalog port without an injected storage port and reports unavailable admission honestly', async () => {
    const content = Buffer.concat([readFileSync(path.resolve('tests/fixtures/genesisrag17/smartgift-catalog/products.json')), Buffer.from('\n')])
    vi.stubGlobal('fetch', fetchFn)
    try {
      const result = await uploadSmartGiftCatalogFile({ businessId: business.id, name: 'other.json', contentBase64: content.toString('base64') }, {
        db, viewer: pricing.owner, env: pricing.env,
        admit: async () => { throw Object.assign(new Error('Fixture unavailable'), { status: 503, code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' }) },
      })
      ownedFileIds.push(result.fileAssetId)
      expect(result).toMatchObject({ fileStatus: 'STORED', knowledgeStatus: 'UNAVAILABLE' })
      expect((await row(result.fileAssetId)).blobRef).toMatch(/^s3-business:\/\/catalog\/catalog-private\/business-catalog\//)
      expect((await read(result.fileAssetId)).content).toEqual(content)
    } finally { vi.unstubAllGlobals() }
  })

  it('preserves pricing calculation/rules/ledger lineage and current policy checks', async () => {
    const options = { db, viewer: pricing.owner, now: pricing.now, env: pricing.env, objectStoragePort: catalogPort }
    const preview = await admitPricingCatalog({ ...pricing.request, previewOnly: true }, options)
    const admitted = await admitPricingCatalog({ ...pricing.request, previewHash: preview.previewHash }, options)
    ownedFileIds.push(admitted.fileAssetId)
    expect(admitted.publicationStatus).toBe('NOT_VERIFIED')
    const content = (await read(admitted.fileAssetId)).content, before = await knowledgeSnapshot()
    expect(before.calculations).toHaveLength(2)
    objects.clear()
    await recover(admitted.fileAssetId, content)
    await expect(assertKnowledgeFileCurrent(admitted.fileAssetId, { db, businessId: business.id })).resolves.toBeTruthy()
    expect((await read(admitted.fileAssetId)).content).toEqual(content)
    expect(await knowledgeSnapshot()).toEqual(before)
    io.mockClear()
    await expect(assertKnowledgeFileReadable(foreign, admitted.fileAssetId, { db, businessId: business.id, env: pricing.env })).rejects.toMatchObject({ status: 404 })
    expect(io).not.toHaveBeenCalled()
    await db.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } })
    try {
      const current = await resolveViewer({ principalId: person.id, db })
      await expect(read(admitted.fileAssetId, current)).rejects.toThrow()
      await expect(service.prepare({ request, fileId: admitted.fileAssetId, input: { expectedVersion: 2 } })).rejects.toMatchObject({ status: 404 })
      expect(io).not.toHaveBeenCalled()
    } finally { await db.membership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } }) }
  })

  it('fails closed on corrupt post-rebind catalog bytes without changing the frozen source or pricing decisions', async () => {
    const id = ownedFileIds.at(-1), file = await row(id), ref = parseBusinessObjectRef(file.blobRef)
    const key = '/' + ref.bucket + '/' + ref.key.split('/').map(encodeURIComponent).join('/')
    const original = objects.get(key), before = await knowledgeSnapshot()
    objects.set(key, Buffer.alloc(original.length, 0))
    try {
      await expect(read(id)).rejects.toThrow()
      expect(await row(id)).toEqual(file)
      expect(await knowledgeSnapshot()).toEqual(before)
    } finally { objects.set(key, original) }
  })

  it.each(['deleted', 'quarantined', 'missing-hash', 'invalid-size', 'unknown-purpose'])('refuses %s recovery before provider IO without reviving consumer lineage', async kind => {
    const original = await row(ownedFileIds[0]), before = await knowledgeSnapshot()
    const patch = { deleted: { deletedAt: new Date() }, quarantined: { status: 'QUARANTINED' }, 'missing-hash': { sha256: null }, 'invalid-size': { size: -1 },
      'unknown-purpose': { blobRef: original.blobRef.replace('://asset/', '://credential/') } }[kind]
    await db.fileAsset.update({ where: { id: original.id }, data: patch })
    io.mockClear()
    try {
      await expect(service.prepare({ request, fileId: original.id, input: { expectedVersion: original.version } })).rejects.toThrow()
      await expect(read(original.id)).rejects.toThrow()
      expect(io).not.toHaveBeenCalled()
      expect(await row(original.id)).toMatchObject(patch)
      expect(await knowledgeSnapshot()).toEqual(before)
    } finally { await db.fileAsset.update({ where: { id: original.id }, data: { deletedAt: original.deletedAt, status: original.status, size: original.size, sha256: original.sha256, blobRef: original.blobRef } }) }
  })
  it.each(['credential', 'envelope', 'kek', 'grants', 'unknownFamily'])('refuses caller-supplied %s without importing runtime authority or creating work', async field => {
    const file = await row(ownedFileIds[0]), before = await knowledgeSnapshot()
    const operations = await db.managedBlobRecoveryOperation.count({ where: { businessId: business.id } })
    const grants = await db.membership.findMany({ where: { businessId: business.id } })
    io.mockClear()
    await expect(service.prepare({ request, fileId: file.id, input: { expectedVersion: file.version, [field]: 'untrusted-input' } })).rejects.toMatchObject({ status: 400 })
    expect(await db.membership.findMany({ where: { businessId: business.id } })).toEqual(grants)
    expect(await db.managedBlobRecoveryOperation.count({ where: { businessId: business.id } })).toBe(operations)
    expect(await knowledgeSnapshot()).toEqual(before)
    expect(io).not.toHaveBeenCalled()
  })
})
