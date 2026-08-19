import { createHash } from 'node:crypto'

// Phase #76 contract-first slice. Global requirement IDs are reserved in issue #76
// and will be added to the canonical PRD registry before this branch is mergeable.
// @spec ADR-038 — Integration owns raw evidence; Market owns translated observations.

const REQUIRED_RAW_FIELDS = [
  'id',
  'tenantId',
  'connectionId',
  'provider',
  'entityType',
  'externalId',
  'payloadJson',
  'payloadHash',
]

export const MARKET_RESOLUTION_STATUS = Object.freeze({
  RESOLVED: 'RESOLVED',
  PARTIAL: 'PARTIAL',
  UNRESOLVED: 'UNRESOLVED',
})

function requireRawRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') {
    throw new Error('RawExternalRecord is required')
  }

  for (const field of REQUIRED_RAW_FIELDS) {
    if (rawRecord[field] === null || rawRecord[field] === undefined || rawRecord[field] === '') {
      throw new Error(`RawExternalRecord.${field} is required`)
    }
  }
}

function parsePayloadJson(payloadJson) {
  try {
    const payload = JSON.parse(payloadJson)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be an object')
    }
    return payload
  } catch (error) {
    throw new Error(`RawExternalRecord.payloadJson is invalid JSON: ${error.message}`)
  }
}

export function buildMarketObservationLineageKey({
  rawRecordId,
  payloadHash,
  translationSchemaVersion,
  observationType,
}) {
  const identity = [rawRecordId, payloadHash, translationSchemaVersion, observationType]
    .map((value) => String(value))
    .join('\u001f')

  return createHash('sha256').update(identity).digest('hex')
}

function normalizeCandidate(extracted) {
  if (!extracted || typeof extracted !== 'object') {
    throw new Error('market extractor must return an object')
  }
  if (!extracted.observationType || typeof extracted.observationType !== 'string') {
    throw new Error('market extractor must return observationType')
  }
  if (!extracted.candidate || typeof extracted.candidate !== 'object' || Array.isArray(extracted.candidate)) {
    throw new Error('market extractor must return candidate object')
  }
  return extracted
}

function normalizeResolution(resolution) {
  if (!resolution) {
    return {
      status: MARKET_RESOLUTION_STATUS.UNRESOLVED,
      canonicalProductRef: null,
      canonicalCategoryRef: null,
      confidence: null,
    }
  }

  const status = resolution.status ?? MARKET_RESOLUTION_STATUS.UNRESOLVED
  if (!Object.values(MARKET_RESOLUTION_STATUS).includes(status)) {
    throw new Error(`unsupported market resolution status: ${status}`)
  }

  const confidence = resolution.confidence ?? null
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error('resolution confidence must be between 0 and 1')
  }

  return {
    status,
    canonicalProductRef: resolution.canonicalProductRef ?? null,
    canonicalCategoryRef: resolution.canonicalCategoryRef ?? null,
    confidence,
  }
}

/**
 * Build a provider-neutral MarketObservation draft from Integration-owned raw evidence.
 *
 * `extractCandidate` may interpret provider payload fields, but it has no authority over
 * Tenant/Business/connection/source lineage. Those fields are always copied from the
 * trusted RawExternalRecord envelope. `knowledgeResolver` is optional; absence or a null
 * result is a truthful UNRESOLVED state rather than a forced canonical match.
 */
export async function translateRawRecordToMarketObservation(
  rawRecord,
  {
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion = 'market-observation.v1',
    now = () => new Date(),
  } = {},
) {
  requireRawRecord(rawRecord)

  if (typeof extractCandidate !== 'function') {
    throw new Error('market extractCandidate port is required')
  }
  if (!translationSchemaVersion || typeof translationSchemaVersion !== 'string') {
    throw new Error('translationSchemaVersion is required')
  }

  const payload = parsePayloadJson(rawRecord.payloadJson)
  const extracted = normalizeCandidate(await extractCandidate({
    payload,
    source: {
      provider: rawRecord.provider,
      entityType: rawRecord.entityType,
      externalId: rawRecord.externalId,
      sourceType: rawRecord.sourceType ?? null,
      sourceUri: rawRecord.sourceUri ?? null,
      schemaVersion: rawRecord.schemaVersion ?? null,
    },
  }))

  const resolution = normalizeResolution(
    typeof knowledgeResolver === 'function'
      ? await knowledgeResolver({
          candidate: extracted.candidate,
          observationType: extracted.observationType,
        })
      : null,
  )

  const translatedAt = now()
  const observedAt = extracted.observedAt
    ? new Date(extracted.observedAt)
    : new Date(rawRecord.receivedAt ?? translatedAt)

  if (Number.isNaN(observedAt.getTime())) {
    throw new Error('observedAt must be a valid date')
  }

  const lineageKey = buildMarketObservationLineageKey({
    rawRecordId: rawRecord.id,
    payloadHash: rawRecord.payloadHash,
    translationSchemaVersion,
    observationType: extracted.observationType,
  })

  return {
    tenantId: rawRecord.tenantId,
    businessId: rawRecord.businessId ?? null,
    rawRecordId: rawRecord.id,
    connectionId: rawRecord.connectionId,
    provider: rawRecord.provider,
    sourceEntityType: rawRecord.entityType,
    externalId: rawRecord.externalId,
    sourcePayloadHash: rawRecord.payloadHash,
    sourceUri: rawRecord.sourceUri ?? null,
    translationSchemaVersion,
    observationType: extracted.observationType,
    candidateJson: JSON.stringify(extracted.candidate),
    canonicalProductRef: resolution.canonicalProductRef,
    canonicalCategoryRef: resolution.canonicalCategoryRef,
    resolutionStatus: resolution.status,
    resolutionConfidence: resolution.confidence,
    observedAt,
    translatedAt,
    lineageKey,
  }
}
