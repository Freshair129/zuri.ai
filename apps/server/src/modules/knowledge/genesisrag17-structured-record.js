import { z } from 'zod'
import { canonicalGenesisRag17Json } from './genesisrag17-contract'
import {
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
  zBundleOffer,
  zPriceListEntry,
  zProductMaster,
} from './smartgift-catalog-adapter'

// @req FR-188 — the Stage 2/7 structured-record profile `genesisrag17-parser-2`
// renders each SmartGift catalog record into one DESCRIPTIVE section (exactly
// one mention, no date) plus one CLAIM section per relation whose entire text
// is the canonical JSON triple, and the pinned Stage 8 recognizer
// `genesisrag17-structured-recognizer-1` types those occurrences with the
// SmartGift code verbatim as the resolution key.
// @spec ADR-075, ADR-073, docs/plans/GENESISRAG17-CONTRACT.md, docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md
// @tested tests/unit/genesisrag17-parser-2.test.js, tests/integration/genesisrag17-parser-2.test.js

/** Stage 2 profile for structured SmartGift catalog records (contract rev 2, §A). */
export const GENESIS_RAG17_PARSER_VERSION_2 = 'genesisrag17-parser-2'
/** The one pinned exception to the `defaultRecognizer`-only Stage 8 guard (C-6). */
export const GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION = 'genesisrag17-structured-recognizer-1'
export const GENESIS_RAG17_STRUCTURED_RECOGNIZER_PROVENANCE = 'genesisrag17-source:structured'

/** Chunk boundaries are the rendered sections; the 80-token window is bypassed. */
export const GENESIS_RAG17_STRUCTURED_CHUNK_BOUNDARY = 'record-section'

export const STRUCTURED_SEMANTIC_TYPES = Object.freeze({
  PRODUCT: 'Product',
  PACKAGE: 'PACKAGE',
  CATEGORY: 'CATEGORY',
  PRICE_TIER: 'PRICE_TIER',
})

export const STRUCTURED_PREDICATES = Object.freeze({
  HAS_COMPONENT: 'HAS_COMPONENT',
  PRICED_AT: 'PRICED_AT',
  IN_CATEGORY: 'IN_CATEGORY',
})

/** Object endpoint of each ontology_v2 predicate this profile emits (C-2). */
const OBJECT_TYPE_BY_PREDICATE = Object.freeze({
  HAS_COMPONENT: STRUCTURED_SEMANTIC_TYPES.PRODUCT,
  PRICED_AT: STRUCTURED_SEMANTIC_TYPES.PRICE_TIER,
  IN_CATEGORY: STRUCTURED_SEMANTIC_TYPES.CATEGORY,
})

/** A section's own entity, named by the record shape that produced it. */
const OWN_TYPE_BY_ENTITY_TYPE = Object.freeze({
  ProductMaster: STRUCTURED_SEMANTIC_TYPES.PRODUCT,
  BundleOffer: STRUCTURED_SEMANTIC_TYPES.PACKAGE,
  PriceListEntry: STRUCTURED_SEMANTIC_TYPES.PRICE_TIER,
})

/**
 * SmartGift's bundle code namespace (every BundleOffer `code` is `PKG-…`). A
 * claim subject that is not the record's own entity — a PriceListEntry's
 * priced item — is typed by this rule. The renderer refuses any record whose
 * own type disagrees with it, so the rule can never silently mistype a record.
 */
export const SMARTGIFT_PACKAGE_CODE_PREFIX = 'PKG-'

export function structuredItemSemanticType(code) {
  return String(code).startsWith(SMARTGIFT_PACKAGE_CODE_PREFIX)
    ? STRUCTURED_SEMANTIC_TYPES.PACKAGE
    : STRUCTURED_SEMANTIC_TYPES.PRODUCT
}

export function isStructuredCatalogProvider(provider) {
  return provider === SMARTGIFT_CATALOG_PROVIDER
}

// Mirrors GKS Stage 10/12 exactly (GKS gks-core pipeline.mjs parseStructuredClaim
// and temporalClaim). A claim section that any of these would read as a
// negation, a second date or an unmapped temporal phrase is refused here, at
// Stage 2, instead of being held downstream as `temporal_unmapped`.
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?\b/g
const HUMAN_DATE = /\b(?:\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i
const NUMERIC_DATE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/
const RELATIVE_DATE = /\b(?:yesterday|today|tomorrow|last\s+(?:week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|next\s+(?:week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|this\s+(?:week|month|year))\b/i
const TEMPORAL_LANGUAGE = /\b(?:on|from|until|through|before|after|during|since|between|effective(?:\s+on)?|as\s+of|as[- ]at|by|in)\s+(?:\d{4}|last\s+year|next\s+year|the\s+past|the\s+next|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|yesterday|today|tomorrow|(?:last|next|this)\s+(?:week|month|year|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i
const CLAIM_NEGATION = /\b(?:does not|did not|didn't|doesn't|never)\b/i

export function isoDatesIn(text) {
  return [...String(text).matchAll(ISO_DATE)].map((match) => match[0])
}

export function hasUnmappedTemporalLanguage(text) {
  return HUMAN_DATE.test(text) || NUMERIC_DATE.test(text) || RELATIVE_DATE.test(text) || TEMPORAL_LANGUAGE.test(text)
}

function structuredError(message, details, code = 'GENESISRAG17_STRUCTURED_RECORD_INVALID') {
  const error = new Error(message)
  error.status = 422
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/**
 * Stage 2 validates the shape it renders. Unknown top-level fields are
 * stripped, not rejected: they are never rendered, and a customer-shaped
 * field must still reach the Stage 5 Zero-PII deny (ADR-075 D5) with its own
 * terminal evidence rather than dying earlier as a shape error. Admission
 * (FR-187) stays strict.
 */
const zStage2Record = z.discriminatedUnion('entityType', [
  zProductMaster.strip(),
  zBundleOffer.strip(),
  zPriceListEntry.strip(),
])

function assertCode(code, label, { header = false } = {}) {
  if (typeof code !== 'string' || !code || code !== code.trim()) {
    throw structuredError(`SmartGift ${label} code is missing or not trimmed`, { label })
  }
  // A claim's subject/object must be an exact substring of its JSON text, so a
  // code JSON would escape (quote, backslash, control character) is refused.
  if (JSON.stringify(code) !== `"${code}"`) throw structuredError(`SmartGift ${label} code needs JSON escaping`, { label })
  if (header && /\s/u.test(code)) throw structuredError(`SmartGift ${label} code contains whitespace`, { label })
}

function priceTierCode(itemCode, qty, unitPriceThb) {
  const satang = Math.round(unitPriceThb * 100)
  if (!Number.isSafeInteger(satang) || Math.abs(unitPriceThb * 100 - satang) > 1e-6) {
    throw structuredError('SmartGift price is not a whole number of satang', { label: 'price' })
  }
  return `${itemCode}:qty${qty}:${satang}`
}

function oneLine(value) {
  return String(value).replace(/\s*[\r\n]+\s*/gu, ' ')
}

function field(key, value) {
  if (value === null || value === undefined || value === '') return null
  return `${key}: ${oneLine(value)}`
}

function tierList(tiers) {
  return tiers.length ? tiers.map((tier) => `qty ${tier.minQty} = ${tier.unitPriceThb} THB`).join('; ') : null
}

function descriptiveText(entityType, ownCode, lines) {
  return [`${entityType} ${ownCode}`, ...lines.filter((line) => line !== null)].join('\n')
}

/** The exact claim text: canonical JSON (sorted keys, no whitespace). */
export function structuredClaimText({ subject, predicate, object, catalogVersionDate = null }) {
  return canonicalGenesisRag17Json({
    subject,
    predicate,
    object,
    ...(catalogVersionDate ? { catalogVersionDate } : {}),
  })
}

function assertClaimText(text, { subject, object, catalogVersionDate }) {
  if (subject === object || subject.toLowerCase().replace(/[\s_-]+/gu, ' ') === object.toLowerCase().replace(/[\s_-]+/gu, ' ')) {
    throw structuredError('SmartGift relation names the same code as subject and object', { label: 'relation' })
  }
  if (/[?]/u.test(text) || CLAIM_NEGATION.test(text)) throw structuredError('SmartGift claim text would be read as a question or negation', { label: 'relation' })
  const dates = isoDatesIn(text)
  if (dates.length !== (catalogVersionDate ? 1 : 0) || (catalogVersionDate && dates[0] !== catalogVersionDate)) {
    throw structuredError('SmartGift claim text must carry exactly the catalog version date, or no date', { label: 'relation' })
  }
  if (hasUnmappedTemporalLanguage(text)) throw structuredError('SmartGift claim text contains temporal language GKS would hold as unmapped', { label: 'relation' })
}

function recordRelations(record) {
  if (record.entityType === 'ProductMaster') {
    return record.category ? [{ subject: record.code, predicate: STRUCTURED_PREDICATES.IN_CATEGORY, object: record.category }] : []
  }
  if (record.entityType === 'BundleOffer') {
    const seen = new Set()
    const relations = []
    for (const component of record.components) {
      if (seen.has(component.productExternalId)) throw structuredError('SmartGift bundle repeats one component', { label: 'component' })
      seen.add(component.productExternalId)
      relations.push({ subject: record.code, predicate: STRUCTURED_PREDICATES.HAS_COMPONENT, object: component.productExternalId })
    }
    if (record.category) relations.push({ subject: record.code, predicate: STRUCTURED_PREDICATES.IN_CATEGORY, object: record.category })
    return relations
  }
  return [{ subject: record.productExternalId, predicate: STRUCTURED_PREDICATES.PRICED_AT, object: priceTierCode(record.productExternalId, record.qty, record.srpUnitPriceThb) }]
}

function ownCode(record) {
  if (record.entityType === 'PriceListEntry') return priceTierCode(record.productExternalId, record.qty, record.srpUnitPriceThb)
  if (record.code !== record.externalId) throw structuredError('SmartGift record code and externalId disagree', { label: 'code' })
  return record.code
}

function renderDescriptive(record, code) {
  if (record.entityType === 'ProductMaster') {
    return descriptiveText(record.entityType, code, [
      field('nameEn', record.nameEn),
      field('nameTh', record.nameTh),
      field('category', record.category),
      field('productFamily', record.productFamily),
      field('flowaccountModelCode', record.flowaccountModelCode),
      record.dimensionsCm ? `dimensionsCm: length ${record.dimensionsCm.length} x width ${record.dimensionsCm.width} x height ${record.dimensionsCm.height}` : null,
      field('unitWeightKg', record.unitWeightKg),
      field('srpPriceThbQty1', record.srpPriceThbQty1),
      field('priceTiersThb', tierList(record.priceTiersThb)),
    ])
  }
  if (record.entityType === 'BundleOffer') {
    return descriptiveText(record.entityType, code, [
      field('nameEn', record.nameEn),
      field('nameTh', record.nameTh),
      field('category', record.category),
      field('occasion', record.occasion),
      field('giftTier', record.giftTier),
      field('recipientSegment', record.recipientSegment),
      field('flowaccountOfferCode', record.flowaccountOfferCode),
      field('componentSrpQty1TotalThb', record.componentSrpQty1TotalThb),
      field('components', record.components.length ? record.components.map((component) => `${component.productExternalId} x${component.qty} srp ${component.srpQty1Thb} THB`).join('; ') : null),
      field('offerPriceTiersThb', tierList(record.offerPriceTiersThb)),
    ])
  }
  return descriptiveText(record.entityType, code, [
    field('externalId', record.externalId),
    field('item', record.productExternalId),
    field('qty', record.qty),
    field('srpUnitPriceThb', record.srpUnitPriceThb),
    field('srpSource', record.srpSource),
  ])
}

/**
 * Parse the raw content of one structured source: one record object (the
 * FR-187 per-record admission) or a JSON array of records. Never partially
 * accepts; error details carry field paths and codes, never record values.
 */
export function parseStructuredCatalogRecords(content) {
  let value
  try {
    value = JSON.parse(String(content ?? ''))
  } catch {
    throw structuredError('SmartGift structured source is not valid JSON')
  }
  const list = Array.isArray(value) ? value : [value]
  if (!list.length) throw structuredError('SmartGift structured source holds no records')
  const records = list.map((item, index) => {
    const result = zStage2Record.safeParse(item)
    if (!result.success) {
      throw structuredError('SmartGift structured record does not match a known catalog shape', {
        index,
        issues: result.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
      })
    }
    return result.data
  })
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record.externalId)) throw structuredError('SmartGift structured source repeats one record identity')
    seen.add(record.externalId)
  }
  // C-5 / C-10: one source is uniformly dated or uniformly undated.
  const dates = new Set(records.map((record) => record.catalogVersionDate ?? null))
  if (dates.size > 1) throw structuredError('SmartGift structured source mixes catalog version dates')
  return { records, catalogVersionDate: [...dates][0] }
}

/**
 * Render the parsed-artifact content for `genesisrag17-parser-2`. Sections are
 * joined by one blank line; every section offset is an exact UTF-16 range of
 * the returned text, so each chunk stays a literal substring of the parsed
 * content the Stage 9 batch carries.
 */
export function renderStructuredCatalogDocument(content) {
  const { records, catalogVersionDate } = parseStructuredCatalogRecords(content)
  const pieces = []
  records.forEach((record, recordIndex) => {
    const code = ownCode(record)
    assertCode(code, `${record.entityType} own`, { header: true })
    const ownType = OWN_TYPE_BY_ENTITY_TYPE[record.entityType]
    if (record.entityType !== 'PriceListEntry' && structuredItemSemanticType(code) !== ownType) {
      throw structuredError('SmartGift record code does not match its type namespace', { label: 'code' })
    }
    const descriptive = renderDescriptive(record, code)
    if (isoDatesIn(descriptive).length) throw structuredError('SmartGift descriptive section must carry no date', { label: 'descriptive' })
    pieces.push({ kind: 'descriptive', recordIndex, entityType: record.entityType, recordCode: code, predicate: null, text: descriptive })
    for (const relation of recordRelations(record)) {
      assertCode(relation.subject, 'relation subject')
      assertCode(relation.object, 'relation object')
      if (relation.predicate === STRUCTURED_PREDICATES.HAS_COMPONENT && structuredItemSemanticType(relation.object) !== STRUCTURED_SEMANTIC_TYPES.PRODUCT) {
        throw structuredError('SmartGift bundle component is not a product code', { label: 'component' })
      }
      const text = structuredClaimText({ ...relation, catalogVersionDate })
      assertClaimText(text, { ...relation, catalogVersionDate })
      pieces.push({ kind: 'claim', recordIndex, entityType: record.entityType, recordCode: code, predicate: relation.predicate, text })
    }
  })
  const sections = []
  let offset = 0
  let text = ''
  pieces.forEach((piece, index) => {
    if (index > 0) {
      text += '\n\n'
      offset += 2
    }
    sections.push({ ...piece, startOffset: offset, endOffset: offset + piece.text.length })
    text += piece.text
    offset += piece.text.length
  })
  return { text, sections, recordCount: records.length, catalogVersionDate, sourceFormat: SMARTGIFT_CATALOG_FORMAT }
}

function claimCodeOffset(text, key, value) {
  const marker = `"${key}":"`
  const start = text.indexOf(marker)
  if (start < 0) return -1
  const offset = start + marker.length
  return text.slice(offset, offset + value.length) === value && text[offset + value.length] === '"' ? offset : -1
}

const DESCRIPTIVE_HEADER = /^(ProductMaster|BundleOffer|PriceListEntry) (\S+)$/u

function recognizerError(message) {
  return structuredError(message, undefined, 'GENESISRAG17_STRUCTURED_RECOGNIZER_INPUT_INVALID')
}

/**
 * `genesisrag17-structured-recognizer-1`: derives typed occurrences from the
 * chunk text alone, so a replay over persisted chunks reproduces them exactly.
 * A claim chunk yields its subject and object; a descriptive chunk yields only
 * its own entity. Anything else is refused rather than guessed.
 */
export function genesisRag17StructuredRecognizer({ text }) {
  const value = String(text ?? '')
  if (value.startsWith('{')) {
    let claim
    try {
      claim = JSON.parse(value)
    } catch {
      throw recognizerError('Structured claim chunk is not JSON')
    }
    const keys = claim && typeof claim === 'object' && !Array.isArray(claim) ? Object.keys(claim) : []
    const allowed = new Set(['subject', 'predicate', 'object', 'catalogVersionDate'])
    if (!keys.every((key) => allowed.has(key)) || typeof claim.subject !== 'string' || typeof claim.predicate !== 'string' || typeof claim.object !== 'string') {
      throw recognizerError('Structured claim chunk is not a subject/predicate/object triple')
    }
    if (structuredClaimText(claim) !== value) throw recognizerError('Structured claim chunk is not in canonical form')
    const objectType = OBJECT_TYPE_BY_PREDICATE[claim.predicate]
    if (!objectType) throw recognizerError('Structured claim chunk names a predicate parser-2 does not emit')
    const subjectOffset = claimCodeOffset(value, 'subject', claim.subject)
    const objectOffset = claimCodeOffset(value, 'object', claim.object)
    if (subjectOffset < 0 || objectOffset < 0) throw recognizerError('Structured claim endpoints are not exact substrings')
    return [
      { type: structuredItemSemanticType(claim.subject), mention: claim.subject, offset: subjectOffset, confidence: 1 },
      { type: objectType, mention: claim.object, offset: objectOffset, confidence: 1 },
    ]
  }
  const header = DESCRIPTIVE_HEADER.exec(value.split('\n', 1)[0])
  if (!header) throw recognizerError('Structured chunk is neither a descriptive section nor a claim')
  return [{ type: OWN_TYPE_BY_ENTITY_TYPE[header[1]], mention: header[2], offset: header[1].length + 1, confidence: 1 }]
}
