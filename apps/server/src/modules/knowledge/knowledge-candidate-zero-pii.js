import { STRUCTURED_RECORD_DENY_PATTERN } from './structured-record-policy'

// @req FR-236 — the Zero-PII deny policy a LINE FAQ candidate's canonical
// question/answer must pass at creation, at every edit and again before a
// decision is recorded (an owner editing the answer can re-introduce a name
// or phone number just as easily as the original draft could).
// @spec ADR-090 D6 — "Zero-PII is enforced twice: at candidate creation (the
// FR-187 deny policy) and again at Stage 5 classify." This module IS the
// candidate-creation half: it reuses FR-187's own deny pattern (never a copy
// of it — imported from structured-record-policy.js) and adds the prose-level
// checks that pattern deliberately does not attempt on free text (its own
// comment: "Descriptive text is not scanned"). The candidate's question/answer
// ARE the free text FR-236 must keep clean, so this module scans them, on top
// of — never instead of — the shared FR-187 pattern.
// @tested tests/unit/knowledge-candidate-zero-pii.test.js

export const CANDIDATE_ZERO_PII_POLICY = 'line-faq-candidate-zero-pii-1'

// A LINE user id, exactly as LINE issues it: "U" + 32 lowercase hex chars.
const LINE_USER_ID_PATTERN = /\bU[0-9a-f]{32}\b/i

// Thai mobile/landline (0-prefixed or +66) and a generic international run of
// digits long enough to be a phone number rather than, say, a SKU.
const THAI_PHONE_PATTERN = /(?:\+66[-.\s]?\d{1,2}|0\d{1,2})[-.\s]?\d{3}[-.\s]?\d{3,4}\b/
const INTERNATIONAL_PHONE_PATTERN = /\+\d[\d\s-]{7,}\d\b/

// A canonical Q/A never needs to wrap a run of words in quotation marks —
// doing so is exactly what "quoted customer wording" looks like in text.
const QUOTED_WORDING_PATTERN = /["“”«»].{2,}?["“”«»]/

// Thai honorific + a Thai name token, and a two-token Latin "Firstname
// Lastname" shape. Both are heuristics, not a name database — the policy's
// job is to deny the fixture shapes a candidate must never carry, not to
// parse every human name on earth.
const THAI_NAME_PATTERN = /(?:นาย|นาง|นางสาว|คุณ)\s?[ก-๙]+(?:\s[ก-๙]+)?/
const LATIN_NAME_PATTERN = /\b[A-Z][a-z]{1,}\s[A-Z][a-z]{1,}\b/

const CHECKS = Object.freeze([
  ['line_user_id', LINE_USER_ID_PATTERN],
  ['phone_number', THAI_PHONE_PATTERN],
  ['phone_number', INTERNATIONAL_PHONE_PATTERN],
  ['quoted_wording', QUOTED_WORDING_PATTERN],
  ['personal_name', THAI_NAME_PATTERN],
  ['personal_name', LATIN_NAME_PATTERN],
  // The same structural keyword pattern FR-187 uses (customer/contact/
  // quotation and their Thai equivalents) — reused, not duplicated, so the
  // two policies cannot drift into two different rules.
  ['deny_term', STRUCTURED_RECORD_DENY_PATTERN],
])

function scanProse(text, field) {
  if (typeof text !== 'string' || !text) return null
  for (const [term, pattern] of CHECKS) {
    if (pattern.test(text)) return { field, term }
  }
  return null
}

/** Return the first violation in `question`/`answer`, or null when both are clean. */
export function findCandidateZeroPiiViolation({ question, answer } = {}) {
  return scanProse(question, 'question') || scanProse(answer, 'answer')
}

/** Throw the 422 a candidate write path treats as a permanent refusal. */
export function assertCandidateZeroPii(candidate = {}) {
  const violation = findCandidateZeroPiiViolation(candidate)
  if (!violation) return
  const error = new Error(`Knowledge candidate denied by the Zero-PII policy on ${violation.field}`)
  error.status = 422
  error.code = 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED'
  error.details = { policy: CANDIDATE_ZERO_PII_POLICY, field: violation.field, term: violation.term }
  throw error
}
