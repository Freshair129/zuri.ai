import { describe, it, expect } from 'vitest'
import { normalizeValue } from '@/modules/knowledge/normalization'

// @req FR-114 — canonical normalization that never destroys the raw value
// @spec docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §9 (Stage 4), §3.1

describe('the raw value survives', () => {
  it('returns the input byte for byte alongside the canonical form', () => {
    const raw = '  บริษัท   เอบีซี  จำกัด  '
    const result = normalizeValue({ value: raw, kind: 'text' })
    expect(result.raw).toBe(raw)
    expect(result.canonical).toBe('บริษัท เอบีซี จำกัด')
  })
})

describe('dates the string cannot decide', () => {
  it('refuses 25/8/26 — 2526 BE and 2026 CE are both plausible business dates', () => {
    const r = normalizeValue({ value: '25/8/26', kind: 'date' })
    expect(r.canonical).toBeNull()
    expect(r.ambiguous).toBeTruthy()
    expect(r.raw).toBe('25/8/26')
  })

  it('refuses 5/8/69 — day and month are both under thirteen', () => {
    expect(normalizeValue({ value: '5/8/69', kind: 'date' }).canonical).toBeNull()
  })

  it('gives no canonical value at all when it is unsure, so nobody can read one by accident', () => {
    const r = normalizeValue({ value: '25/8/26', kind: 'date' })
    expect(Object.values(r).includes('2026-08-25')).toBe(false)
    expect(Object.values(r).includes('1983-08-25')).toBe(false)
  })
})

describe('dates the string does decide', () => {
  it('reads 8/25/69 as month-first, because 25 cannot be a month', () => {
    const r = normalizeValue({ value: '8/25/69', kind: 'date', era: 'BE' })
    expect(r.canonical).toBe('2026-08-25')
  })

  it('converts a declared Buddhist year — the specification\'s own example', () => {
    expect(normalizeValue({ value: '25/8/69', kind: 'date', era: 'BE' }).canonical).toBe('2026-08-25')
  })

  it('reads a four-digit Buddhist year without needing a hint', () => {
    expect(normalizeValue({ value: '25/8/2569', kind: 'date' }).canonical).toBe('2026-08-25')
  })

  it('leaves an already-canonical date alone', () => {
    expect(normalizeValue({ value: '2026-08-25', kind: 'date' }).canonical).toBe('2026-08-25')
  })

  it('reads Thai digits', () => {
    expect(normalizeValue({ value: '๒๕/๘/๒๕๖๙', kind: 'date' }).canonical).toBe('2026-08-25')
  })
})

describe('dates that do not exist', () => {
  it('refuses 31/2/2569 instead of rolling it into March', () => {
    const r = normalizeValue({ value: '31/2/2569', kind: 'date' })
    expect(r.canonical).toBeNull()
    expect(r.invalid).toBeTruthy()
    expect(r.ambiguous).toBeFalsy()
  })
})

describe('whitespace that does not look like whitespace', () => {
  it.each([
    ['non-breaking space', 'เอบีซี จำกัด'],
    ['zero-width space', 'เอบีซี​จำกัด'],
    ['tab and newline', 'เอบีซี\t\nจำกัด'],
  ])('collapses a %s', (_label, input) => {
    expect(normalizeValue({ value: input, kind: 'text' }).canonical).toBe('เอบีซี จำกัด')
  })
})

describe('Thai text that is equal without being identical', () => {
  // สำ can be written as SARA AM (U+0E33), or as NIKHAHIT + SARA AA
  // (U+0E4D U+0E32). They render identically and no reader can tell them apart.
  // Unicode NFC does NOT unify them — only the lossier NFKC does — so a canonical
  // form that stops at NFC leaves two spellings of one organisation unequal.
  const withSaraAm = 'สำนักงานเอบีซี'
  const withNikhahit = 'สํานักงานเอบีซี'

  it('is a real difference — the two spellings are not the same string', () => {
    expect(withNikhahit).not.toBe(withSaraAm)
    expect(withNikhahit.normalize('NFC')).not.toBe(withSaraAm.normalize('NFC'))
  })

  it('gives both spellings the same canonical form anyway', () => {
    expect(normalizeValue({ value: withNikhahit, kind: 'text' }).canonical).toBe(
      normalizeValue({ value: withSaraAm, kind: 'text' }).canonical,
    )
  })

  it('still composes Latin marks, which NFC does handle', () => {
    const decomposed = 'Café ABC'
    expect(normalizeValue({ value: decomposed, kind: 'text' }).canonical).toBe('Café ABC')
  })
})

describe('phone numbers', () => {
  it.each([
    ['081-234-5678', '+66812345678'],
    ['0812345678', '+66812345678'],
    ['+66 81 234 5678', '+66812345678'],
    ['02-123-4567', '+6621234567'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeValue({ value: input, kind: 'phone' }).canonical).toBe(expected)
  })

  it('refuses a number too short to be one', () => {
    const r = normalizeValue({ value: '1234', kind: 'phone' })
    expect(r.canonical).toBeNull()
    expect(r.invalid).toBeTruthy()
  })
})

describe('email', () => {
  it('lowercases the domain and leaves the local part alone — the local part is case-sensitive', () => {
    expect(normalizeValue({ value: '  Foo.Bar@Example.COM ', kind: 'email' }).canonical).toBe('Foo.Bar@example.com')
  })

  it('refuses an address with a space in it', () => {
    expect(normalizeValue({ value: 'foo bar@example.com', kind: 'email' }).canonical).toBeNull()
  })
})

describe('organization name — one rule, owned here', () => {
  it('strips the legal wrapper the way Stage 8 expects', () => {
    expect(normalizeValue({ value: 'บริษัท เอบีซี จำกัด', kind: 'organization' }).canonical).toBe('เอบีซี')
    expect(normalizeValue({ value: 'ABC Co., Ltd.', kind: 'organization' }).canonical).toBe('ABC')
  })
})

describe('kinds this requirement does not claim', () => {
  it.each(['currency', 'unit', 'product_code', 'country', 'identifier', 'timezone'])(
    'declines %s rather than inventing a convention for it',
    (kind) => {
      const r = normalizeValue({ value: 'anything', kind })
      expect(r.canonical).toBeNull()
      expect(r.unsupported).toBeTruthy()
    },
  )
})
