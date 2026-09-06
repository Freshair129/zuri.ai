// @req FR-114 — canonical normalization that never destroys the raw value
// @spec SDD-061, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §9, §3.1 — raw stays recoverable
// @tested tests/unit/knowledge-normalization.test.js

/**
 * Produces a canonical form of a value WITHOUT replacing it.
 *
 * The whole stage rests on §3.1: raw data must remain recoverable. So this never
 * returns a canonical form on its own — it returns the pair, and the raw half is
 * the input unchanged, byte for byte. A caller that keeps only `canonical` has
 * broken the invariant this requirement exists to hold.
 */
export function normalizeValue({ value, kind = 'text', era }) {
  const raw = value
  const normalizer = NORMALIZERS[kind]
  if (!normalizer) {
    return {
      raw,
      kind,
      canonical: null,
      unsupported: `${kind} is not normalized by FR-114; its canonical form is business-configured, and one invented here would be wrong in a way that looks authoritative`,
    }
  }
  return { raw, kind, ...normalizer(value, era) }
}

const NORMALIZERS = {
  text: (value) => ({ canonical: collapseWhitespace(value) }),
  date: (value, era) => normalizeDate(value, era),
  phone: (value) => normalizePhone(value),
  email: (value) => normalizeEmail(value),
  organization: (value) => ({ canonical: normalizeOrganizationName(value) }),
}

/**
 * Unicode first, then whitespace.
 *
 * NFC before collapsing matters for Thai: two spellings can be visually identical
 * and unequal as strings, and a comparison downstream would call them different
 * organisations. The whitespace class is widened past \s deliberately — a
 * non-breaking space and a zero-width space are both invisible and neither is
 * matched by \s, so a name carrying one would never equal the same name typed
 * normally.
 */
function collapseWhitespace(text) {
  return String(text ?? '')
    .normalize('NFC')
    // NIKHAHIT + SARA AA -> SARA AM. The two render identically and no reader can
    // tell them apart, but they are different strings and NFC leaves them that
    // way — only NFKC unifies them, and NFKC also folds ligatures, full-width
    // forms and fraction glyphs, which is too much to do to a name. This is the
    // one Thai case worth folding by hand.
    .replace(/ํา/g, 'ำ')
    .replace(/[ ​‌‍﻿]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const THAI_MOBILE_OR_LANDLINE = /^0\d{8,9}$/

/**
 * Thai numbers to E.164. A leading 0 is the national trunk prefix and is replaced
 * by +66, not kept alongside it — "+6608..." is a number that does not exist.
 */
function normalizePhone(value) {
  const digits = arabicDigits(value).replace(/[\s\-().]/g, '')
  if (THAI_MOBILE_OR_LANDLINE.test(digits)) return { canonical: `+66${digits.slice(1)}` }
  if (/^\+66\d{8,9}$/.test(digits)) return { canonical: digits }
  if (/^66\d{8,9}$/.test(digits)) return { canonical: `+${digits}` }
  return { canonical: null, invalid: 'not a recognisable Thai telephone number' }
}

/**
 * Lowercases the domain only. The local part is case-sensitive by RFC 5321 —
 * folding it is a silent identity change, and the fact that most mail hosts
 * happen to ignore case does not make two different addresses one address.
 */
function normalizeEmail(value) {
  const trimmed = collapseWhitespace(value)
  const at = trimmed.lastIndexOf('@')
  if (at <= 0 || at === trimmed.length - 1 || /\s/.test(trimmed)) {
    return { canonical: null, invalid: 'not a single well-formed address' }
  }
  return { canonical: `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}` }
}

const LEGAL_AFFIXES = [
  /^บริษัท\s+/,
  /\s+จำกัด$/,
  /^ห้างหุ้นส่วนจำกัด\s+/,
  /\s*(?:Co\.,?|Ltd\.?|Limited)\s*$/i,
]

/**
 * Reduces an organisation name to a comparable form using ONLY the name itself.
 *
 * Stage 4 owns this rule and Stage 8 imports it, rather than each keeping a copy
 * that can drift. The order is fixed and stated: normalization runs BEFORE
 * extraction, so a mention is stripped once, by this function, wherever it came
 * from. It stays lexical — the moment it consults a registry or its neighbours it
 * has started resolving, which is Stage 9's (FR-113, SDD-060).
 */
export function normalizeOrganizationName(value) {
  let text = collapseWhitespace(value)
  let changed = true
  while (changed) {
    changed = false
    for (const affix of LEGAL_AFFIXES) {
      const next = text.replace(affix, '').trim()
      if (next !== text && next) {
        text = next
        changed = true
      }
    }
  }
  return text
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
const BUDDHIST_OFFSET = 543
/** Below this, a four-digit year cannot be Buddhist — 2400 BE is 1857 CE. */
const BUDDHIST_FLOOR = 2400

function arabicDigits(text) {
  return String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
}

function isRealDate(year, month, day) {
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * Reads a date, or declines to.
 *
 * Declining is the feature. A Thai business document writes 25/8/26 for both
 * 2526 BE and 2026 CE, and nothing in the string separates them — the two
 * readings are forty-three years apart and both are plausible. A normalizer that
 * picks one produces a date that is wrong in a way no downstream check can see,
 * so this one returns no canonical value at all rather than a guessed one. The
 * caller supplies `era` when it knows, and gets an answer; otherwise it gets the
 * ambiguity, which it must handle because there is nothing else to read.
 */
function normalizeDate(value, era) {
  const text = arabicDigits(value).trim()

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number)
    if (!isRealDate(y, m, d)) return { canonical: null, invalid: 'no such calendar date' }
    return { canonical: iso(y, m, d) }
  }

  const parts = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/)
  if (!parts) return { canonical: null, invalid: 'unrecognised date format' }

  const first = Number(parts[1])
  const second = Number(parts[2])
  const yearText = parts[3]

  // Field order. Only an out-of-range field settles it; when both could be a
  // month, the string genuinely does not say which is which.
  let day
  let month
  if (first > 12 && second <= 12) { day = first; month = second }
  else if (second > 12 && first <= 12) { month = first; day = second }
  else return { canonical: null, ambiguous: 'day and month are both twelve or under; the order is not stated' }

  // Era. A four-digit year declares itself; a two-digit one does not, and the
  // two readings are a lifetime apart.
  let year
  if (yearText.length === 4) {
    const declared = Number(yearText)
    year = declared >= BUDDHIST_FLOOR ? declared - BUDDHIST_OFFSET : declared
  } else if (era === 'BE') {
    year = 2500 + Number(yearText) - BUDDHIST_OFFSET
  } else if (era === 'CE') {
    year = 2000 + Number(yearText)
  } else {
    return { canonical: null, ambiguous: 'a two-digit year is Buddhist or Gregorian and the value does not say; pass era to decide' }
  }

  if (!isRealDate(year, month, day)) return { canonical: null, invalid: 'no such calendar date' }
  return { canonical: iso(year, month, day) }
}
