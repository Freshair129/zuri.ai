import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describePayload, formatPayloadValue, humanizeEnumLikeValue, humanizeFieldKey } from '@/app/(pm)/audit/page'

// @req FR-014, FR-046 — UAT internal-leakage sweep on /audit.
//
// Two independent presentation defects on one page, both against the same
// deliberate design: FR-014's payload is a genuinely useful "what changed"
// record and FR-046's installation-wide audit read is a genuinely correct
// scope — neither the read model nor the API contract changes here.
//
//   1. RAW PAYLOAD — the payload cell rendered `JSON.stringify(e.payload)`
//      inside a CSS-truncated <code> block, so an operator read a
//      mid-string-cut blob like `{"status":"IN_PROG` instead of what changed.
//   2. SCOPE DISCLOSURE — the page is mounted inside the per-Business shell
//      (a Business breadcrumb above it) but never said its rows span every
//      Business, which reads as a scoping bug to anyone who does not already
//      know FR-046.
//
// This project's client components run under a node test environment with no
// DOM (see repositories-page-ui-contract.test.js, project-inventory-ui.test.js),
// so the pure formatting functions are exercised directly with real values,
// and the remaining wiring/prose facts are asserted against the page source.
const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('humanizeEnumLikeValue', () => {
  it('replaces underscores in a SCREAMING_SNAKE_CASE value', () => {
    expect(humanizeEnumLikeValue('IN_PROGRESS')).toBe('IN PROGRESS')
  })

  it('leaves an ordinary string untouched', () => {
    expect(humanizeEnumLikeValue('org/repo')).toBe('org/repo')
    expect(humanizeEnumLikeValue('Free text a person typed')).toBe('Free text a person typed')
  })

  it('leaves a lowercase or mixed-case token untouched (not enum-shaped)', () => {
    expect(humanizeEnumLikeValue('mixedCase_value')).toBe('mixedCase_value')
  })
})

describe('humanizeFieldKey', () => {
  it('turns a camelCase payload key into a sentence-case label', () => {
    expect(humanizeFieldKey('oldStatus')).toBe('Old status')
  })

  it('turns a snake_case payload key into a sentence-case label', () => {
    expect(humanizeFieldKey('old_status')).toBe('Old status')
  })

  it('never throws on a non-string key and still returns something legible', () => {
    expect(() => humanizeFieldKey(0)).not.toThrow()
    expect(humanizeFieldKey(0)).toBe('0')
  })
})

describe('formatPayloadValue', () => {
  it('humanizes an enum-shaped string value the same way the entity/action columns already do', () => {
    expect(formatPayloadValue('IN_PROGRESS')).toBe('IN PROGRESS')
  })

  it('passes through an ordinary string value unchanged', () => {
    expect(formatPayloadValue('Q4 rollout')).toBe('Q4 rollout')
  })

  it('renders null/undefined as an em dash, never as the word "null" or "undefined"', () => {
    expect(formatPayloadValue(null)).toBe('—')
    expect(formatPayloadValue(undefined)).toBe('—')
  })

  it('stringifies numbers and booleans', () => {
    expect(formatPayloadValue(42)).toBe('42')
    expect(formatPayloadValue(false)).toBe('false')
  })

  it('joins a non-empty array of primitives and marks an empty one', () => {
    expect(formatPayloadValue(['A', 'B'])).toBe('A, B')
    expect(formatPayloadValue([])).toBe('[]')
  })

  it('never collapses a nested object into "[object Object]"', () => {
    const rendered = formatPayloadValue({ from: 'A', to: 'B' })
    expect(rendered).not.toBe('[object Object]')
    expect(rendered).toContain('from')
  })
})

describe('describePayload', () => {
  it('is "empty" for null, undefined, and an empty object — never a crash', () => {
    expect(describePayload(null)).toEqual({ kind: 'empty' })
    expect(describePayload(undefined)).toEqual({ kind: 'empty' })
    expect(describePayload({})).toEqual({ kind: 'empty' })
  })

  it('turns a normal write-service payload into labeled fields, with enum values humanized', () => {
    const result = describePayload({ status: 'IN_PROGRESS', note: 'looks good' })
    expect(result.kind).toBe('fields')
    expect(result.fields).toEqual([
      { label: 'Status', value: 'IN PROGRESS' },
      { label: 'Note', value: 'looks good' },
    ])
  })

  it('degrades a payload that is not a plain object to legible raw text instead of crashing', () => {
    expect(describePayload('a bare string payload')).toEqual({ kind: 'raw', text: 'a bare string payload' })
    expect(describePayload(42)).toEqual({ kind: 'raw', text: '42' })
    expect(describePayload(['x', 'y'])).toEqual({ kind: 'raw', text: 'x, y' })
  })

  it('the regression case: a truncated-string leak becomes a readable field instead', () => {
    // Before the fix, {"status":"IN_PROGRESS"} rendered (truncated by CSS) as
    // raw JSON. After the fix it is a labeled, humanized field — and the raw
    // JSON string never appears in the description at all.
    const result = describePayload({ status: 'IN_PROGRESS' })
    expect(result).toEqual({ kind: 'fields', fields: [{ label: 'Status', value: 'IN PROGRESS' }] })
    expect(JSON.stringify(result)).not.toContain('"status":"IN_PROGRESS"')
  })
})

describe('Audit page — payload column no longer renders raw truncated JSON (FR-014)', () => {
  const page = src('src/app/(pm)/audit/page.jsx')

  it('does not stringify the payload straight into a truncated <code> block', () => {
    expect(page).not.toContain('JSON.stringify(e.payload)')
    expect(page).not.toMatch(/<code[^>]*truncate[^>]*>\s*\{JSON\.stringify/)
  })

  it('the payload column renders through the tested PayloadSummary/describePayload path', () => {
    const columnStart = page.indexOf("key: 'payload'")
    expect(columnStart).toBeGreaterThan(-1)
    const column = page.slice(columnStart, columnStart + 200)
    expect(column).toContain('PayloadSummary')
  })
})

describe('Audit page — installation-wide scope is disclosed on the page (FR-046)', () => {
  const page = src('src/app/(pm)/audit/page.jsx')

  it('states in plain text that the log spans every Business, not just the active one', () => {
    // Behaviour, not the exact sentence: the disclosure must name both the
    // installation-wide scope and the Business unit it is not limited to.
    expect(page).toMatch(/installation-wide/i)
    expect(page).toMatch(/every Business/i)
  })

  it('the disclosure is unconditional — present in the page body outside the loading/error/data branches', () => {
    const headerEnd = page.indexOf('/>', page.indexOf('<PageHeader'))
    const firstBranch = page.indexOf('{loading &&')
    expect(headerEnd).toBeGreaterThan(-1)
    expect(firstBranch).toBeGreaterThan(headerEnd)
    const betweenHeaderAndBranches = page.slice(headerEnd, firstBranch)
    expect(betweenHeaderAndBranches).toMatch(/installation-wide/i)
  })

  it('does not add a Business filter to the query — that would contradict FR-046', () => {
    expect(page).not.toContain('useScope')
    expect(page).not.toContain('activeBusinessId')
    expect(page).not.toMatch(/businessId/)
    // The only filter this page is allowed to add narrows the request itself
    // (entityType, already present) — not a client-side scope narrowing.
    expect(page).toContain('entityType')
  })

  it('the API contract this page reads is left untouched', () => {
    const route = src('src/app/api/audit/route.js')
    expect(route).toContain('@req FR-046 — audit is an installation-wide read')
    expect(route).toContain("isInstallationOperator(viewer)")
  })
})
