// @req FR-049 — model wording is accepted only when its numbers, codes and
// delivery claims are in the evidence; otherwise the reply is built from evidence.
// The check reads every Unicode decimal digit as ASCII (Thai ๙๙ and fullwidth ９９
// are 99), holds a number the customer typed to a quantity or budget echo, checks
// each delivery or stock claim against its own kind of evidence, and checks
// catalogue-family codes with no digit (PM-PEN) as well as codes with one.
// A number written with thousands separators is read without them in all three
// texts (1,250 is 1250 and 10,000mAh is 10000mAh), so a grounded price is not
// rejected for its grouping; a grouped number the evidence lacks still is.
// Every other way of writing a figure is read as the figure too, or refused: a
// numeral whose compatibility form is digits (superscript ¹²⁵⁰, circled ①) is
// those digits, any other numeral (½, Ⅻ) must appear as written in the evidence,
// a minus sign is part of the value (-500 is not 500), only valid thousands
// grouping is ungrouped (12,50 is 12 and 50), a decimal with a fraction of three
// digits or more keeps its zeros (1.250 is not 1.25), and digit groups of three
// joined by one space in the answer are one number (1 250 is 1250).
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
// A number as the checks read it once valid thousands grouping is removed: a
// comma left in the text separates two numbers (12,50 is 12 and 50).
const NUMBER = /\d+(?:\.\d+)?/g
const WRITTEN_NUMBER = /^(\d+)(?:\.(\d+))?$/
// A code with no digit is checked only when it is written in capitals as
// letters, a separator and letters (PM-PEN, PM-BOTTLE-LED, SG-ECO) AND it starts
// with a catalogue code family: PM- (ProductMaster rows) or SG- (the SmartGift
// knowledge catalogue), or the first segment of a product_code in this evidence.
// Capitalised words such as QR-CODE, LINE-OA, NON-WOVEN or UV-LED stay unchecked,
// as do units (THB, GB) and one-letter tails (USB-C).
const LETTER_CODE = /^[A-Z]{2,}(?:[._-][A-Z]{2,})+$/
const CODE_FAMILIES = ['PM', 'SG']
const CODE_SEPARATOR = /[._-]/
const DECIMAL_DIGIT = /\p{Nd}/gu
// A number grouped by thousands: one to three digits, then groups of exactly
// three after a comma (ASCII or fullwidth), not inside a longer digit run and not
// the fraction of a decimal. 1,250, 10,000,000 and the 1,250 of 1,250.50 qualify;
// 1,25, 12,3456 and 1,2,345 do not, and are read as the separate numbers written.
// In the evidence only the ASCII comma groups: a fullwidth comma there (รุ่น
// 12，345) may be a list separator, and reading it as grouping would give the
// evidence a number it may not hold. Reading fewer numbers from the evidence can
// only reject an answer, never admit one, so this is the safer of the two rules;
// an answer that quotes such a figure grouped falls back to the evidence reply.
const GROUPED_NUMBER = /(?<![\d,，]|\d\.)\d{1,3}(?:[,，]\d{3})+(?!\d|[,，]\d)/g
const ASCII_GROUPED_NUMBER = /(?<![\d,，]|\d\.)\d{1,3}(?:,\d{3})+(?!\d|[,，]\d)/g
const GROUP_SEPARATOR = /[,，]/g
// Digit groups of exactly three after one to three digits, each joined by a single
// space, no-break space, thin space or narrow no-break space (1 250, 10 000 000),
// not attached to a code or a decimal before it. In the answer and the question
// such a run is one number, so an answer cannot write 1250 as the 1 and the 250
// the evidence holds apart. The evidence keeps the separate reading.
const SPACE_GROUPED_NUMBER = /(?<![A-Za-z0-9_.,-])\d{1,3}(?:[    ]\d{3})+(?!\d)/g
const SPACE_SEPARATOR = /[    ]/g
// Minus signs other than the ASCII hyphen-minus, read as it: U+2212 MINUS SIGN,
// U+FE63 SMALL HYPHEN-MINUS and U+FF0D FULLWIDTH HYPHEN-MINUS.
const MINUS_SIGNS = /[−﹣－]/g
// A character before a hyphen that joins it to a code or a number, so that it is
// not a sign: PM-1250, USB-001, 3-5, 1,250-1,300 once ungrouped.
const JOINS_HYPHEN = /[A-Za-z0-9_.]/
const SPACE = /\s/
const ASCII_DIGIT = /\d/
// Any non-ASCII character; numeralDigits and leftoverNumerals look at each one.
const NON_ASCII = /[^\x00-\x7F]/gu
const NUMERAL = /\p{N}/u
const ALL_DECIMAL_DIGITS = /^\p{Nd}+$/u
// A code that is only a decimal number (1250.50) is compared by value with a
// decimal the evidence carries (1250.5); the digits before the point are kept as
// written, so a leading zero (00123.5) still has to match exactly.
const DECIMAL_CODE = /^(\d+)\.(\d+)$/
const ONE_DECIMAL_DIGIT = /^\p{Nd}$/u
// Each delivery or stock claim needs its own kind of claim in the evidence; one
// risky word in the evidence does not admit a different one. A delivery time
// (ภายใน N วัน, or a range ภายใน N-M วัน) must lie inside a delivery time the
// evidence gives, as text or as a structured lead_time_days field.
const DAY_RANGE = String.raw`(\d+)(?:\s*(?:-|–|~|ถึง)\s*(\d+))?`
const DELIVERY_DAYS = new RegExp(String.raw`ภายใน\s*${DAY_RANGE}\s*วัน`, 'g')
const LEAD_TIME_DAYS = /"lead_?time_?days"\s*:\s*"?(\d+)/gi
const RISK_CLAIMS = [
  { claim: /ส่งฟรี/, evidence: /ส่งฟรี/ },
  { claim: /พร้อมส่ง|มีสต็อก/, evidence: /พร้อมส่ง|มีสต็อก/ },
  { claim: /รับประกัน/, evidence: /รับประกัน/ },
  { claim: /จัดส่ง/, evidence: new RegExp(String.raw`จัดส่ง|ส่งฟรี|พร้อมส่ง|ภายใน\s*${DAY_RANGE}\s*วัน`) },
]
// A number the customer typed, and the evidence does not carry, may be echoed only
// as a quantity (followed by a unit, not by <unit>ละ, which is a unit price) or as
// a budget the customer set (after งบ or a ceiling such as ไม่เกิน, when the
// question frames that number as a budget too); never as a price, a delivery
// time or a bare figure.
const QUANTITY_UNITS = ['ชิ้น', 'อัน', 'ใบ', 'ตัว', 'ชุด', 'เซ็ต', 'เซต', 'กล่อง', 'แพ็ค', 'แพ็ก', 'แพค', 'โหล', 'ด้าม',
  'เล่ม', 'ขวด', 'แก้ว', 'กระบอก', 'เครื่อง', 'ก้อน', 'คู่', 'ถุง', 'ม้วน', 'แผ่น', 'ผืน', 'ลูก', 'ตลับ', 'หลอด',
  'ซอง', 'แท่ง', 'ห่อ', 'ลัง', 'สี', 'รุ่น', 'แบบ', 'คน', 'ท่าน', 'pcs', 'pieces', 'piece', 'units', 'unit', 'sets', 'set']
const BUDGET_BEFORE = /(?:งบ(?:(?!ราคา)[^\d\n]){0,20}?|budget|ไม่เกิน|ต่ำกว่า|ไม่ถึง|น้อยกว่า|under|below|up to|max(?:imum)?)\s*:?\s*(?:\d+(?:\.\d+)?\s*(?:-|–|~|ถึง)\s*)?$/i

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

/**
 * Every numeral that is not a decimal digit but whose compatibility form is
 * decimal digits, as those digits: superscript ¹²⁵⁰ is 1250, circled ① is 1 and
 * ⑳ is 20. A numeral with any other form (½ is 1⁄2, Ⅻ is XII) is left as written
 * for the leftover check. Characters are normalised one at a time, never the
 * whole text: NFKC would also rewrite Thai (ำ) and the fullwidth comma.
 */
export function numeralDigits(value) {
  return String(value).replace(NON_ASCII, (character) => {
    const compatible = character.normalize('NFKC')
    return compatible !== character && ALL_DECIMAL_DIGITS.test(compatible) ? compatible : character
  })
}

/**
 * Every number grouped by thousands (1,250, or １，２５０ once its digits are
 * ASCII) without its separators, so 1,250 reads as 1250 and 10,000mAh as
 * 10000mAh. Commas that do not group thousands are left alone. With
 * `{ asciiOnly: true }`, as the evidence is read, only an ASCII comma groups.
 */
export function ungroupedNumbers(value, { asciiOnly = false } = {}) {
  return String(value).replace(asciiOnly ? ASCII_GROUPED_NUMBER : GROUPED_NUMBER,
    (number) => number.replace(GROUP_SEPARATOR, ''))
}

/** Every run of three-digit groups joined by single spaces (1 250) as one number. */
export function spaceUngroupedNumbers(value) {
  return String(value).replace(SPACE_GROUPED_NUMBER, (number) => number.replace(SPACE_SEPARATOR, ''))
}

/**
 * A text as the checks read it: numerals as ASCII digits, every minus sign as
 * '-', thousands separators removed. The answer and the question also read
 * space-grouped digits as one number; the evidence does not.
 */
function checkedText(value, { evidence = false } = {}) {
  const text = ungroupedNumbers(asciiDigits(numeralDigits(value).replace(MINUS_SIGNS, '-')), { asciiOnly: evidence })
  return evidence ? text : spaceUngroupedNumbers(text)
}

/**
 * The evidence as the checks read it. Only string values are ungrouped, and the
 * JSON is indented so that a number array ([1, 250]) is written one element per
 * line: compact JSON would write it as 1,250 and invent a number it never held.
 */
function checkedEvidence(records) {
  return asciiDigits(JSON.stringify(records,
    (_key, value) => (typeof value === 'string' ? checkedText(value, { evidence: true }) : value), 1))
}

/**
 * Each run of numerals the checks cannot read as digits (½, Ⅻ, ⑴, or a symbol
 * whose compatibility form holds a digit), as written, in one pass.
 */
function leftoverNumerals(text) {
  const runs = new Set()
  let run = ''
  for (const character of text) {
    if (character > '\x7F' && (NUMERAL.test(character) || NUMERAL.test(character.normalize('NFKC')))) {
      run += character
    } else if (run) {
      runs.add(run)
      run = ''
    }
  }
  if (run) runs.add(run)
  return runs
}

/**
 * A decimal fraction as compared: trailing zeros are dropped only from a one- or
 * two-digit fraction (1250.50 is 1250.5, 1250.00 is 1250). A longer fraction
 * keeps them, so 1.250 (a European 1250) is not the evidence's 1.25.
 */
function comparedFraction(fraction) {
  return fraction.length <= 2 ? fraction.replace(/0+$/, '') : fraction
}

/** A code as the code check compares it: in capitals, a plain decimal by value. */
function codeKey(code) {
  const upper = code.toLocaleUpperCase()
  const decimal = DECIMAL_CODE.exec(upper)
  if (!decimal) return upper
  const fraction = comparedFraction(decimal[2])
  return fraction ? `${decimal[1]}.${fraction}` : decimal[1]
}

/**
 * A number as compared, from its digits as written and its sign: leading zeros
 * dropped, the fraction as comparedFraction reads it, and '-' kept unless the
 * value is zero. It is compared as text, so floating-point rounding never makes
 * two long digit strings equal.
 */
function numberValue(written, negative = false) {
  const [, whole, fraction = ''] = WRITTEN_NUMBER.exec(written)
  const digits = whole.replace(/^0+(?=\d)/, '')
  const kept = comparedFraction(fraction)
  const value = kept ? `${digits}.${kept}` : digits
  return negative && /[1-9]/.test(value) ? `-${value}` : value
}

/**
 * Whether the number starting at `index` carries a minus sign: a hyphen right
 * before it that is not joined to a code or a number (PM-1250, 3-5) and does not
 * follow a number across spaces, which makes it a range (150 -300).
 */
function signedAt(text, index) {
  if (text[index - 1] !== '-') return false
  if (index >= 2 && JOINS_HYPHEN.test(text[index - 2])) return false
  let at = index - 2
  while (at >= 0 && SPACE.test(text[at])) at -= 1
  return !(at >= 0 && ASCII_DIGIT.test(text[at]))
}

/** Each number in a checked text: its value, sign included, and its span. */
function numbersIn(text) {
  return [...text.matchAll(NUMBER)].map((match) => {
    const negative = signedAt(text, match.index)
    return {
      value: numberValue(match[0], negative),
      start: negative ? match.index - 1 : match.index,
      end: match.index + match[0].length,
    }
  })
}

function normalizedNumbers(text) {
  return new Set(numbersIn(text).map(({ value }) => value))
}

export function normalizedCodes(value) {
  return new Set((String(value).match(PRODUCT_CODE) ?? []).map((item) => item.toLocaleUpperCase()))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Each delivery time in the text as a [from, to] day range; one day count is [n, n]. */
function deliveryDays(value) {
  return [...String(value).matchAll(DELIVERY_DAYS)].map((match) => [Number(match[1]), Number(match[2] ?? match[1])])
}

/** Whether the number at [start, end) is framed as a budget in `text`. */
function budgetAt(text, start) {
  return BUDGET_BEFORE.test(text.slice(0, start))
}

/**
 * A candidate is supported when every number in it is in the evidence (or is a
 * number the customer typed, echoed as a quantity or as the budget they set),
 * every code in it that has a digit, or is a capital-letter code of a catalogue
 * family, is in the question or the evidence, and each delivery or stock claim it
 * makes is one the evidence makes, with any delivery time inside the evidence's.
 * All three texts are checked with their numerals as ASCII digits and their
 * thousands separators removed; the candidate itself is not changed. A numeral
 * that cannot be read as digits must appear as written in the evidence.
 */
export function verifyCandidate(question, evidence, candidate) {
  const records = checkedEvidence(evidence.records)
  const asked = checkedText(question)
  const text = checkedText(candidate)

  // A negative figure in the evidence also supports its magnitude (ลด 500 บาท
  // from -500); a positive one never supports a negative (-500 from 500).
  const evidenceNumbers = new Set(numbersIn(records).flatMap(({ value }) => [value, value.replace(/^-/, '')]))
  const askedNumbers = normalizedNumbers(asked)
  const askedBudgets = new Set(numbersIn(asked)
    .filter(({ start }) => budgetAt(asked, start))
    .map(({ value }) => value))
  const units = [...QUANTITY_UNITS, ...(evidence.records ?? []).map((record) => record?.unit)
    .filter((unit) => typeof unit === 'string' && unit.trim())]
  // The unit must end there: <unit>ละ is a unit price (99 ชิ้นละ), and an ASCII
  // unit must not run on into a word (99 settlement).
  const quantityAfter = new RegExp(
    `^\\s*(?:${units.map((unit) => escapeRegExp(unit.trim())).join('|')})(?!ละ)(?![A-Za-z])`, 'i')
  // A number inside a code that starts with a letter (USB-999) is the code rule's
  // to judge, as it always was; a measurement such as 64GB is still a number.
  const codeSpans = [...text.matchAll(PRODUCT_CODE)]
    .filter((match) => /^[A-Z]/i.test(match[0]) && /\d/.test(match[0]))
    .map((match) => [match.index, match.index + match[0].length])
  const echoAllowed = (value, start, end) => codeSpans.some(([from, to]) => start >= from && end <= to)
    || quantityAfter.test(text.slice(end))
    || (askedBudgets.has(value) && budgetAt(text, start))
  // A numeral the checks cannot read as digits is supported only when the
  // evidence writes the same run of numerals.
  const leftovers = leftoverNumerals(text)
  const evidenceLeftovers = leftovers.size ? leftoverNumerals(records) : leftovers
  const unsupportedNumbers = [...new Set([
    ...numbersIn(text)
      .filter(({ value, start, end }) => !evidenceNumbers.has(value)
        && (!askedNumbers.has(value) || !echoAllowed(value, start, end)))
      .map(({ value }) => value),
    ...[...leftovers].filter((numeral) => !evidenceLeftovers.has(numeral)),
  ])]

  const allowedCodes = new Set([...normalizedCodes(`${asked}\n${records}`)].map(codeKey))
  const families = new Set([...CODE_FAMILIES, ...(evidence.records ?? [])
    .map((record) => record?.product_code)
    .filter((code) => typeof code === 'string')
    .map((code) => code.split(CODE_SEPARATOR)[0].toLocaleUpperCase())])
  const unsupportedCodes = [...new Set((text.match(PRODUCT_CODE) ?? [])
    .filter((code) => /\d/.test(code) || (LETTER_CODE.test(code) && families.has(code.split(CODE_SEPARATOR)[0])))
    .map(codeKey)
    .filter((code) => !allowedCodes.has(code)))]

  const evidenceDays = [...deliveryDays(records),
    ...[...records.matchAll(LEAD_TIME_DAYS)].map((match) => [Number(match[1]), Number(match[1])])]
  const riskyClaim = RISK_CLAIMS.some(({ claim, evidence: made }) => claim.test(text) && !made.test(records))
    || deliveryDays(text).some(([from, to]) => !evidenceDays.some(([low, high]) => low <= from && to <= high))
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
