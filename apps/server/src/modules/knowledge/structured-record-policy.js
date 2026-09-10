import { canonicalGenesisRag17Json } from './genesisrag17-contract'

// @req FR-187 — a structured catalog record is refused admission as a product
// occurrence when it carries customer/contact/quotation material, at the same
// Stage 5 classify boundary FR-111 and SEC-021 already own.
// @spec ADR-075 D5, FR-111, SEC-021
// @tested tests/unit/knowledge-zero-pii-policy.test.js

/**
 * Ported — not copied — from SmartGift's own producer-side policy
 * (`business-01-smart-gift/pipeline/knowledge_registry/core.py`, `DENIED`).
 * The pattern is the deny semantics ADR-075 D5 names; keeping the identical
 * expression is the point, so the two sides cannot drift into two rules.
 *
 * SmartGift applies it to *source locators* (file paths), never to prose. This
 * port keeps that meaning: it inspects the source identity, every field NAME in
 * the record (a `customerName` or `contact` field is structural evidence of a
 * CRM shape) and the VALUES of locator-like fields (file, path, uri, upstream,
 * source, origin). Descriptive text is not scanned — a gift catalog legitimately
 * says "ของขวัญลูกค้าองค์กร", and a policy that refused it would be a different
 * rule from SmartGift's, not a stricter one.
 */
export const STRUCTURED_RECORD_DENY_PATTERN = /05_crm_customer_data|customer|contact|quotation|ลูกค้า|ใบเสนอราคา/i

/** The policy identity recorded in Stage 5 evidence, so a run says which rule ran. */
export const STRUCTURED_RECORD_DENY_POLICY = 'smartgift-zero-pii-1'

/**
 * Providers whose payload is a structured record rather than prose. Only these
 * carry the Zero-PII gate; every existing text/Markdown flow is unchanged.
 */
export const STRUCTURED_RECORD_PROVIDERS = Object.freeze(['SMARTGIFT_CATALOG'])

export function isStructuredRecordProvider(provider) {
  return typeof provider === 'string' && STRUCTURED_RECORD_PROVIDERS.includes(provider)
}

const LOCATOR_KEY_PATTERN = /file|path|uri|url|upstream|source|origin|locator/i

/**
 * Walk the record and yield `[label, text]` pairs the policy inspects: every
 * key (as `record.<path>`), and the string value of any locator-like key.
 * Other string values are prose and are not inspected. A top-level string
 * record is treated as one locator (it has no keys to inspect).
 */
function* inspectable(record, path = 'record') {
  if (typeof record === 'string') { yield [path, record]; return }
  if (record === null || typeof record !== 'object') return
  if (Array.isArray(record)) {
    for (let i = 0; i < record.length; i += 1) {
      if (record[i] && typeof record[i] === 'object') yield* inspectable(record[i], `${path}[${i}]`)
    }
    return
  }
  for (const [key, value] of Object.entries(record)) {
    yield [`${path}.${key}`, key]
    if (LOCATOR_KEY_PATTERN.test(key) && typeof value === 'string') yield [`${path}.${key}`, value]
    if (value && typeof value === 'object') yield* inspectable(value, `${path}.${key}`)
  }
}

function serializable(record) {
  if (record === null || record === undefined || typeof record === 'string') return true
  try {
    canonicalGenesisRag17Json(record)
    return true
  } catch {
    return false
  }
}

/**
 * Return the first denied field, or null when the record is clean. The matched
 * term is one of the policy's own literals — a category word, never record data
 * — so it is safe to report and makes a denial explainable. `field` is the
 * record path of the offending key or locator, or `sourceId` / `sourceUri`.
 */
export function findZeroPiiViolation(record, { sourceId, sourceUri } = {}) {
  // An unserializable candidate cannot be proven clean, so it is denied
  // rather than silently treated as empty.
  if (!serializable(record)) return { field: 'record', term: 'unserializable' }
  for (const [field, value] of [['sourceId', sourceId], ['sourceUri', sourceUri], ...inspectable(record)]) {
    if (typeof value !== 'string' || !value) continue
    const match = value.match(STRUCTURED_RECORD_DENY_PATTERN)
    if (match) return { field, term: match[0].toLowerCase() }
  }
  return null
}

/**
 * Throw the terminal 422 the 17-stage pipeline treats as a permanent rejection.
 * Stage 5 commits terminal STEP_FAILED evidence on this throw, and the
 * admission runtime maps 422 to KNOWLEDGE_INGESTION_REJECTED.
 */
export function assertZeroPii(record, { sourceId, sourceUri } = {}) {
  const violation = findZeroPiiViolation(record, { sourceId, sourceUri })
  if (!violation) return
  const error = new Error(`Structured record denied by the Zero-PII policy on ${violation.field}`)
  error.status = 422
  error.code = 'GENESISRAG17_ZERO_PII_DENIED'
  error.details = { policy: STRUCTURED_RECORD_DENY_POLICY, field: violation.field, term: violation.term }
  throw error
}
