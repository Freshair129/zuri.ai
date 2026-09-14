import { findZeroPiiViolation } from './structured-record-policy'

// @req FR-236 — the Zero-PII deny policy a LINE FAQ candidate's canonical
// question/answer must pass at creation, at every edit and again before a
// decision is recorded (an owner editing the answer can re-introduce a name
// or phone number just as easily as the original draft could).
// @spec ADR-090 D6 — "Zero-PII is enforced twice: at candidate creation (the
// FR-187 deny policy) and again at Stage 5 classify." This module IS the
// candidate-creation half: it reuses FR-187's own function (never a copy of
// it — imported from structured-record-policy.js, called exactly as it is
// there: against the {question, answer} RECORD, so it only ever inspects
// field names and locator-shaped values, precisely as its own module comment
// promises — "descriptive text is not scanned") and adds the prose-level
// checks that function deliberately does not attempt on free text: names,
// phone numbers, LINE ids and quoted wording. The candidate's question/answer
// ARE the free text FR-236 must keep clean, so this module scans them, on top
// of — never instead of — the shared FR-187 rule.
//
// The Thai name check below is an ALLOW-LIST heuristic, not a name database:
// Thai has no spaces between words, so it starts from every honorific
// substring (which over-matches enormously — "คุณ" alone is the everyday
// second-person pronoun, and "คุณลูกค้า"/"คุณภาพ"/"นายหน้า" are ordinary
// prose) and narrows by EXCLUDING the specific continuations documented and
// evidenced below. It will always have gaps on both sides — an unlisted
// compound refused, or (much more rarely) an unusual glued name missed — so
// every refusal names exactly which rule matched (`violation.term`) and which
// field, so a human reviewer can rephrase rather than guess why.
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

// Thai has no spaces between words, so a bare honorific substring is not a
// name signal by itself — "คุณ" alone is also the everyday second-person
// pronoun ("คุณสามารถ...", "you can..."), and "คุณภาพ" (quality), "คุณสมบัติ"
// (property/specification), "นายหน้า" (broker) are ordinary product/FAQ
// vocabulary that happens to start with an honorific string. Scanning for the
// honorific string is still the right starting point; `findThaiNameViolation`
// below is what makes it precise: it requires either whitespace after the
// honorific (an explicit "คุณ สมหญิง" form) or an immediate Thai continuation
// that is NOT one of the known non-name compounds/pronoun uses.
const THAI_HONORIFICS = ['นางสาว', 'นาย', 'นาง', 'คุณ']

// Every one of these starts with one of THAI_HONORIFICS above and is ordinary
// prose, never a personal name — the pronoun forms ("คุณสามารถ") are what
// makes almost any FAQ answer addressed to the reader trip a naive honorific
// scan, and the noun compounds are what makes ordinary product copy
// ("...คุณภาพดี", "คุณสมบัติของ...") trip it. Not exhaustive — a heuristic
// list can never be — but named explicitly so it can grow with evidence
// rather than by guessing, and it only ever narrows a match, never widens one.
const THAI_NAME_FALSE_POSITIVES = [
  'คุณภาพ', 'คุณสมบัติ', 'คุณค่า', 'คุณประโยชน์', 'คุณธรรม', 'คุณูปการ',
  'คุณสามารถ', 'คุณจะ', 'คุณต้อง', 'คุณควร', 'คุณอาจ', 'คุณเอง', 'คุณไม่',
  // Role/kinship nouns that follow an honorific in ordinary polite Thai —
  // "คุณลูกค้า" ("dear customer") is the standard way Thai shops address
  // customers and will appear in a large share of real candidates.
  'คุณลูกค้า', 'คุณแม่', 'คุณพ่อ', 'คุณผู้ใช้', 'คุณผู้ซื้อ', 'คุณผู้รับ',
  'คุณครู', 'คุณหมอ', 'คุณพนักงาน', 'คุณเจ้าของ', 'คุณสมาชิก',
  'นายหน้า', 'นายทุน', 'นายจ้าง', 'นายแบบ',
  'นางฟ้า', 'นางแบบ', 'นางงาม',
]

/**
 * True when `text` names a person after a Thai honorific. Walks every
 * occurrence of every honorific rather than testing one regex once, because
 * whether a given occurrence is a name depends on what immediately follows
 * IT — a single pattern cannot express "here it's a name, three words later
 * the same honorific string is a compound word".
 */
function findThaiNameViolation(text) {
  for (const honorific of THAI_HONORIFICS) {
    let from = 0
    for (;;) {
      const at = text.indexOf(honorific, from)
      if (at === -1) break
      from = at + honorific.length
      const rest = text.slice(from)
      if (/^\s/.test(rest)) {
        // Explicit "คุณ สมหญิง" form: whitespace then another Thai word.
        if (/^\s+[ก-๙]/.test(rest)) return true
        continue
      }
      // Glued form: "คุณสมชาย". Skip a known non-name compound/pronoun use;
      // two more glued Thai characters otherwise reads as a name syllable.
      const isKnownCompound = THAI_NAME_FALSE_POSITIVES.some(
        (word) => word.startsWith(honorific) && rest.startsWith(word.slice(honorific.length)),
      )
      if (isKnownCompound) continue
      if (/^[ก-๙]{2,}/.test(rest)) return true
    }
  }
  return false
}

// Latin two-capitalized-word shapes ("John Smith") are indistinguishable by
// capitalization alone from a brand, product or promotion name in Title Case
// ("Smart Gift", "Express Delivery", "Buy One Get One") — FR-236 explicitly
// allows product locators and policy names, so this heuristic is dropped
// rather than "narrowed": there is no regex-expressible line between the two
// shapes. Neither the checks above nor FR-187's structural check (see
// `findCandidateZeroPiiViolation` below) inspect prose for a bare Latin name;
// Stage 5's own re-application of the exact FR-187 function against the full
// admitted content is the backstop this candidate-creation pass does not need
// to duplicate.

const CHECKS = Object.freeze([
  ['line_user_id', LINE_USER_ID_PATTERN],
  ['phone_number', THAI_PHONE_PATTERN],
  ['phone_number', INTERNATIONAL_PHONE_PATTERN],
  ['quoted_wording', QUOTED_WORDING_PATTERN],
])

function scanProse(text, field) {
  if (typeof text !== 'string' || !text) return null
  if (findThaiNameViolation(text)) return { field, term: 'personal_name' }
  for (const [term, pattern] of CHECKS) {
    if (pattern.test(text)) return { field, term }
  }
  return null
}

/**
 * Return the first violation in `question`/`answer`, or null when both are
 * clean. Two independent layers, deliberately not merged into one scan:
 *
 * 1. The prose checks above, per field — names, phone numbers, LINE ids,
 *    quoted wording. These are the checks FR-187's own structural function
 *    never attempts on free text.
 * 2. `findZeroPiiViolation({question, answer})` — FR-187's own function,
 *    called on the candidate exactly as a structured record, so it inspects
 *    `question`/`answer` as field NAMES (neither matches its deny pattern)
 *    and would inspect their VALUES only if the key looked like a locator
 *    (`file`/`path`/`uri`/…, which "question"/"answer" never do). For this
 *    shape it is normally a no-op, and that is correct, not a gap: ordinary
 *    Thai customer-service prose says "ลูกค้า" ("customer") constantly
 *    ("คุณลูกค้าสามารถ…"), and FR-187 was never meant to refuse that — only
 *    to catch a record whose FIELD NAMES betray a CRM shape. Calling it this
 *    way is what "reused, not copied" means for a two-field prose record: the
 *    exact function, given the exact object shape it already knows how to
 *    read, not a re-derived string test that would drift from it.
 */
export function findCandidateZeroPiiViolation({ question, answer } = {}) {
  const prose = scanProse(question, 'question') || scanProse(answer, 'answer')
  if (prose) return prose
  const structural = findZeroPiiViolation({ question, answer })
  return structural ? { field: structural.field, term: 'deny_term' } : null
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
