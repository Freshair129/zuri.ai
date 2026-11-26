import { createHash } from 'node:crypto'

// @req FR-109 — owner-run redaction preserves the outbox envelope and records provenance.
// @spec ADR-121 D3-D6
// @tested tests/unit/genesisrag17-outbox-redaction.test.js

export const GENESIS_RAG17_REDACTION_SCHEMA_VERSION = 'genesisrag17.redaction.v1'

const MARKER_KEYS = Object.freeze([
  'redacted',
  'schemaVersion',
  'redactedAt',
  'redactedBy',
  'reason',
  'originalSha256',
])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/
const REDACTED_BY_MAX_LENGTH = 200
const REASON_MAX_LENGTH = 1000

export function canonicalRequestSha256(requestJsonString) {
  if (typeof requestJsonString !== 'string') throw new TypeError('GENESISRAG17_REQUEST_JSON_STRING_REQUIRED')
  return createHash('sha256').update(requestJsonString, 'utf8').digest('hex')
}

function isIso8601DateTime(value) {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_TIME_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second, , , offsetHour, offsetMinute] = match
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const min = Number(minute)
  const sec = Number(second)
  const daysInMonth = m === 2
    ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28)
    : [4, 6, 9, 11].includes(m) ? 30 : 31
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth || h > 23 || min > 59 || sec > 59) return false
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false
  return Number.isFinite(new Date(value).getTime())
}

export function validateRedactionMarker(marker) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return false
  const keys = Reflect.ownKeys(marker)
  if (keys.length !== MARKER_KEYS.length || keys.some((key) => typeof key !== 'string')
    || MARKER_KEYS.some((key) => !Object.hasOwn(marker, key))) return false
  if (marker.redacted !== true || marker.schemaVersion !== GENESIS_RAG17_REDACTION_SCHEMA_VERSION) return false
  if (!isIso8601DateTime(marker.redactedAt)) return false
  if (typeof marker.redactedBy !== 'string'
    || !marker.redactedBy.trim()
    || marker.redactedBy !== marker.redactedBy.trim()
    || marker.redactedBy.length > REDACTED_BY_MAX_LENGTH) return false
  if (typeof marker.reason !== 'string'
    || !marker.reason.trim()
    || marker.reason !== marker.reason.trim()
    || marker.reason.length > REASON_MAX_LENGTH) return false
  return typeof marker.originalSha256 === 'string' && SHA256_PATTERN.test(marker.originalSha256)
}

export function parseRedactionMarker(requestJsonStringOrObject) {
  let value = requestJsonStringOrObject
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { redacted: false }
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'redaction')) {
    return { redacted: false }
  }
  const marker = value.redaction
  if (!validateRedactionMarker(marker)) return { redacted: false, invalid: true, marker }
  return { redacted: true, marker }
}

export function isRedactedRequestJson(requestJsonString) {
  return parseRedactionMarker(requestJsonString).redacted
}

export function buildRedactedRequestJson(requestJsonString, { actor, reason, redactedAt } = {}) {
  if (typeof requestJsonString !== 'string') throw new TypeError('GENESISRAG17_REQUEST_JSON_STRING_REQUIRED')
  let request
  try {
    request = JSON.parse(requestJsonString)
  } catch {
    throw new Error('GENESISRAG17_REQUEST_JSON_UNREADABLE')
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('GENESISRAG17_REQUEST_JSON_UNREADABLE')
  }
  const existingMarker = parseRedactionMarker(request)
  if (existingMarker.redacted) throw new Error('GENESISRAG17_REQUEST_ALREADY_REDACTED')
  if (existingMarker.invalid) throw new Error('GENESISRAG17_REQUEST_REDACTION_MARKER_INVALID')

  const redactedBy = typeof actor === 'string' ? actor.trim() : ''
  const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
  const at = redactedAt instanceof Date ? redactedAt : new Date(redactedAt)
  if (!redactedBy || redactedBy.length > REDACTED_BY_MAX_LENGTH
    || !normalizedReason || normalizedReason.length > REASON_MAX_LENGTH
    || !Number.isFinite(at.getTime())) {
    throw new Error('GENESISRAG17_REQUEST_REDACTION_METADATA_INVALID')
  }

  if (request.source && typeof request.source === 'object' && !Array.isArray(request.source)
    && typeof request.source.content === 'string') {
    request.source.content = ''
  }
  if (Array.isArray(request.chunks)) {
    for (const chunk of request.chunks) {
      if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && typeof chunk.text === 'string') chunk.text = ''
    }
  }
  if (Array.isArray(request.mentions)) {
    for (const mention of request.mentions) {
      if (mention && typeof mention === 'object' && !Array.isArray(mention) && typeof mention.name === 'string') mention.name = ''
    }
  }
  request.redaction = {
    redacted: true,
    schemaVersion: GENESIS_RAG17_REDACTION_SCHEMA_VERSION,
    redactedAt: at.toISOString(),
    redactedBy,
    reason: normalizedReason,
    originalSha256: canonicalRequestSha256(requestJsonString),
  }
  return JSON.stringify(request)
}
