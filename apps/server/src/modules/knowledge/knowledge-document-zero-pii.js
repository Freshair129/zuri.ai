// @req FR-173 — an OWNER-admitted TEXT/FILE document (provider
// `KNOWLEDGE_ADMISSION`, see `knowledge-runtime.js` `processJob`) gets its
// own Stage 5 Zero-PII gate. Before this module, `KNOWLEDGE_ADMISSION` was
// absent from `ZERO_PII_POLICY_BY_PROVIDER` in genesisrag17-executor.js, and
// the map's own comment says a provider absent from it "carries no Stage 5
// Zero-PII gate at all" — so a document containing a phone number or a LINE
// user id reached GKS/GenesisBlock with no check at all.
// @spec ADR-072 (Amendment, 2026-09-24), ADR-090 D6 (revised 2026-09-14,
//   owner decision) — the design precedent this module follows.
//
// IDENTIFIER RULES REUSED, NOT COPIED: LINE user id, Thai phone, and
// international phone are the exact same patterns
// `knowledge-candidate-zero-pii.js` (FR-236) exports and uses for
// `LINE_FAQ_CANDIDATE` — imported here, never re-typed, so the two policies
// cannot silently drift on what a phone number or LINE id looks like. This
// module adds one more identifier rule of its own: an e-mail address, which
// an owner's own document can plausibly carry (a contact address) and which
// FR-236's candidate prose has no test coverage for because a LINE FAQ
// candidate answer does not carry one.
//
// DELIBERATELY NOT REUSED — this is the one place this policy differs from
// FR-236's candidate prose policy, and the difference is intentional, not an
// oversight:
//   - the Thai-honorific personal-name heuristic (`findThaiNameViolation` in
//     knowledge-candidate-zero-pii.js)
//   - the quoted-wording rule (`QUOTED_WORDING_PATTERN`)
// An OWNER's own admitted document (a policy page, a product manual, a
// procedure) legitimately quotes wording ("the label says 'no returns after
// 7 days'") and legitimately names staff, roles or brands by an honorific
// ("คุณสมชาย ผู้จัดการสาขา" as a signed-off approver, or a brand named in
// Title Case) far more often than a two-sentence FAQ answer does. ADR-090
// D6's reasoning — that a rule shaped for one payload denies ordinary,
// approved content of a different shape — applies at least as strongly here:
// a full document has far more surface area for an honorific-shaped
// substring or a quotation mark to appear without naming a real person's
// private phone number or LINE id. So this policy only refuses the four
// identifier-shaped rules (LINE user id, Thai phone, international phone,
// e-mail), never a name or a quotation.
//
// ONE ENTRY POINT: `findDocumentProseViolation(content)` takes the exact
// text Stage 5 classify sees (`value.content` for a `KNOWLEDGE_ADMISSION`
// source — the same string for both a TEXT source and a FILE source read as
// text, since `knowledge-runtime.js` reads both into one `job.content`
// before ingestion) and returns a violation or null.
// @tested tests/unit/knowledge-document-zero-pii.test.js,
//   tests/integration/genesisrag17-tier1-knowledge-admission-zero-pii.test.js

import { LINE_USER_ID_PATTERN, THAI_PHONE_PATTERN, INTERNATIONAL_PHONE_PATTERN } from './knowledge-candidate-zero-pii'

/** The policy identity recorded in Stage 5 evidence, so a run says which rule ran. */
export const DOCUMENT_ZERO_PII_POLICY = 'knowledge-document-zero-pii-1'

// A plain e-mail address. Not reused from the candidate policy — FR-236's
// candidate prose policy has no e-mail rule, because a LINE FAQ candidate
// answer is not the shape that carries one; an owner's admitted document is.
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/

const CHECKS = Object.freeze([
  ['line_user_id', LINE_USER_ID_PATTERN],
  ['phone_number', THAI_PHONE_PATTERN],
  ['phone_number', INTERNATIONAL_PHONE_PATTERN],
  ['email_address', EMAIL_PATTERN],
])

/**
 * The one entry point every caller uses for an OWNER-admitted
 * `KNOWLEDGE_ADMISSION` document. Returns `{ term }` on the first identifier
 * match, or `null` when the content is clean. Never returns or logs the
 * matched value itself — only the rule name — so a refusal cannot leak the
 * PII it caught.
 */
export function findDocumentProseViolation(content) {
  if (typeof content !== 'string' || !content) return null
  for (const [term, pattern] of CHECKS) {
    if (pattern.test(content)) return { term }
  }
  return null
}

/** Throw the 422 Stage 5 classify treats as a permanent refusal. */
export function assertDocumentProseZeroPii(content, { sourceId, sourceUri } = {}) {
  const violation = findDocumentProseViolation(content)
  if (!violation) return
  const error = new Error(`Knowledge document denied by the Zero-PII policy on ${violation.term}`)
  error.status = 422
  error.code = 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED'
  error.details = {
    policy: DOCUMENT_ZERO_PII_POLICY,
    term: violation.term,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceUri ? { sourceUri } : {}),
  }
  throw error
}
