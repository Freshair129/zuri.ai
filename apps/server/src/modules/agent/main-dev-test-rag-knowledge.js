import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { queryKnowledgeCorpus, readAuthorizedKnowledgeManifest } from '@/modules/knowledge/knowledge-corpus-service'
import { splitSmartGiftCatalogRecords, smartGiftSourceKey, SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT, SMARTGIFT_CATALOG_PROVIDER } from '@/modules/knowledge/smartgift-catalog-adapter'
import { hashGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import { assertMainDevLocalOllamaScope } from './main-dev-local-ollama'
import { lineKnowledgeGroundingBudgetFromEnv } from './line-knowledge-grounding'

// @req FR-079, FR-235 — real native retrieval selects only independently verified public TEST ONLY metadata.
// @spec SEC-001, SEC-032 — source tuples and immutable bytes, never raw retrieved passages, authorize projection.
// @tested tests/unit/main-dev-test-rag-knowledge.test.js
const fail = () => Object.assign(new Error('MAIN_DEV_TEST_RAG_UNAVAILABLE'), { code: 'MAIN_DEV_TEST_RAG_UNAVAILABLE' })
const digest = hashGenesisRag17Json
const same = (a, b) => digest(a) === digest(b)
const safeLabel = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 240
  && /^[\p{L}\p{M}\p{N} .,_()-]+$/u.test(value)
  && !/ignore|instructions?|system prompt|developer|forget|reveal|disregard|override|secret|ข้ามกฎ|คำสั่งระบบ|เปิดเผย|ลืมกฎ/iu.test(value)
const safeName = value => safeLabel(value) && /^TEST[ -]ONLY\b/i.test(value)
const safeUnit = value => safeLabel(value) && /^[\p{L}\p{M}\p{N}._-]{1,32}$/u.test(value)
const productFields = ['id', 'tenantId', 'businessId', 'code', 'name', 'unit', 'status', 'itemKind',
  'dedicatedCustomerId', 'dedicatedSalesOrderId', 'version']
const pickProduct = product => Object.fromEntries(productFields.map(key => [key, product[key] ?? null]))
const insist = condition => { if (!condition) throw fail() }

export function mainDevTestRagProfileDigest(profile) {
  return digest({ runtimeSource: profile.runtimeSource, expectedDatabase: profile.expectedDatabase,
    knowledgeSource: profile.knowledgeSource, allowedTenantIds: profile.allowedTenantIds,
    allowedBusinessIds: profile.allowedBusinessIds, allowedLineOaAccountIds: profile.allowedLineOaAccountIds,
    rag: profile.rag })
}

/** Only references/digests leave this function; raw PCAT bytes never enter the prompt. */
export async function readMainDevTestRagSnapshot({ profile, tenantId, businessId, accountId,
  db = prisma, readManifest = readAuthorizedKnowledgeManifest, fileContentResolver = resolveFileAssetContent,
  env = process.env } = {}) {
  insist(profile?.knowledgeSource === 'GENESISRAG17_TEST_ONLY' && profile.rag?.products?.length)
  await assertMainDevLocalOllamaScope({ profile, db, tenantId, businessId, accountId })
  const viewer = Object.freeze({ visibleBusinessIds: Object.freeze([businessId]) })
  const manifest = await readManifest({ businessId, projectId: null }, { db, viewer, env })
  insist(manifest.scope?.tenantId === tenantId && manifest.scope?.businessId === businessId
    && manifest.manifestHash === profile.rag.manifestHash)
  const selected = []
  for (const pin of profile.rag.products) {
    const entries = manifest.entries.filter(e => e.sourceId === pin.sourceId)
    insist(entries.length === 1)
    const entry = entries[0]
    const externalId = `commerce-sku:${pin.productId}`
    insist(entry.ingestionId === pin.ingestionId && entry.title === `ProductMaster ${externalId}`
      && entry.sourceVersion === pin.fileSha256 && entry.scope?.tenantId === tenantId
      && entry.scope?.businessId === businessId)
    const [product, source, ingestion, asset] = await Promise.all([
      db.product.findFirst({ where: { id: pin.productId, tenantId, businessId },
        select: Object.fromEntries(productFields.map(key => [key, true])) }),
      db.knowledgeSource.findUnique({ where: { id: pin.sourceId } }),
      db.knowledgeIngestion.findUnique({ where: { id: pin.ingestionId } }),
      db.fileAsset.findUnique({ where: { id: entry.fileAssetId } }),
    ])
    insist(product && product.id === pin.productId && product.tenantId === tenantId
      && product.businessId === businessId && product.code === pin.sku && /^TEST-ONLY-[A-Za-z0-9_-]+$/.test(product.code)
      && product.status === 'ACTIVE' && product.itemKind !== 'CUSTOM_COMPONENT'
      && !product.dedicatedCustomerId && !product.dedicatedSalesOrderId
      && safeName(product.name) && safeUnit(product.unit))
    insist(source && source.id === entry.sourceId && source.corpusId === manifest.corpusId
      && source.kind === 'FILE' && source.title === entry.title && source.fileAssetId === entry.fileAssetId
      && source.activeIngestionId === pin.ingestionId && source.desiredRevision === entry.revision
      && source.revokedAt === null && source.deletedAt === null)
    insist(ingestion && ingestion.id === pin.ingestionId && ingestion.corpusId === manifest.corpusId
      && ingestion.sourceId === pin.sourceId && ingestion.status === 'PUBLISHED'
      && ingestion.revision === entry.revision && ingestion.sourceVersion === entry.sourceVersion
      && ingestion.contentHash === entry.contentHash && ingestion.contentHash === hashGenesisRag17Text(ingestion.content)
      && ingestion.executionRunId === entry.executionRunId && ingestion.snapshotId === entry.snapshotId
      && ingestion.snapshotGeneration === entry.generation && ingestion.receiptHash === entry.receiptHash
      && ingestion.rawArtifactId === entry.rawArtifactId && ingestion.parsedArtifactId === entry.parsedArtifactId)
    insist(asset && asset.id === entry.fileAssetId && asset.tenantId === tenantId && asset.businessId === businessId
      && asset.projectId === null && asset.status === 'ACTIVE' && asset.deletedAt === null
      && asset.storageKind === 'MANAGED_BLOB' && asset.mime === SMARTGIFT_CATALOG_CONTENT_TYPE
      && /^PCAT-[a-f0-9]{64}$/.test(asset.code) && asset.name === `commerce-price-${pin.productId}.json`
      && asset.sha256 === pin.fileSha256 && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 65536)
    const meta = JSON.parse(ingestion.sourceMetaJson)
    const descriptor = meta?.structured
    insist(descriptor?.format === SMARTGIFT_CATALOG_FORMAT && descriptor.provider === SMARTGIFT_CATALOG_PROVIDER
      && descriptor.entityType === 'ProductMaster' && descriptor.contentType === SMARTGIFT_CATALOG_CONTENT_TYPE
      && descriptor.externalId === externalId && descriptor.fileSha256 === asset.sha256
      && meta.kind === 'FILE' && meta.title === source.title && meta.sourceKey === source.sourceKey
      && meta.fileAssetId === asset.id && meta.fileAssetVersion === asset.version && meta.mime === asset.mime
      && meta.size === Buffer.byteLength(ingestion.content) && meta.storageKind === asset.storageKind
      && meta.sourceVersion === ingestion.sourceVersion && meta.contentHash === ingestion.contentHash)
    const productSnapshot = pickProduct(product)
    const identityBeforeRead = digest({ entry, source, ingestion, asset, product: productSnapshot })
    const resolved = await fileContentResolver(asset.id, { db, visibleBusinessIds: [businessId] })
    insist(same(asset, resolved.asset))
    const bytes = Buffer.from(resolved.content)
    insist(bytes.length === asset.size && createHash('sha256').update(bytes).digest('hex') === asset.sha256)
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const split = splitSmartGiftCatalogRecords({ content, fileAssetId: asset.id, fileSha256: asset.sha256, fileName: asset.name })
    const admitted = split.records.find(r => r.index === descriptor.recordIndex)
    insist(split.recordCount === descriptor.recordCount && Number.isSafeInteger(descriptor.recordIndex)
      && admitted && admitted.content === ingestion.content && admitted.contentHash === ingestion.contentHash
      && admitted.externalId === externalId && admitted.record.entityType === 'ProductMaster'
      && admitted.record.externalId === externalId && admitted.record.code === externalId
      && admitted.record.nameTh === `${pin.sku} — ${productSnapshot.name}`
      && source.sourceKey === smartGiftSourceKey({ fileName: asset.name, recordCode: externalId }))
    selected.push({ pin, entry, product: productSnapshot,
      record: { product_code: pin.sku, name: productSnapshot.name, unit: productSnapshot.unit,
        sell_price: null, currency: null, moq: null, specification: {} },
      identity: identityBeforeRead })
  }
  // Object storage is an async boundary: reject source/Product/asset changes
  // during that read, including in the final pre-send snapshot invocation.
  const currentManifest = await readManifest({ businessId, projectId: null }, { db, viewer, env })
  insist(same(manifest, currentManifest))
  for (const row of selected) {
    const [product, source, ingestion, asset] = await Promise.all([
      db.product.findFirst({ where: { id: row.pin.productId, tenantId, businessId },
        select: Object.fromEntries(productFields.map(field => [field, true])) }),
      db.knowledgeSource.findUnique({ where: { id: row.pin.sourceId } }),
      db.knowledgeIngestion.findUnique({ where: { id: row.pin.ingestionId } }),
      db.fileAsset.findUnique({ where: { id: row.entry.fileAssetId } }),
    ])
    insist(product && row.identity === digest({ entry: row.entry, source, ingestion, asset, product: pickProduct(product) }))
  }
  return { manifest, selected, binding: { schema: 'zuri.line-test-rag.binding.v1', denied: false,
    profileSha256: mainDevTestRagProfileDigest(profile),
    sourceSha256: digest({ manifestHash: manifest.manifestHash, corpusId: manifest.corpusId,
      corpusGeneration: manifest.corpusGeneration, selected: selected.map(row => row.identity) }) } }
}

export function createMainDevTestRagKnowledgeReader(options = {}) {
  const { profile, tenantId, businessId, accountId, db = prisma, env = process.env,
    queryCorpus = queryKnowledgeCorpus } = options
  const { budgetMs, topK, maxPacketBytes } = lineKnowledgeGroundingBudgetFromEnv(env)
  let binding = null
  return Object.freeze({
    getBinding() { insist(binding); return structuredClone(binding) },
    async revalidate() {
      insist(binding && !binding.denied)
      const fresh = await readMainDevTestRagSnapshot({ ...options, db, env })
      insist(same(binding, fresh.binding))
      return fresh.binding
    },
    async query(input) {
      const startedAt = Date.now()
      let timer
      const work = async () => {
        insist(input?.businessId === businessId && (!input.tenantId || input.tenantId === tenantId))
        const query = input.queryId === 'product_detail' ? input.params?.productCode
          : input.queryId === 'product_compare' ? input.params?.productCodes?.join(' ') : input.params?.term
        insist(typeof query === 'string' && query.length > 0 && query.length <= 512)
        const before = await readMainDevTestRagSnapshot({ ...options, db, env })
        const result = await queryCorpus({ businessId, query, topK }, { db, env,
          viewer: Object.freeze({ visibleBusinessIds: Object.freeze([businessId]) }),
          sourceIds: before.selected.map(row => row.pin.sourceId) })
        insist(result.manifestHash === before.manifest.manifestHash && result.corpusGeneration === before.manifest.corpusGeneration
          && Array.isArray(result.results) && result.results.length <= topK)
        const records = [], retrievalRefs = [], seen = new Set()
        for (const hit of result.results) {
          const row = before.selected.find(candidate => candidate.pin.sourceId === hit.sourceId)
          insist(row && hit.ingestionId === row.pin.ingestionId && hit.snapshotId === row.entry.snapshotId
            && hit.generation === row.entry.generation && typeof hit.citationId === 'string'
            && hit.citationId.length > 0 && hit.citationId.length <= 512 && !/[\p{Cc}\p{Cf}]/u.test(hit.citationId))
          if (seen.has(hit.sourceId)) continue
          seen.add(hit.sourceId)
          records.push({ ...row.record, citationId: hit.citationId })
          retrievalRefs.push({ citationId: hit.citationId, sourceId: hit.sourceId, ingestionId: hit.ingestionId,
            snapshotId: hit.snapshotId, generation: hit.generation, corpusGeneration: result.corpusGeneration,
            manifestHash: result.manifestHash })
        }
        insist(Buffer.byteLength(JSON.stringify(records)) <= maxPacketBytes)
        const after = await readMainDevTestRagSnapshot({ ...options, db, env })
        insist(same(before.binding, after.binding))
        return { binding: records.length ? after.binding : { ...after.binding, denied: true, sourceSha256: null }, result: { records, retrievalRefs,
          meta: { source: 'GKS_CORPUS', mode: 'GKS_CORPUS', reason: records.length ? null : 'NO_EVIDENCE',
            corpusGeneration: result.corpusGeneration, manifestHash: result.manifestHash, budgetMs: Date.now() - startedAt } } }
      }
      try {
        const completed = await Promise.race([work(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(fail()), budgetMs)
        })])
        binding = completed.binding
        return completed.result
      } catch {
        binding = { schema: 'zuri.line-test-rag.binding.v1', denied: true,
          profileSha256: mainDevTestRagProfileDigest(profile), sourceSha256: null }
        return { records: [], retrievalRefs: [], meta: { source: 'GKS_CORPUS', mode: 'GKS_CORPUS',
          reason: 'GKS_UNAVAILABLE', budgetMs: Date.now() - startedAt } }
      } finally { clearTimeout(timer) }
    },
  })
}
