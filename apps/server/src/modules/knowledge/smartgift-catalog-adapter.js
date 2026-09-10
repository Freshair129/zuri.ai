import { z } from 'zod'
import { canonicalGenesisRag17Json, hashGenesisRag17Json, hashGenesisRag17Text } from './genesisrag17-contract'
import { findZeroPiiViolation } from './structured-record-policy'

// @req FR-187 — one SmartGift catalog projection is split into N immutable
// structured records before Stage 1: identity, byte-stable hashes and the
// Zero-PII predicate are computed here, and nothing downstream is synthesized.
// @spec ADR-075 D2, ADR-075 D3, ADR-075 D4, ADR-075 D5, BR-002
// @tested tests/unit/smartgift-catalog-adapter.test.js, tests/integration/smartgift-catalog-admission.test.js

/** The only structured format Phase 1 admits. */
export const SMARTGIFT_CATALOG_FORMAT = 'SMARTGIFT_CATALOG_V1'
/** The provider recorded on the raw record; it is what arms the Stage 5 gate. */
export const SMARTGIFT_CATALOG_PROVIDER = 'SMARTGIFT_CATALOG'
/** Structured records travel as canonical JSON text, not prose. */
export const SMARTGIFT_CATALOG_CONTENT_TYPE = 'application/json'
/** Prefix of every derived source key, so one file's records group by name. */
export const SMARTGIFT_CATALOG_SOURCE_PREFIX = 'smartgift-catalog'
/**
 * A file-level bound distinct from the 1 MiB per-record limit. Upstream's real
 * `pricelist_master.json` is ~6.4 MB, so the per-record limit cannot double as
 * the file limit; the record limit still applies to each split record.
 */
export const SMARTGIFT_CATALOG_MAX_FILE_BYTES = 16 * 1024 * 1024

export const SMARTGIFT_CATALOG_ENTITY_TYPES = Object.freeze(['ProductMaster', 'BundleOffer', 'PriceListEntry'])

function adapterError(status, code, message, details) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

const zText = z.string().trim().min(1).max(500)
const zMoney = z.number().finite().nonnegative()
const zQty = z.number().int().positive()

const zPriceTier = z.object({
  minQty: zQty,
  unitPriceThb: zMoney,
}).strict()

const zProvenance = z.object({
  upstreamFile: zText,
  upstreamRecordId: zText,
  supplementUpstreamFile: zText.nullish(),
}).strict()

const zProductMaster = z.object({
  entityType: z.literal('ProductMaster'),
  externalId: zText,
  code: zText,
  nameTh: zText,
  nameEn: zText.nullish(),
  category: zText.nullish(),
  productFamily: zText.nullish(),
  // BR-002 / ADR-075 D4: FlowAccount's code for our product is an attribute of
  // the record, never its key. Identity stays `externalId`.
  flowaccountModelCode: zText.nullish(),
  dimensionsCm: z.object({ height: zMoney, length: zMoney, width: zMoney }).strict().nullish(),
  unitWeightKg: zMoney.nullish(),
  srpPriceThbQty1: zMoney.nullish(),
  priceTiersThb: z.array(zPriceTier).default([]),
  provenance: zProvenance,
}).strict()

const zBundleOffer = z.object({
  entityType: z.literal('BundleOffer'),
  externalId: zText,
  code: zText,
  nameTh: zText,
  nameEn: zText.nullish(),
  occasion: zText.nullish(),
  giftTier: zText.nullish(),
  recipientSegment: zText.nullish(),
  flowaccountOfferCode: zText.nullish(),
  componentSrpQty1TotalThb: zMoney.nullish(),
  components: z.array(z.object({
    productExternalId: zText,
    qty: zQty,
    srpQty1Thb: zMoney,
  }).strict()).default([]),
  offerPriceTiersThb: z.array(zPriceTier).default([]),
  provenance: zProvenance,
}).strict()

const zPriceListEntry = z.object({
  entityType: z.literal('PriceListEntry'),
  externalId: zText,
  productExternalId: zText,
  qty: zQty,
  srpUnitPriceThb: zMoney,
  srpSource: zText.nullish(),
  provenance: zProvenance,
}).strict()

export const zSmartGiftCatalogRecord = z.discriminatedUnion('entityType', [
  zProductMaster,
  zBundleOffer,
  zPriceListEntry,
])

export const zSmartGiftCatalogFile = z.array(zSmartGiftCatalogRecord).min(1)

/**
 * The record's key inside the file. `code` and `externalId` agree for the two
 * shapes that carry both; `PriceListEntry` has only `externalId`, so
 * `externalId` is the one field that is always the record's identity.
 */
export function smartGiftRecordCode(record) {
  return String(record?.externalId ?? '')
}

export function smartGiftSourceKey({ fileName, recordCode }) {
  return `${SMARTGIFT_CATALOG_SOURCE_PREFIX}:${fileName}#${recordCode}`
}

/**
 * A per-record idempotency seed derived from file identity plus the record key.
 * It deliberately excludes the caller's request key, so re-admitting identical
 * bytes is `unchanged` for every record no matter which request key is used.
 */
export function smartGiftRecordIdempotencySeed({ fileAssetId, fileSha256, externalId }) {
  return hashGenesisRag17Json({ fileAssetId, fileSha256, externalId })
}

/** Parse and validate the whole projection. Never partially accepts a file. */
export function parseSmartGiftCatalogFile(content) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    throw adapterError(422, 'KNOWLEDGE_STRUCTURED_FORMAT_INVALID', 'SmartGift catalog file is not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw adapterError(422, 'KNOWLEDGE_STRUCTURED_FORMAT_INVALID', 'SmartGift catalog file must be a JSON array of records')
  }
  const result = zSmartGiftCatalogFile.safeParse(parsed)
  if (!result.success) {
    throw adapterError(422, 'KNOWLEDGE_STRUCTURED_RECORD_INVALID', 'SmartGift catalog record does not match a known shape', {
      issues: result.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    })
  }
  return result.data
}

/**
 * Split one authorized, byte-frozen projection into the immutable per-record
 * admissions Stage 1 receives. `content` is the exact UTF-8 text of the file;
 * `fileSha256` is SmartGift's registry hash for those bytes (ADR-075 D3), which
 * is also the FileAsset's own sha256 because they are the same bytes.
 *
 * Denied records are returned separately rather than throwing: a customer-shaped
 * row must never become a `KnowledgeSource`, but it must not stop the other
 * records in the same file either (ADR-075 D5 is a per-record deny).
 */
export function splitSmartGiftCatalogRecords({ content, fileAssetId, fileSha256, fileName, maxRecordBytes = null }) {
  if (typeof content !== 'string' || !content.length) {
    throw adapterError(422, 'KNOWLEDGE_CONTENT_EMPTY', 'SmartGift catalog file is empty')
  }
  if (typeof fileAssetId !== 'string' || !fileAssetId) throw adapterError(400, 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID', 'SmartGift catalog split requires a fileAssetId')
  if (typeof fileSha256 !== 'string' || !fileSha256) throw adapterError(400, 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID', 'SmartGift catalog split requires the frozen file sha256')
  if (typeof fileName !== 'string' || !fileName) throw adapterError(400, 'KNOWLEDGE_STRUCTURED_SOURCE_INVALID', 'SmartGift catalog split requires the file name')

  const records = parseSmartGiftCatalogFile(content)
  const accepted = []
  const denied = []
  const seen = new Set()
  records.forEach((record, index) => {
    const externalId = smartGiftRecordCode(record)
    if (seen.has(externalId)) {
      throw adapterError(422, 'KNOWLEDGE_STRUCTURED_RECORD_DUPLICATE', 'SmartGift catalog file repeats one record identity', { externalId })
    }
    seen.add(externalId)
    const canonicalJson = canonicalGenesisRag17Json(record)
    const sourceKey = smartGiftSourceKey({ fileName, recordCode: externalId })
    const violation = findZeroPiiViolation(record, { sourceId: sourceKey, sourceUri: `${SMARTGIFT_CATALOG_SOURCE_PREFIX}:${fileName}` })
    if (violation) {
      denied.push({ index, externalId, entityType: record.entityType, field: violation.field, term: violation.term })
      return
    }
    const bytes = Buffer.byteLength(canonicalJson, 'utf8')
    if (Number.isInteger(maxRecordBytes) && bytes > maxRecordBytes) {
      throw adapterError(413, 'KNOWLEDGE_CONTENT_TOO_LARGE', 'SmartGift catalog record exceeds the per-record limit', { externalId, bytes })
    }
    accepted.push({
      index,
      record,
      entityType: record.entityType,
      externalId,
      sourceKey,
      title: `${record.entityType} ${externalId}`,
      content: canonicalJson,
      contentHash: hashGenesisRag17Text(canonicalJson),
      version: fileSha256,
      idempotencySeed: smartGiftRecordIdempotencySeed({ fileAssetId, fileSha256, externalId }),
      bytes,
    })
  })
  return { fileName, fileAssetId, fileSha256, recordCount: records.length, records: accepted, denied }
}
