import { queryKnowledgeCorpus as defaultQueryKnowledgeCorpus, readAuthorizedKnowledgeManifest } from './knowledge-corpus-service'
import prisma from '@/lib/db'
import { createHash } from 'node:crypto'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
  smartGiftSourceKey,
  splitSmartGiftCatalogRecords,
} from './smartgift-catalog-adapter'
import { hashGenesisRag17Json, hashGenesisRag17Text } from './genesisrag17-contract'

// @req FR-235 — an in-process implementation of the existing `knowledge.query`
// port, backed by `queryKnowledgeCorpus` (FR-173), never an HTTP self-call
// (ADR-090 D1). Scoped to exactly one Business — the reader is constructed
// once per turn from the job's already-verified, server-derived tenant and
// Business, never from a session or a request-supplied actor.
// @spec ADR-072 D5 — the "unforgeable scoped runtime knowledge capability":
// this reader mints a read-only viewer naming only the one Business it was
// built for (`visibleBusinessIds: [businessId]`), the same minimal-capability
// shape `server-line-rich-menu-runtime.js` already uses for a server-owned,
// in-process file read. It carries no session, no API-access flag and no
// ownership grant — it can never authorize a write, and it can never widen to
// a second Business because nothing here accepts one from its caller.
// @spec ADR-090 D3 — the evidence packet this reader returns is capped at
// `maxPacketBytes` (default 8 KiB): once a hit no longer fits, every hit after
// it in rank order is dropped too (rank order already puts the best-scored
// first, so dropping the tail is dropping the least relevant, not an
// arbitrary cut).
//
// This module returns evidence only — records and retrieval references — and
// never composes or records anything. Composition through the Context
// Composer (ADR-091 D7), when it happens at all, is exactly one call per
// turn owned by `server-line-answer.js`, merging this evidence with MSP
// slices under one shared budget; a second, independent composition here
// (an earlier version of this file had one) produced a second ContextReceipt
// for the same model invocation, which FR-234/SDD-100 forbid.
// @tested tests/unit/corpus-knowledge-reader.test.js

const DEFAULT_TOP_K = 5
const DEFAULT_MAX_PACKET_BYTES = 8192
const SHA256 = /^[a-f0-9]{64}$/

function byteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * `answerBusinessQuestion` never hands this reader the caller's raw question
 * text — only the registered query `selectRegisteredQuery` already derived
 * from it (`{queryId, params}`), the same shape the postgres business-
 * knowledge reader consumes. Reducing it back to a free-text search string is
 * this reader's own concern; it changes nothing about what that derivation
 * already decided.
 */
function queryTextFromRegisteredQuery({ queryId, params } = {}) {
  if (queryId === 'product_detail') return typeof params?.productCode === 'string' ? params.productCode : ''
  if (queryId === 'product_compare') return Array.isArray(params?.productCodes) ? params.productCodes.join(' ') : ''
  return typeof params?.term === 'string' ? params.term : ''
}

function emptyResult() {
  return { records: [], retrievalRefs: [], meta: { corpusGeneration: null, manifestHash: null, ranking: null } }
}

function parseJson(value) {
  if (typeof value !== 'string') return null
  try { return JSON.parse(value) } catch { return null }
}

function sameManifestEntry(left, right) {
  return Boolean(left && right && hashGenesisRag17Json(left) === hashGenesisRag17Json(right))
}

function samePublishedIdentity(left, right) {
  return Boolean(left && right && left.id === right.id && left.corpusId === right.corpusId
    && left.sourceId === right.sourceId && left.revision === right.revision
    && left.sourceVersion === right.sourceVersion && left.contentHash === right.contentHash
    && left.status === right.status && left.executionRunId === right.executionRunId
    && left.snapshotId === right.snapshotId && left.snapshotGeneration === right.snapshotGeneration
    && left.receiptHash === right.receiptHash && left.rawArtifactId === right.rawArtifactId
    && left.parsedArtifactId === right.parsedArtifactId && left.content === right.content
    && left.sourceMetaJson === right.sourceMetaJson)
}

function sameSourceIdentity(left, right) {
  return Boolean(left && right && left.id === right.id && left.corpusId === right.corpusId
    && left.sourceKey === right.sourceKey && left.kind === right.kind && left.title === right.title
    && left.fileAssetId === right.fileAssetId && left.activeIngestionId === right.activeIngestionId
    && left.desiredRevision === right.desiredRevision && left.version === right.version
    && left.revokedAt === right.revokedAt && left.deletedAt === right.deletedAt)
}

function sameAssetIdentity(left, right) {
  return Boolean(left && right && left.id === right.id && left.tenantId === right.tenantId
    && left.businessId === right.businessId && left.projectId === right.projectId
    && left.code === right.code && left.name === right.name && left.mime === right.mime && left.size === right.size
    && left.sha256 === right.sha256 && left.version === right.version
    && left.status === right.status && left.deletedAt === right.deletedAt
    && left.storageKind === right.storageKind && left.blobRef === right.blobRef)
}

export function uniquePublishedCatalogEntry(entries, externalId) {
  if (!Array.isArray(entries) || typeof externalId !== 'string' || !externalId) return null
  const matches = entries.filter((entry) => entry?.fileAssetId && entry.title === `PriceListEntry ${externalId}`)
  return matches.length === 1 ? matches[0] : null
}

function acceptedCatalogSource({ ingestion, source, asset, entry, descriptor, record, sourceMeta, corpusId, tenantId, businessId, productId, quantity }) {
  const externalId = `commerce-price:${productId}:${quantity}`
  return ingestion.status === 'PUBLISHED'
    && ingestion.corpusId === corpusId
    && ingestion.sourceId === source.id
    && ingestion.revision === entry.revision
    && ingestion.sourceVersion === entry.sourceVersion
    && ingestion.contentHash === entry.contentHash
    && ingestion.contentHash === hashGenesisRag17Text(ingestion.content)
    && ingestion.executionRunId === entry.executionRunId
    && ingestion.snapshotId === entry.snapshotId
    && ingestion.snapshotGeneration === entry.generation
    && ingestion.receiptHash === entry.receiptHash
    && ingestion.rawArtifactId === entry.rawArtifactId
    && ingestion.parsedArtifactId === entry.parsedArtifactId
    && source.corpusId === corpusId
    && source.id === entry.sourceId
    && source.kind === 'FILE'
    && source.title === entry.title
    && source.fileAssetId === entry.fileAssetId
    && source.activeIngestionId === ingestion.id
    && source.desiredRevision === ingestion.revision
    && source.revokedAt === null && source.deletedAt === null
    && asset.id === entry.fileAssetId
    && asset.tenantId === tenantId
    && asset.businessId === businessId
    && asset.projectId === null
    && asset.status === 'ACTIVE' && asset.deletedAt === null
    && /^PCAT-[a-f0-9]{64}$/.test(asset.code || '')
    && asset.name === `commerce-price-${productId}.json`
    && SHA256.test(asset.sha256 || '')
    && descriptor.format === SMARTGIFT_CATALOG_FORMAT
    && descriptor.provider === SMARTGIFT_CATALOG_PROVIDER
    && descriptor.entityType === 'PriceListEntry'
    && descriptor.contentType === SMARTGIFT_CATALOG_CONTENT_TYPE
    && descriptor.externalId === externalId
    && Number.isSafeInteger(descriptor.recordIndex) && descriptor.recordIndex >= 0
    && Number.isSafeInteger(descriptor.recordCount) && descriptor.recordCount > descriptor.recordIndex
    && descriptor.fileSha256 === asset.sha256
    && record.entityType === 'PriceListEntry'
    && record.externalId === externalId
    && record.productExternalId === `commerce-sku:${productId}`
    && record.qty === quantity
    && record.srpSource === 'COMMERCE_APPROVED_COMPUTED'
    && ingestion.sourceVersion === asset.sha256
    && descriptor.fileSha256 === asset.sha256
    && sourceMeta?.kind === 'FILE'
    && sourceMeta.title === source.title
    && sourceMeta.sourceKey === source.sourceKey
    && sourceMeta.fileAssetId === asset.id
    && sourceMeta.fileAssetVersion === asset.version
    && sourceMeta.mime === asset.mime
    && sourceMeta.size === Buffer.byteLength(ingestion.content, 'utf8')
    && sourceMeta.storageKind === asset.storageKind
    && sourceMeta.sourceVersion === ingestion.sourceVersion
    && sourceMeta.contentHash === ingestion.contentHash
    && sourceMeta.structured?.format === descriptor.format
    && sourceMeta.structured?.provider === descriptor.provider
    && sourceMeta.structured?.entityType === descriptor.entityType
    && sourceMeta.structured?.contentType === descriptor.contentType
    && sourceMeta.structured?.externalId === descriptor.externalId
    && sourceMeta.structured?.recordIndex === descriptor.recordIndex
    && sourceMeta.structured?.recordCount === descriptor.recordCount
    && sourceMeta.structured?.fileSha256 === descriptor.fileSha256
    && source.sourceKey === smartGiftSourceKey({ fileName: asset.name, recordCode: externalId })
}

/**
 * @param {object} input
 * @param {string} input.tenantId — the job's already-verified tenant. Not
 *   itself an authorization field on `queryKnowledgeCorpus` (Business scope is
 *   what authorizes a read there), but required here so a caller cannot build
 *   this reader from anything less than the same server-derived scope the
 *   rest of the turn already checked.
 * @param {string} input.businessId — the one Business this reader may ever read.
 * @param {number} [input.topK] — ADR-090 D3 budget, default 5.
 * @param {number} [input.maxPacketBytes] — ADR-090 D3 budget, default 8192.
 */
export function createCorpusKnowledgeReader({
  tenantId,
  businessId,
  topK = DEFAULT_TOP_K,
  maxPacketBytes = DEFAULT_MAX_PACKET_BYTES,
  queryKnowledgeCorpus: queryCorpus = defaultQueryKnowledgeCorpus,
  db = prisma,
  env = process.env,
  objectStoragePort = null,
  fileContentResolver = resolveFileAssetContent,
} = {}) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || typeof businessId !== 'string' || !businessId.trim()) {
    throw Object.assign(new Error('CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED'), { code: 'CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED' })
  }
  // A read-only capability naming exactly this Business. Frozen, never
  // widened, never accepted as a constructor argument from a caller.
  const viewer = Object.freeze({ visibleBusinessIds: Object.freeze([businessId]) })

  // @req FR-291 — expose only the exact record from the current authorized
  // Knowledge publication, after receipt-backed manifest and PCAT byte checks.
  // @spec ADR-098, ADR-090, SEC-001
  // @tested tests/integration/line-published-price-reader.test.js
  async function readPublishedCatalogRecord({ productId, quantity } = {}) {
    if (typeof productId !== 'string' || !productId.trim() || !Number.isSafeInteger(quantity) || quantity < 1) return null
    const startedAt = new Date()
    const externalId = `commerce-price:${productId}:${quantity}`
    try {
      const manifest = await readAuthorizedKnowledgeManifest({ businessId, projectId: null }, { db, viewer, env })
      if (manifest.scope?.tenantId !== tenantId || manifest.scope?.businessId !== businessId) return null
      // Multiple currently published candidates for one exact product/quantity
      // have no declared precedence. Refuse ambiguity instead of selecting by
      // database order or a caller-controlled idempotency key.
      const entry = uniquePublishedCatalogEntry(manifest.entries, externalId)
      if (!entry) return null
      if (!entry.sourceId || !entry.ingestionId || !entry.fileAssetId
        || !sameManifestEntry(entry.scope, manifest.scope)
        || entry.title !== `PriceListEntry ${externalId}`
        || entry.scope?.tenantId !== tenantId || entry.scope?.businessId !== businessId) return null
      const [source, loadedIngestion] = await Promise.all([
        db.knowledgeSource.findUnique({ where: { id: entry.sourceId } }),
        db.knowledgeIngestion.findUnique({ where: { id: entry.ingestionId } }),
      ])
      if (!source || !loadedIngestion) return null
      const sourceMeta = parseJson(loadedIngestion.sourceMetaJson)
      const descriptor = sourceMeta?.structured
      const assetBefore = await db.fileAsset.findUnique({ where: { id: entry.fileAssetId } })
      if (!assetBefore || assetBefore.tenantId !== tenantId || assetBefore.businessId !== businessId
        || assetBefore.projectId !== null || assetBefore.storageKind !== 'MANAGED_BLOB'
        || assetBefore.mime !== SMARTGIFT_CATALOG_CONTENT_TYPE
        || !/^PCAT-[a-f0-9]{64}$/.test(assetBefore.code || '')) return null
      const { asset: resolvedAsset, content: rawContent } = await fileContentResolver(entry.fileAssetId, {
        db,
        visibleBusinessIds: [businessId],
        objectStoragePort,
      })
      if (!sameAssetIdentity(assetBefore, resolvedAsset)) return null
      const bytes = Buffer.from(rawContent)
      const fileSha256 = createHash('sha256').update(bytes).digest('hex')
      if (bytes.length !== assetBefore.size || fileSha256 !== assetBefore.sha256 || fileSha256 !== descriptor?.fileSha256) return null
      let content
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return null }
      const split = splitSmartGiftCatalogRecords({
        content,
        fileAssetId: assetBefore.id,
        fileSha256,
        fileName: assetBefore.name,
      })
      if (split.recordCount !== descriptor?.recordCount || !Number.isSafeInteger(descriptor?.recordIndex)
        || descriptor.recordIndex < 0 || descriptor.recordIndex >= split.recordCount) return null
      const admittedRecord = split.records.find((record) => record.index === descriptor.recordIndex)
      if (!admittedRecord || admittedRecord.externalId !== externalId
        || admittedRecord.content !== loadedIngestion.content
        || admittedRecord.contentHash !== loadedIngestion.contentHash
        || descriptor.entityType !== admittedRecord.entityType
        || source.sourceKey !== admittedRecord.sourceKey) return null
      if (!acceptedCatalogSource({
        ingestion: { ...loadedIngestion, sourceMeta }, source, asset: assetBefore, entry, descriptor,
        record: admittedRecord.record, sourceMeta, corpusId: manifest.corpusId, tenantId, businessId, productId, quantity,
      })) return null

      const [finalManifest, finalSource, finalIngestion, finalAsset] = await Promise.all([
        readAuthorizedKnowledgeManifest({ businessId, projectId: null }, { db, viewer, env }),
        db.knowledgeSource.findUnique({ where: { id: source.id } }),
        db.knowledgeIngestion.findUnique({ where: { id: loadedIngestion.id } }),
        db.fileAsset.findUnique({ where: { id: assetBefore.id } }),
      ])
      const finalEntry = finalManifest.entries.find((candidate) => candidate.sourceId === entry.sourceId && candidate.ingestionId === entry.ingestionId)
      if (finalManifest.scope?.tenantId !== tenantId || finalManifest.scope?.businessId !== businessId
        || finalManifest.corpusId !== manifest.corpusId
        || finalManifest.corpusGeneration !== manifest.corpusGeneration
        || finalManifest.manifestHash !== manifest.manifestHash
        || !sameManifestEntry(entry, finalEntry)
        || !sameSourceIdentity(source, finalSource)
        || !samePublishedIdentity(loadedIngestion, finalIngestion)
        || !sameAssetIdentity(assetBefore, finalAsset)) return null

      const record = {
        entityType: admittedRecord.record.entityType,
        externalId: admittedRecord.record.externalId,
        productExternalId: admittedRecord.record.productExternalId,
        qty: admittedRecord.record.qty,
        srpUnitPriceThb: admittedRecord.record.srpUnitPriceThb,
        srpSource: admittedRecord.record.srpSource,
      }
      const observedTo = new Date().toISOString()
      return {
        record,
        assetId: assetBefore.id,
        assetCode: assetBefore.code,
        assetSha256: assetBefore.sha256,
        publicationDigest: hashGenesisRag17Json({
          schema: 'zuri.line-published-catalog-source.v1',
          tenantId,
          businessId,
          corpusId: manifest.corpusId,
          corpusGeneration: manifest.corpusGeneration,
          manifestHash: manifest.manifestHash,
          entry: {
            sourceId: entry.sourceId, ingestionId: entry.ingestionId, sourceVersion: entry.sourceVersion,
            revision: entry.revision, executionRunId: entry.executionRunId, snapshotId: entry.snapshotId,
            generation: entry.generation, receiptHash: entry.receiptHash, rawArtifactId: entry.rawArtifactId,
            parsedArtifactId: entry.parsedArtifactId, contentHash: entry.contentHash, fileAssetId: entry.fileAssetId,
          },
          source: { id: source.id, version: source.version, activeIngestionId: source.activeIngestionId },
          asset: { id: assetBefore.id, code: assetBefore.code, sha256: assetBefore.sha256, version: assetBefore.version },
          record: { externalId, quantity, productExternalId: record.productExternalId },
        }),
        observedFrom: startedAt.toISOString(),
        observedTo,
      }
    } catch {
      // This is an internal source capability. Its boundary is a fail-closed
      // candidate read; callers receive no Knowledge denial or source detail.
      return null
    }
  }

  return {
    async readPublishedCatalogRecord(input) {
      return readPublishedCatalogRecord(input)
    },
    async query(input) {
      const queryText = queryTextFromRegisteredQuery(input).trim()
      if (!queryText) return emptyResult()
      // NOTE: queryKnowledgeCorpus takes no AbortSignal today (grep of its
      // options and the underlying msp_pipeline_query/worker loopback contract
      // confirms this), so the budget timeout in line-knowledge-grounding.js
      // stops WAITING at the deadline but cannot cancel this in-flight call;
      // it keeps running detached and its late result is discarded. Passing a
      // signal through once the corpus service accepts one is a follow-up.
      const result = await queryCorpus({ businessId, query: queryText, topK }, { viewer })
      const hits = Array.isArray(result?.results) ? result.results : []
      if (!hits.length) return emptyResult()

      const records = []
      const retrievalRefs = []
      let usedBytes = 0
      for (const hit of hits) {
        const size = byteLength(hit.text)
        // One oversized (or later) hit is dropped on its own; it never blocks
        // an earlier, smaller hit that already fit (ADR-090 D3).
        if (usedBytes + size > maxPacketBytes) continue
        usedBytes += size
        const ref = {
          citationId: hit.citationId,
          sourceId: hit.sourceId,
          snapshotId: hit.snapshotId,
          generation: hit.generation,
          corpusGeneration: result.corpusGeneration,
          manifestHash: result.manifestHash,
        }
        records.push({ kind: 'CORPUS_CHUNK', text: hit.text, ...ref })
        retrievalRefs.push(ref)
      }
      return {
        records,
        retrievalRefs,
        meta: { corpusGeneration: result.corpusGeneration, manifestHash: result.manifestHash, ranking: result.ranking },
      }
    },
  }
}
