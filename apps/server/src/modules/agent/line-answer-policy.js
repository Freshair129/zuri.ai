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
// those digits when it stands alone; glued to a letter or digit it is dropped
// if it is a lone ¹, ² or ³ (m², a footnote ³) and otherwise read literally,
// any other numeral (½, Ⅻ) must appear as written in the evidence, a minus sign
// is part of the value (ราคา -500 is not 500; a bullet or discount dash is read as
// a dash when the evidence has no negative figure), only valid thousands grouping
// is ungrouped (12,50 is 12 and 50), a decimal with a fraction of three digits or
// more keeps its zeros (1.250 is not 1.25), and a space-grouped chain that is
// valid thousands grouping is read both as one number and part by part (1 250 is
// supported by 1250 or by 1 and 250; a phone number is never merged). An answer
// longer than LINE_TEXT_LIMIT is rejected unchecked.
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
// A chain of digit groups each joined by a single space, no-break space, thin
// space or narrow no-break space (1 250, 081 234 5678), not attached to a code or
// a decimal before it. The text is never rewritten for it; the number check reads
// the chain both ways (see spaceRuns). It is a grouped number only when it is
// valid thousands grouping: a first group of one to three digits not starting
// with 0, then groups of exactly three, then an optional fraction. A phone number
// (081 234 5678, 02 123 4567) never is, nor is a chain with another group (1 2500).
const SPACE_CHAIN = /(?<![A-Za-z0-9_.,-])\d+(?:[ \u00A0\u2009\u202F]\d+)+(?:\.\d+)?/g
const SPACE_GROUPED = /^[1-9]\d{0,2}(?:[ \u00A0\u2009\u202F]\d{3})+(?:\.\d+)?$/
const SPACE_SEPARATOR = /[ \u00A0\u2009\u202F]/g
// Minus signs other than the ASCII hyphen-minus, read as it: U+2212 MINUS SIGN,
// U+FE63 SMALL HYPHEN-MINUS and U+FF0D FULLWIDTH HYPHEN-MINUS.
const MINUS_SIGNS = /[\u2212\uFE63\uFF0D]/g
// A hyphen is a minus sign only at the start of the text or after whitespace or
// an opening bracket (ราคา -500, (-500)). Glued to anything else it joins or
// separates: PM-1250, 3-5, ราคา-500, ราคา:-500, 150บาท-300บาท, ✅-500.
const OPENS_SIGN = /[\s([{]/
// A hyphen within this many characters after a number on the same line reads as
// a range (150 บาท -300 บาท, 1,250 -1,300), not a sign.
const RANGE_REACH = 12
// A sign that may be a dash for a discount rather than a negative figure: after a
// discount word (ส่วนลด -20%, ลด -500) or before a percentage (-20%).
const DISCOUNT_BEFORE = /(?:ส่วนลด|ลด|discount|off|save)\s*:?\s*$/i
const DISCOUNT_REACH = 24
const INLINE_SPACE = /[^\S\n]/
const ASCII_DIGIT = /\d/
// A superscript or subscript digit run, with the letter, mark or digit it is
// glued to if any (see numeralDigits). Only a lone ¹, ² or ³ glued to a letter
// (m², บาท³) is a unit power or a footnote mark and is dropped.
const SCRIPT_RUN = /([\p{L}\p{M}\p{Nd}])?([\u00B2\u00B3\u00B9\u2070\u2074-\u2079\u2080-\u2089]+)/gu
const SCRIPT_DIGIT = /[\u00B2\u00B3\u00B9\u2070\u2074-\u2079\u2080-\u2089]/u
const FOOTNOTE_SCRIPT = /^[\u00B2\u00B3\u00B9]$/u
const LETTER_OR_MARK = /[\p{L}\p{M}]/u
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
 * A superscript or subscript run is read as digits only when it stands alone
 * (ราคา ¹²⁵⁰). Glued to a letter, a single ¹, ² or ³ is a unit power or a
 * footnote mark (m², บาท³) and is dropped. Any other glued run (5⁰⁰, 10⁵,
 * ราคา¹²⁵⁰, H₂O) is left as written, so the leftover check requires it to appear
 * literally in the evidence: reading it as digits or dropping it would let an
 * answer write a figure the evidence does not hold.
 */
export function numeralDigits(value) {
  return String(value).replace(SCRIPT_RUN, (_match, glued, run) => {
    if (!glued) return run.normalize('NFKC')
    return FOOTNOTE_SCRIPT.test(run) && LETTER_OR_MARK.test(glued) ? glued : `${glued}${run}`
  }).replace(NON_ASCII, (character) => {
    if (SCRIPT_DIGIT.test(character)) return character
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

/**
 * A text as the checks read it: numerals as ASCII digits, every minus sign as
 * '-', comma thousands separators removed (only the ASCII comma in the evidence).
 */
function checkedText(value, { evidence = false } = {}) {
  return ungroupedNumbers(asciiDigits(numeralDigits(value).replace(MINUS_SIGNS, '-')), { asciiOnly: evidence })
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
 * The minus sign on the number starting at `index`, or null. A hyphen right
 * before the number is a sign only at the start of the text or after whitespace
 * or an opening bracket, and not within RANGE_REACH characters after a number on
 * the same line (a range). The sign is `loose` when it may be a dash rather than
 * a negative: a bullet (only spaces before it on its line) or a discount (after
 * a discount word, or before a percentage). verifyCandidate reads a loose sign in
 * the answer as a dash when the evidence has no negative figure at all.
 * Every scan is bounded or covers a run only the one hyphen after it scans.
 */
function signAt(text, index, end) {
  if (text[index - 1] !== '-') return null
  if (index >= 2 && !OPENS_SIGN.test(text[index - 2])) return null
  for (let at = index - 2; at >= Math.max(0, index - 2 - RANGE_REACH) && text[at] !== '\n'; at -= 1) {
    if (ASCII_DIGIT.test(text[at])) return null
  }
  let at = index - 2
  while (at >= 0 && INLINE_SPACE.test(text[at])) at -= 1
  const bullet = at < 0 || text[at] === '\n'
  const discount = text[end] === '%'
    || DISCOUNT_BEFORE.test(text.slice(Math.max(0, index - 1 - DISCOUNT_REACH), index - 1))
  return { loose: bullet || discount }
}

/**
 * Each number in a checked text: its value (sign included), its magnitude, its
 * span, and whether its sign is loose (see signAt).
 */
function numbersIn(text) {
  return [...text.matchAll(NUMBER)].map((match) => {
    const end = match.index + match[0].length
    const sign = signAt(text, match.index, end)
    return {
      value: numberValue(match[0], Boolean(sign)),
      magnitude: numberValue(match[0]),
      start: sign ? match.index - 1 : match.index,
      index: match.index,
      end,
      loose: Boolean(sign?.loose),
    }
  })
}

/**
 * Each chain of digit groups joined by single spaces that is valid thousands
 * grouping (see SPACE_CHAIN), with its merged number and the numbers it is made
 * of (from `numbers`, in text order). A chain the evidence or the question reads
 * either way is checked either way: 1 250 is supported by 1250, or by 1 and 250.
 */
function spaceRuns(text, numbers) {
  const runs = []
  let next = 0
  for (const match of text.matchAll(SPACE_CHAIN)) {
    if (!SPACE_GROUPED.test(match[0])) continue
    const end = match.index + match[0].length
    while (next < numbers.length && numbers[next].end <= match.index) next += 1
    const parts = []
    while (next < numbers.length && numbers[next].end <= end) parts.push(numbers[next++])
    if (parts.length < 2) continue
    const negative = parts[0].value.startsWith('-')
    const digits = match[0].replace(SPACE_SEPARATOR, '')
    runs.push({ merged: { value: numberValue(digits, negative), start: parts[0].start, end }, digits, parts })
  }
  return runs
}

/** Every number value in a checked text, space-grouped chains read both ways. */
function normalizedNumbers(text) {
  const numbers = numbersIn(text)
  return new Set([...numbers.map(({ value }) => value), ...spaceRuns(text, numbers).map(({ merged }) => merged.value)])
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
  // An answer longer than LINE can send is not checked at all: it could not be
  // sent as written, and the cap bounds the per-number work below.
  if (String(candidate).length > LINE_TEXT_LIMIT) {
    return { supported: false, unsupportedNumbers: [], unsupportedCodes: [], riskyClaim: false, overLimit: true }
  }
  const records = checkedEvidence(evidence.records)
  const asked = checkedText(question)
  const text = checkedText(candidate)

  // A negative figure in the evidence also supports its magnitude (ลด 500 บาท
  // from -500); a positive one never supports a negative (-500 from 500).
  const evidenceFigures = numbersIn(records)
  const evidenceNumbers = new Set(evidenceFigures.flatMap(({ value, magnitude }) => [value, magnitude]))
  const evidenceHasNegative = evidenceFigures.some(({ value }) => value.startsWith('-'))
  // The question's space-grouped chains count both ways, so 300 and 500 of
  // "งบ 300 500 ชิ้น" can each be echoed, and so can 1250 of "1 250 ชิ้น".
  const askedNumbers = normalizedNumbers(asked)
  const askedFigures = numbersIn(asked)
  const askedRuns = spaceRuns(asked, askedFigures)
  const askedBudgets = new Set([...askedFigures, ...askedRuns.map(({ merged }) => merged)]
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
  // A loose sign (a bullet or discount dash) is read as a dash when the evidence
  // has no negative figure; otherwise, and always for ราคา -500, it is a sign, so
  // -500 is never supported by the evidence's 500.
  const figures = numbersIn(text).map((figure) => (figure.loose && !evidenceHasNegative
    ? { ...figure, value: figure.magnitude, start: figure.start + 1 } : figure))
  const supported = ({ value, start, end }) => evidenceNumbers.has(value)
    || (askedNumbers.has(value) && echoAllowed(value, start, end))
  // A space-grouped chain is supported as its merged number or part by part, so
  // text copied from the evidence (1 250, 10 000 mAh, 150 250 บาท) still passes.
  const runs = spaceRuns(text, figures)
  const inRun = new Set(runs.flatMap(({ parts }) => parts))
  const unsupportedNumbers = [...new Set([
    ...figures.filter((figure) => !inRun.has(figure) && !supported(figure)).map(({ value }) => value),
    ...runs.filter(({ merged, parts }) => !supported(merged) && !parts.every(supported)).map(({ merged }) => merged.value),
    ...[...leftovers].filter((numeral) => !evidenceLeftovers.has(numeral)),
  ])]

  // The question's space-grouped chains are allowed codes merged too, so the
  // 1250 of "ขอ 1 250 ชิ้น" may be written 1250 or 1,250 in the answer.
  const allowedCodes = new Set([...normalizedCodes(`${asked}\n${records}`), ...askedRuns.map(({ digits }) => digits)]
    .map(codeKey))
  const families = new Set([...CODE_FAMILIES, ...(evidence.records ?? [])
    .map((record) => record?.product_code)
    .filter((code) => typeof code === 'string')
    .map((code) => code.split(CODE_SEPARATOR)[0].toLocaleUpperCase())])
  // A code that starts at a part of a supported space-grouped chain belongs to
  // that number, which the number check has already allowed: a code of digits
  // only inside it (the 250 of 1 250) is not checked again, and a code glued to
  // its last part (the 000mAh of 10 000mAh) is allowed as written or with the
  // chain merged into it (10000MAH).
  const chainAt = new Map(runs
    .filter(({ merged, parts }) => supported(merged) || parts.every(supported))
    .flatMap((chain) => chain.parts.map((part) => [part.index, chain])))
  const unsupportedCodes = [...new Set([...text.matchAll(PRODUCT_CODE)]
    .filter((match) => /\d/.test(match[0])
      || (LETTER_CODE.test(match[0]) && families.has(match[0].split(CODE_SEPARATOR)[0])))
    .flatMap((match) => {
      const code = match[0]
      const key = codeKey(code)
      const chain = chainAt.get(match.index)
      const end = match.index + code.length
      if (chain && /^[\d.]+$/.test(code) && end <= chain.merged.end) return []
      const last = chain?.parts.at(-1)
      if (last?.index === match.index && end > chain.merged.end
        && allowedCodes.has(codeKey(`${chain.digits}${code.slice(last.end - last.index)}`))) return []
      return allowedCodes.has(key) ? [] : [key]
    }))]

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
