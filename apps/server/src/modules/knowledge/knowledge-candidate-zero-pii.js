// @req FR-236 — the Zero-PII policy a LINE FAQ candidate's admitted content
// must pass at creation, at every edit, again before a decision is recorded
// (an owner editing the answer can re-introduce a name or phone number just
// as easily as the original draft could) and again at Stage 5 classify once
// admitted.
// @spec ADR-090 D6 (revised 2026-09-14, owner decision) — both checks run
// this SAME candidate prose policy (`line-faq-candidate-zero-pii-1`), not
// FR-187's structured-record category-word policy (`structured-record-
// policy.js`). FR-187 denies the literal words ลูกค้า / ใบเสนอราคา /
// customer / contact / quotation wherever they occur — the right rule for a
// locator-field-shaped SmartGift catalog record, the wrong rule for a
// candidate's free-text prose: an ordinary, already-approved FAQ such as
// "ขอใบเสนอราคาได้ไหม" or "คุณลูกค้าสามารถสั่งขั้นต่ำ 50 ชิ้นได้ค่ะ" would be
// denied by FR-187's pattern even though it names no person, phone number or
// quoted wording. FR-187 is unchanged for `SMARTGIFT_CATALOG`.
//
// ONE ENTRY POINT: `findCandidateProseViolation(content)` takes exactly the
// text the admission service will store (`composeCandidateContent`'s output)
// and returns a violation or null. Every caller — the candidate service at
// creation/edit/decision, and Stage 5 classify in genesisrag17-executor.js —
// calls this same function on this same composed text, so the two checks the
// ADR names cannot silently disagree: what is validated before admission is
// byte-identical to what Stage 5 re-validates after it.
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

/**
 * The exact text the admission service stores for a LINE_FAQ_CANDIDATE
 * source. Both this module's callers and `knowledge-candidate-service.js`'s
 * admission call build content through this one function, so validation
 * (creation/edit/decision) and the real admitted bytes can never drift apart.
 */
export function composeCandidateContent({ question, answer }) {
  return JSON.stringify({ question, answer })
}

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
// scan, and the role/kinship and noun compounds are what makes ordinary
// product copy and polite customer address ("...คุณภาพดี", "คุณสมบัติของ...",
// "คุณลูกค้าสามารถ...") trip it. Not exhaustive — a heuristic list can never
// be — but named explicitly so it can grow with evidence rather than by
// guessing, and it only ever narrows a match, never widens one.
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
// shapes.

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
 * The one entry point every caller uses — the candidate service at creation,
 * edit and decision, and Stage 5 classify for a `LINE_FAQ_CANDIDATE` source.
 * `content` is exactly the text as admitted (`composeCandidateContent`'s
 * output, or Stage 5's `value.content`, which is byte-identical to it).
 *
 * Internally this parses the known `{question, answer}` shape back out so a
 * refusal can still name which field it came from — a presentation detail,
 * never a second code path: whether parsing succeeds or not, the same prose
 * checks run over the same characters either way (a malformed/non-JSON
 * `content` is scanned whole, under the field name `"content"`).
 */
export function findCandidateProseViolation(content) {
  if (typeof content !== 'string' || !content) return null
  let parsed = null
  try {
    const value = JSON.parse(content)
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value
  } catch {
    parsed = null
  }
  if (parsed && (typeof parsed.question === 'string' || typeof parsed.answer === 'string')) {
    return scanProse(parsed.question, 'question') || scanProse(parsed.answer, 'answer')
  }
  return scanProse(content, 'content')
}

/** Throw the 422 a candidate write path (or Stage 5) treats as a permanent refusal. */
export function assertCandidateProseZeroPii(content, { sourceId, sourceUri } = {}) {
  const violation = findCandidateProseViolation(content)
  if (!violation) return
  const error = new Error(`Knowledge candidate denied by the Zero-PII policy on ${violation.field}`)
  error.status = 422
  error.code = 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED'
  error.details = {
    policy: CANDIDATE_ZERO_PII_POLICY,
    field: violation.field,
    term: violation.term,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceUri ? { sourceUri } : {}),
  }
  throw error
}
