// @req FR-049 — model wording is accepted only when its numbers, codes and
// delivery claims are in the evidence; otherwise the reply is built from evidence.
// The check reads every Unicode decimal digit as ASCII (Thai ๙๙ and fullwidth ９９
// are 99), holds a number the customer typed to a quantity or budget echo, checks
// each delivery or stock claim against its own kind of evidence, and checks
// capital-letter codes with no digit (PM-PEN) as well as codes with one.
// @req FR-149, FR-235 — the LINE answer rules after retrieval and after the model:
// the no-evidence reply, the candidate check, the evidence fallback and the LINE
// text bound. The Server answer path and the Conversation Runtime apply the same
// rules, so the same model output over the same evidence gives the same reply.
// @spec SDD-025, SEC-009 — provider wording is advisory; evidence remains authoritative.
// @spec ADR-106 D1, SDD-110 — pure text rules, no I/O and no imports.
//
// ONE SOURCE, TWO PLACES. This file exists byte for byte at
//   apps/server/src/modules/agent/line-answer-policy.js       (authored here)
//   services/conversation-runtime/src/line-answer-policy.js   (mirror)
// The Runtime may not import apps/server (its build scan refuses it) and the
// apps/server image cannot reach services/ (its build context is apps/server), so a
// shared import is not possible for both images. Edit the apps/server copy, then
// copy it over the mirror unchanged. The drift test fails on any difference.
// @tested tests/unit/grounded-business-answer.test.js,
//   tests/unit/line-answer-policy.test.js,
//   tests/integration/conversation-runtime-answer-parity.test.js,
//   services/conversation-runtime/test/answer-policy.test.js

const PRODUCT_CODE = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi
const NUMBER = /\d[\d,]*(?:\.\d+)?/g
// A code with no digit is checked only in this shape, written in capitals:
// two or more letters, a separator, two or more letters (PM-PEN, PM-BOTTLE-LED).
// Ordinary words, units (THB, GB) and one-letter tails (USB-C) stay unchecked.
const LETTER_CODE = /^[A-Z]{2,}(?:[._-][A-Z]{2,})+$/
const DECIMAL_DIGIT = /\p{Nd}/gu
const ONE_DECIMAL_DIGIT = /^\p{Nd}$/u
// Each delivery or stock claim needs its own kind of claim in the evidence; one
// risky word in the evidence does not admit a different one. A delivery-time
// claim needs the same number of days in the evidence.
const RISK_CLAIMS = [
  { claim: /ส่งฟรี/, evidence: /ส่งฟรี/ },
  { claim: /พร้อมส่ง|มีสต็อก/, evidence: /พร้อมส่ง|มีสต็อก/ },
  { claim: /รับประกัน/, evidence: /รับประกัน/ },
  { claim: /จัดส่ง/, evidence: /จัดส่ง|ส่งฟรี|พร้อมส่ง|ภายใน\s*\d+\s*วัน/ },
]
const DELIVERY_DAYS = /ภายใน\s*(\d+)\s*วัน/g
// A number the customer typed, and the evidence does not carry, may be echoed only
// as the quantity asked about (followed by a unit) or as the customer's budget
// (after งบ); never as a price, a delivery time or a bare figure.
const QUANTITY_UNITS = ['ชิ้น', 'อัน', 'ใบ', 'ตัว', 'ชุด', 'กล่อง', 'แพ็ค', 'แพ็ก', 'แพค', 'โหล', 'ด้าม', 'เล่ม', 'ขวด',
  'แก้ว', 'ถุง', 'ม้วน', 'แผ่น', 'คน', 'ท่าน', 'pcs', 'pieces', 'piece', 'units', 'unit', 'sets', 'set']
const BUDGET_BEFORE = /(?:งบ(?:ประมาณ)?|budget)\s*(?:ไม่เกิน|ประมาณ|ที่|คือ|รวม|ต่อชิ้น|ชิ้นละ|ต่อหน่วย|:)?\s*(?:\d[\d,]*(?:\.\d+)?\s*(?:-|–|~|ถึง)\s*)?$/i

/** LINE's text message limit, in UTF-16 code units. */
export const LINE_TEXT_LIMIT = 5000

/** The reply when retrieval found no evidence. The model is not called. */
export const NO_EVIDENCE_REPLY = 'ยังไม่พบข้อมูลสินค้าที่ตรงกับคำถามนี้ค่ะ ลองระบุรหัสสินค้า หรือชื่อสินค้าเพิ่มอีกหนึ่งอย่างได้ไหมคะ'

/**
 * Every Unicode decimal digit (Thai ๐-๙, fullwidth ０-９, Arabic-Indic and the
 * rest of \p{Nd}) as its ASCII digit, so the checks below see ๙๙ and ９９ as 99.
 * Unicode keeps each \p{Nd} run as contiguous 0-9 sequences, so a digit's value
 * is its distance from the start of its run, modulo 10.
 */
export function asciiDigits(value) {
  return String(value).replace(DECIMAL_DIGIT, (digit) => {
    if (digit >= '0' && digit <= '9') return digit
    const point = digit.codePointAt(0)
    let zero = point
    while (ONE_DECIMAL_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1
    return String((point - zero) % 10)
  })
}

function numberValue(item) {
  const numeric = Number(item.replaceAll(',', ''))
  return Number.isFinite(numeric) ? String(numeric) : item
}

function normalizedNumbers(value) {
  return new Set((String(value).match(NUMBER) ?? []).map(numberValue))
}

export function normalizedCodes(value) {
  return new Set((String(value).match(PRODUCT_CODE) ?? []).map((item) => item.toLocaleUpperCase()))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function deliveryDays(value) {
  return new Set([...String(value).matchAll(DELIVERY_DAYS)].map((match) => numberValue(match[1])))
}

/**
 * A candidate is supported when every number in it is in the evidence (or is a
 * number the customer typed, echoed as a quantity or a budget), every code in it
 * that has a digit or the capital-letter code shape is in the question or the
 * evidence, and each delivery or stock claim it makes is one the evidence makes.
 * All three texts are checked with their digits as ASCII; the candidate itself
 * is not changed.
 */
export function verifyCandidate(question, evidence, candidate) {
  const records = asciiDigits(JSON.stringify(evidence.records))
  const asked = asciiDigits(question)
  const text = asciiDigits(candidate)

  const evidenceNumbers = normalizedNumbers(records)
  const askedNumbers = normalizedNumbers(asked)
  const units = [...QUANTITY_UNITS, ...(evidence.records ?? []).map((record) => record?.unit)
    .filter((unit) => typeof unit === 'string' && unit.trim())]
  const quantityAfter = new RegExp(`^\\s*(?:${units.map((unit) => escapeRegExp(unit.trim())).join('|')})`, 'i')
  // A number inside a code that starts with a letter (USB-999) is the code rule's
  // to judge, as it always was; a measurement such as 64GB is still a number.
  const codeSpans = [...text.matchAll(PRODUCT_CODE)]
    .filter((match) => /^[A-Z]/i.test(match[0]) && /\d/.test(match[0]))
    .map((match) => [match.index, match.index + match[0].length])
  const echoAllowed = (start, end) => codeSpans.some(([from, to]) => start >= from && end <= to)
    || quantityAfter.test(text.slice(end))
    || BUDGET_BEFORE.test(text.slice(0, start))
  const unsupportedNumbers = [...new Set([...text.matchAll(NUMBER)]
    .filter((match) => {
      const value = numberValue(match[0])
      if (evidenceNumbers.has(value)) return false
      return !askedNumbers.has(value) || !echoAllowed(match.index, match.index + match[0].length)
    })
    .map((match) => numberValue(match[0])))]

  const allowedCodes = normalizedCodes(`${asked}\n${records}`)
  const unsupportedCodes = [...new Set((text.match(PRODUCT_CODE) ?? [])
    .filter((code) => /\d/.test(code) || LETTER_CODE.test(code))
    .map((code) => code.toLocaleUpperCase())
    .filter((code) => !allowedCodes.has(code)))]

  const evidenceDays = deliveryDays(records)
  const riskyClaim = RISK_CLAIMS.some(({ claim, evidence: made }) => claim.test(text) && !made.test(records))
    || [...deliveryDays(text)].some((days) => !evidenceDays.has(days))
  return {
    supported: unsupportedNumbers.length === 0 && unsupportedCodes.length === 0 && !riskyClaim,
    unsupportedNumbers,
    unsupportedCodes,
    riskyClaim,
  }
}

function formatValue(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)
}

/**
 * The reply built from the first evidence record alone, used when the model
 * output is rejected or the provider call fails. A GKS corpus chunk answers
 * with its own text; a product row answers with its name, price, minimum
 * order, specification and as-of date.
 */
export function deterministicFallback(evidence) {
  const record = evidence.records[0]
  if (record?.kind === 'CORPUS_CHUNK') {
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    return text || NO_EVIDENCE_REPLY
  }
  const facts = [`${record.name} (${record.product_code})`]
  if (record.sell_price !== null) facts.push(`ราคา ${formatValue(record.sell_price)} ${record.currency ?? 'THB'}/${record.unit ?? 'ชิ้น'}`)
  if (record.moq !== null) facts.push(`ขั้นต่ำ ${formatValue(record.moq)} ${record.unit ?? 'ชิ้น'}`)
  const specs = Object.entries(record.specification ?? {}).map(([key, value]) => `${key}: ${value}`)
  if (specs.length) facts.push(specs.join(', '))
  facts.push(`ข้อมูล ณ ${record.as_of.slice(0, 10)}`)
  return facts.join(' — ')
}

/**
 * The rule after a model call that returned text: a supported candidate is the
 * reply as written; an unsupported one is replaced by the evidence fallback.
 * `status` uses the Server provider status names: `ok` or `rejected-output`.
 */
export function checkModelAnswer(question, evidence, candidate) {
  const verification = verifyCandidate(question, evidence, candidate)
  return verification.supported
    ? { text: candidate, status: 'ok', verification }
    : { text: deterministicFallback(evidence), status: 'rejected-output', verification }
}

/**
 * Bound a reply to LINE's text limit without leaving a split surrogate pair at
 * the cut, which an emoji in an evidence value can otherwise produce.
 */
export function boundLineText(text) {
  return text.slice(0, LINE_TEXT_LIMIT).replace(/[\uD800-\uDBFF]$/, '')
}
