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

// A plain e-mail address, with one document-only tightening the candidate
// policy does not need (it has no e-mail rule at all — see the module
// header): a match whose LAST dot-label is a common image/file extension,
// compared case-insensitively, is not an address. A Markdown retina image
// reference — `![logo](logo@2x.png)`, `logo@2x.PNG`, `logo@2x.retina.png`,
// `img@2x.min.jpg` — is routine in an owner's product manual or catalogue
// and otherwise reads as `name@host.tld`. No real TLD is one of these.
const EMAIL_CANDIDATE_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g
const FILE_EXTENSION_LABELS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff', 'pdf'])
function hasEmailMatch(content) {
  for (const match of content.matchAll(EMAIL_CANDIDATE_PATTERN)) {
    const labels = match[0].slice(match[0].indexOf('@') + 1).split('.')
    const last = labels[labels.length - 1].toLowerCase()
    if (!/^[a-z]{2,}$/.test(last)) continue
    if (FILE_EXTENSION_LABELS.has(last)) continue
    return true
  }
  return false
}

// Document-only guard on THAI_PHONE_PATTERN's `0\d{1,2}...` branch: require
// that the character immediately before a match is not itself a digit. This
// is a wrapper around the shared pattern, not an edit to it — the pattern
// object FR-236's candidate policy imports and matches against is untouched,
// so that policy's behaviour cannot drift. Without this guard, a Thai EAN-13
// barcode such as "8850123456789" (routine in a product manual or catalogue
// document) contains an embedded "0123456789" run that the phone pattern's
// `0\d{1,2}` branch matches with no leading boundary of its own.
// GS1 EAN-13: 13 digits whose last digit is the check digit over the first
// twelve, weighted 1,3,1,3,... from the left.
function isValidEan13(digits) {
  if (!/^[0-9]{13}$/.test(digits)) return false
  let sum = 0
  for (let index = 0; index < 12; index += 1) sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10 === Number(digits[12])
}

function hasThaiPhoneMatch(content) {
  const withGlobalFlag = new RegExp(THAI_PHONE_PATTERN.source, THAI_PHONE_PATTERN.flags.includes('g') ? THAI_PHONE_PATTERN.flags : `${THAI_PHONE_PATTERN.flags}g`)
  let match
  while ((match = withGlobalFlag.exec(content))) {
    // Not a phone number when it is really the tail of a barcode:
    //  - glued to a preceding digit ("8850123456787"), or
    //  - after ONE space/dash, only when the digit group before the
    //    separator plus the match's own digits form a valid EAN-13 (13
    //    digits AND a correct GS1 check digit): "885 0123456787". A phone
    //    number written after an ordinary number ("สาขา 3 081-234-5678",
    //    "1 0812345678", "ชั้น 2 02-123-4567") is not 13 digits, and a
    //    3-digit number before a 10-digit phone passes the check digit only
    //    one time in ten, so it stays refused nine times in ten (residual
    //    risk recorded in ADR-072). EAN-8 is not checked: a phone match has
    //    at least 8 digits of its own, so a separated prefix can never make 8.
    const advance = () => { if (withGlobalFlag.lastIndex === match.index) withGlobalFlag.lastIndex += 1 }
    if (/[0-9]$/.test(content.slice(0, match.index))) { advance(); continue }
    const separated = /([0-9]+)[ -]$/.exec(content.slice(Math.max(0, match.index - 16), match.index))
    if (separated && isValidEan13(separated[1] + match[0].replace(/[^0-9]/g, ''))) { advance(); continue }
    return true
  }
  return false
}

const CHECKS = Object.freeze([
  ['line_user_id', (text) => LINE_USER_ID_PATTERN.test(text)],
  ['phone_number', hasThaiPhoneMatch],
  ['phone_number', (text) => INTERNATIONAL_PHONE_PATTERN.test(text)],
  ['email_address', hasEmailMatch],
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
  for (const [term, test] of CHECKS) {
    if (test(content)) return { term }
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
