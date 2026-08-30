import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALWAYS_IN_SCOPE,
  countCells,
  evaluateTableIntegrity,
  findSplitTables,
  isSeparatorRow,
  isTableRow,
  scopeFromLedger,
} from '../../scripts/table-integrity.mjs'

// @spec scripts/table-integrity.mjs — preflight Check 16 (table-integrity)
//
// On 2026-08-30, five tables in docs/PRD-SDD-v1.0.md were found to have been
// split by a single blank line since 2026-08-14. A blank line ends a GFM table,
// so every row below each break — 82 FR rows among them — had been rendering as
// literal pipe-delimited text for sixteen days. Nothing saw it: every generator
// and check in scripts/ matches a registry row with a line-anchored regex and
// none parses the table as a table, so a document whose tables do not render is
// indistinguishable to them from one whose tables do. This file is the
// regression, and the last describe block runs the rule against the real
// pre-repair document out of git rather than against a fixture.
//
// NO LITERAL REQUIREMENT ID APPEARS BELOW. scripts/doc-graph.mjs turns any
// `(FR|NFR|BR|SEC|SDD)-\d{3}` token in a test file into a `verifies` edge, so
// quoting real ids as fixture data would credit this test in TRACE.md and
// Appendix D with requirements it does not exercise. Fixtures use a `QQ-` family
// no registry declares; where the real document's own ids are needed, they are
// assembled at runtime from parts that never appear contiguously in this source.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lines = (...ls) => ls.join('\n')

const HEADER = '| Id | Statement | Status |'
const SEP = '|---|---|---|'
const row = (n, text = 'a statement') => `| QQ-${n} | ${text} | ✅ |`

describe('countCells — GFM cell counting', () => {
  it('drops the empty strings either side of the outer pipes', () => {
    expect(countCells('| a | b | c |')).toBe(3)
    expect(countCells('|a|b|')).toBe(2)
    expect(countCells('   | a | b |   ')).toBe(2)
  })

  it('does not start a cell on an escaped pipe', () => {
    // 442 rows of the main registry write `\|` inside a code span, so getting
    // this wrong would mis-count one side of a break and hide it.
    expect(countCells('| a | `dry-run\\|commit` | c |')).toBe(3)
    expect(countCells('| `\\| Field \\| Value \\|` | b |')).toBe(2)
  })

  it('counts a pipe inside a code span as a delimiter, the way GFM does', () => {
    // Deliberate and documented: cmark-gfm splits a row on its pipes BEFORE
    // inline parsing, so backticks protect nothing and an unescaped pipe in a
    // code span really does open a cell on the rendered page. Counting it any
    // other way would mean this check disagreed with the renderer about what a
    // table looks like — the exact gap it exists to close.
    expect(countCells('| a | `x|y` | c |')).toBe(4)
  })

  it('keeps a trailing lone backslash as content rather than eating the pipe', () => {
    expect(countCells('| a\\ | b |')).toBe(2)
  })
})

describe('isTableRow / isSeparatorRow', () => {
  it('accepts a row that both opens and closes with a pipe', () => {
    expect(isTableRow('| a | b |')).toBe(true)
    expect(isTableRow('  | a |  ')).toBe(true)
    expect(isTableRow('a | b')).toBe(false)
    expect(isTableRow('prose with a | in it.')).toBe(false)
    expect(isTableRow('')).toBe(false)
    expect(isTableRow('|')).toBe(false)
  })

  it('recognises a separator with and without alignment colons', () => {
    expect(isSeparatorRow('|---|---|')).toBe(true)
    expect(isSeparatorRow('| :--- | ---: | :---: |')).toBe(true)
    expect(isSeparatorRow('| ------ |')).toBe(true)
    expect(isSeparatorRow('| a | b |')).toBe(false)
    expect(isSeparatorRow('| -- x |')).toBe(false)
  })
})

describe('findSplitTables — the rule', () => {
  it('fires on a table split in two, and names the blank line', () => {
    const doc = lines('# Registry', '', HEADER, SEP, row('001'), row('002'), '', row('003'), row('004'), '')
    const hits = findSplitTables(doc)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(7) // 1-based, the blank line itself
    expect(hits[0].cells).toBe(3)
    expect(hits[0].before).toBe(row('002'))
    expect(hits[0].after).toBe(row('003'))
  })

  it('reports every split in a document, not the first', () => {
    const doc = lines(HEADER, SEP, row('001'), '', row('002'), row('003'), '', row('004'))
    expect(findSplitTables(doc).map((h) => h.line)).toEqual([4, 7])
  })

  it('does not fire on two adjacent tables with different cell counts', () => {
    const doc = lines(
      '| Id | Statement | Status |', '|---|---|---|', row('001'),
      '',
      '| Term | Meaning |', '|---|---|', '| space | a container |'
    )
    expect(findSplitTables(doc)).toEqual([])
  })

  it('does not fire on two adjacent tables with the SAME cell count', () => {
    // The one false positive the rule produced when run over the whole docs tree
    // (docs/zuri_workspace_system.md): two two-column tables separated only by a
    // blank line. What parts them is the line after the blank being a HEADER —
    // a separator sits directly under it. A separator only ever appears under a
    // header, so this condition cannot cost a true positive.
    const doc = lines(
      '| Site | Reads |', '|---|---|', '| a | b |',
      '',
      '| Default Space created | Result |', '|---|---|', '| per Business | works |'
    )
    expect(findSplitTables(doc)).toEqual([])
  })

  it('does not fire on a blank line adjacent to a separator row', () => {
    // Above a separator: the blank sits between a previous table and this one's
    // header. Below one: a header/separator pair with its body pushed away —
    // a different defect, not the mid-table split this check reports.
    expect(findSplitTables(lines(row('001'), '', SEP, row('002')))).toEqual([])
    expect(findSplitTables(lines(HEADER, SEP, '', row('001')))).toEqual([])
  })

  it('does not fire on a blank line between a table and prose', () => {
    expect(findSplitTables(lines(HEADER, SEP, row('001'), '', 'Prose follows.', '', row('002')))).toEqual([])
  })

  it('does not fire on a blank line between a table and a heading', () => {
    expect(findSplitTables(lines(row('001'), '', '## Next section', '', row('002')))).toEqual([])
  })

  it('does not fire across two blank lines', () => {
    expect(findSplitTables(lines(row('001'), '', '', row('002')))).toEqual([])
  })

  it('handles a table at end of file without firing or throwing', () => {
    expect(findSplitTables(lines(HEADER, SEP, row('001')))).toEqual([])
    expect(findSplitTables(lines(HEADER, SEP, row('001'), ''))).toEqual([])
    expect(findSplitTables(lines(HEADER, SEP, row('001'), '', ''))).toEqual([])
    expect(findSplitTables('')).toEqual([])
    expect(findSplitTables(undefined)).toEqual([])
  })

  it('ignores a split table inside a fenced code block', () => {
    // A fenced example of this defect is documentation of the check, not an
    // instance of it — and the module docs for Check 16 contain exactly that.
    const doc = lines('```md', row('001'), '', row('002'), '```')
    expect(findSplitTables(doc)).toEqual([])
    expect(findSplitTables(lines('~~~', row('001'), '', row('002'), '~~~'))).toEqual([])
  })

  it('still sees a split after a fenced block has closed', () => {
    const doc = lines('```js', 'const a = 1', '```', '', HEADER, SEP, row('001'), '', row('002'))
    expect(findSplitTables(doc).map((h) => h.line)).toEqual([8])
  })

  it('compares cell counts, so a break between rows of different widths is not reported', () => {
    // Not a compromise: an equal-count test is what keeps unrelated tables
    // apart, and a real break always has matching widths on both sides.
    expect(findSplitTables(lines('| a | b | c |', '', '| a | b |'))).toEqual([])
  })
})

describe('scopeFromLedger — scope is read, not hardcoded', () => {
  const ledger = (registries) => JSON.stringify({ registries })

  it('takes every registry that names a file and skips every one that names a dir', () => {
    const scope = scopeFromLedger(
      ledger([
        { families: ['QQ'], file: 'docs/A.md', form: 'table' },
        { families: ['QR'], dir: 'docs/decisions', form: 'document-h1' },
        { families: ['QS'], file: 'docs/B.md', form: 'table' },
      ])
    )
    expect(scope.ok).toBe(true)
    expect(scope.files).toContain('docs/A.md')
    expect(scope.files).toContain('docs/B.md')
    expect(scope.skippedDirs).toEqual(['docs/decisions'])
  })

  it('keeps the FEAT registry in scope even if the ledger stops naming it', () => {
    const scope = scopeFromLedger(ledger([{ families: ['QQ'], file: 'docs/A.md', form: 'table' }]))
    expect(scope.files).toEqual(expect.arrayContaining(ALWAYS_IN_SCOPE))
  })

  it('does not list a file twice when the ledger already names it', () => {
    const scope = scopeFromLedger(ledger([{ families: ['FEAT'], file: 'docs/FEATURES.md', form: 'table' }]))
    expect(scope.files.filter((f) => f === 'docs/FEATURES.md')).toHaveLength(1)
  })

  it('refuses to guess when the ledger cannot be understood', () => {
    // "could not look" is never "clean": a scope this check silently failed to
    // build would look exactly like a scope with no splits in it.
    expect(scopeFromLedger('{ not json').ok).toBe(false)
    expect(scopeFromLedger(JSON.stringify({})).ok).toBe(false)
    expect(scopeFromLedger(ledger([])).ok).toBe(false)
    expect(scopeFromLedger(ledger([{ families: ['QQ'], dir: 'docs/decisions' }])).ok).toBe(false)
  })

  it('reads this repository own ledger and finds the registry documents', () => {
    const scope = scopeFromLedger(fs.readFileSync(path.join(ROOT, 'docs', '.id-ledger.json'), 'utf8'))
    expect(scope.ok).toBe(true)
    expect(scope.files).toContain('docs/PRD-SDD-v1.0.md')
    expect(scope.files).toContain('docs/FEATURES.md')
    for (const f of scope.files) expect(fs.existsSync(path.join(ROOT, f))).toBe(true)
  })
})

describe('evaluateTableIntegrity — the finding', () => {
  const ledgerText = JSON.stringify({ registries: [{ families: ['QQ'], file: 'docs/A.md', form: 'table' }] })
  const run = (docs) =>
    evaluateTableIntegrity({
      ledgerText,
      read: (p) => {
        if (!(p in docs)) throw new Error(`no fixture for ${p}`)
        return docs[p]
      },
      exists: (p) => p in docs,
    })

  const clean = lines(HEADER, SEP, row('001'), row('002'))

  it('is silent on documents whose tables are whole', () => {
    expect(run({ 'docs/A.md': clean, 'docs/FEATURES.md': clean })).toEqual([])
  })

  it('raises one CRITICAL naming the file and the line', () => {
    const findings = run({ 'docs/A.md': lines(HEADER, SEP, row('001'), '', row('002')), 'docs/FEATURES.md': clean })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].check).toBe('table-integrity')
    expect(findings[0].title).toContain('docs/A.md')
    expect(findings[0].details).toContain('docs/A.md:4')
    expect(findings[0].files).toEqual(['docs/A.md'])
    expect(findings[0].action).toMatch(/Delete the blank line/)
  })

  it('names every location rather than a count, because the remedy is per-line', () => {
    const doc = lines(HEADER, SEP, row('001'), '', row('002'), row('003'), '', row('004'))
    const [finding] = run({ 'docs/A.md': doc, 'docs/FEATURES.md': clean })
    expect(finding.details).toContain('docs/A.md:4')
    expect(finding.details).toContain('docs/A.md:7')
  })

  it('is CRITICAL when it could not look at all', () => {
    const broken = evaluateTableIntegrity({ ledgerText: '{ not json', read: () => '', exists: () => true })
    expect(broken).toHaveLength(1)
    expect(broken[0].severity).toBe('critical')
    expect(broken[0].action).toMatch(/NOT the same as finding nothing/)
  })

  it('is CRITICAL when a document in scope is missing or unreadable', () => {
    const missing = run({ 'docs/FEATURES.md': clean })
    expect(missing.some((f) => f.severity === 'critical' && f.files.includes('docs/A.md'))).toBe(true)

    const unreadable = evaluateTableIntegrity({
      ledgerText,
      read: () => {
        throw new Error('EACCES')
      },
      exists: () => true,
    })
    expect(unreadable.every((f) => f.severity === 'critical')).toBe(true)
    expect(unreadable[0].details).toMatch(/EACCES/)
  })
})

describe('the real document, not a fixture', () => {
  // Fixtures prove the rule. This proves the rule meets the file it was written
  // for: the same registry, the same escaped pipes, the same 500-odd rows.
  const REGISTRY = path.join(ROOT, 'docs', 'PRD-SDD-v1.0.md')
  const text = fs.readFileSync(REGISTRY, 'utf8').replace(/\r\n/g, '\n')

  it('is silent on the registry as it stands', () => {
    expect(findSplitTables(text)).toEqual([])
  })

  it('fires when the historical break is put back, and goes silent when it is removed', () => {
    // The first of the five 2026-08-30 breaks. Its id is assembled at runtime
    // (see the header note) so this file declares no requirement coverage.
    const boundary = ['FR', '047'].join('-')
    const docLines = text.split('\n')
    const at = docLines.findIndex((l) => l.startsWith(`| ${boundary} |`))
    expect(at).toBeGreaterThan(0)
    expect(isTableRow(docLines[at - 1])).toBe(true)
    expect(isSeparatorRow(docLines[at - 1])).toBe(false)

    const broken = [...docLines.slice(0, at), '', ...docLines.slice(at)].join('\n')
    const hits = findSplitTables(broken)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(at + 1)
    expect(hits[0].after).toBe(docLines[at])

    // …and removing it again is silence, not a smaller number.
    expect(findSplitTables(broken.split('\n').filter((_, i) => i !== at).join('\n'))).toEqual([])
  })
})
