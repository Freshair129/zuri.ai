import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALWAYS_IN_SCOPE,
  SWEPT_DIRS,
  countCells,
  evaluateTableIntegrity,
  findRaggedRows,
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

describe('findRaggedRows — a row that disagrees with its header', () => {
  it('is silent on a table whose every row matches its header', () => {
    expect(findRaggedRows(lines(HEADER, SEP, row('001'), row('002')))).toEqual([])
  })

  it('reports the row GFM would truncate, at its line, with both counts', () => {
    // The design-decision row's shape: a pipe inside a code span. (No literal
    // id here — see the header note.) GFM splits the row on its
    // pipes BEFORE inline parsing, so the code span does not protect it and the
    // fourth and fifth cells are discarded.
    const doc = lines(HEADER, SEP, row('001'), '| QQ-002 | a `|| 0` default | ✅ |')
    const [hit, ...rest] = findRaggedRows(doc)
    expect(rest).toEqual([])
    expect(hit.kind).toBe('over')
    expect(hit.line).toBe(4)
    expect(hit.cells).toBe(5)
    expect(hit.header).toBe(3)
    expect(hit.headerLine).toBe(1)
  })

  it('is silent once that pipe is escaped, which is the whole repair', () => {
    expect(findRaggedRows(lines(HEADER, SEP, '| QQ-002 | a `\\|\\| 0` default | ✅ |'))).toEqual([])
  })

  it('classifies a short row as padded rather than broken', () => {
    // GFM inserts empty cells, so the page says exactly what the file says.
    const [hit] = findRaggedRows(lines(HEADER, SEP, '| QQ-001 | only two |'))
    expect(hit.kind).toBe('under')
    expect(hit.cells).toBe(2)
  })

  it('reports a delimiter row that does not match its header, and stops there', () => {
    // The docs/SITEMAP-DOMAIN-NAV.md shape. GFM does not recognize the block as
    // a table AT ALL, so there is no column count for the rows below to be
    // ragged against and reporting them would be noise under the one real
    // defect.
    const hits = findRaggedRows(lines(HEADER, '|---|---|', row('001'), '| QQ-002 | a | b | c |'))
    expect(hits).toHaveLength(1)
    expect(hits[0].kind).toBe('separator')
    expect(hits[0].line).toBe(2)
    expect(hits[0].cells).toBe(2)
    expect(hits[0].header).toBe(3)
  })

  it('checks each table against its own header, not against the first one', () => {
    const two = lines(HEADER, SEP, row('001'), '', '| A | B |', '|---|---|', '| a | b | c |')
    const [hit] = findRaggedRows(two)
    expect(hit.kind).toBe('over')
    expect(hit.header).toBe(2)
    expect(hit.headerLine).toBe(5)
  })

  it('ignores a table inside a fenced code block', () => {
    // A fenced example of a broken table is documentation of this check, not an
    // instance of it — the same rule findSplitTables follows.
    const doc = lines('```md', HEADER, SEP, '| QQ-001 | a | b | c |', '```', HEADER, SEP, row('001'))
    expect(findRaggedRows(doc)).toEqual([])
  })

  it('ignores rows that are not under a delimiter row at all', () => {
    // Rows with no header above them are the split rule's subject, not this
    // one's; counting them here would report the same defect twice under two
    // different remedies.
    expect(findRaggedRows(lines('| a | b |', '| c | d | e |'))).toEqual([])
  })
})

describe('scopeFromLedger — scope is read and swept, not hardcoded', () => {
  const ledger = (registries) => JSON.stringify({ registries })
  const noAppendices = { listMarkdown: () => [] }

  it('takes every registry that names a file and skips every one that names a dir', () => {
    const scope = scopeFromLedger(
      ledger([
        { families: ['QQ'], file: 'docs/A.md', form: 'table' },
        { families: ['QR'], dir: 'docs/decisions', form: 'document-h1' },
        { families: ['QS'], file: 'docs/B.md', form: 'table' },
      ]),
      noAppendices
    )
    expect(scope.ok).toBe(true)
    expect(scope.files).toContain('docs/A.md')
    expect(scope.files).toContain('docs/B.md')
    expect(scope.skippedDirs).toEqual(['docs/decisions'])
  })

  it('sweeps the spec pack by directory rather than by list', () => {
    // The point of the sweep: a document nobody has heard of is in scope the day
    // it appears. Scoping this check to the registries alone is what let a sixth
    // split table sit in docs/appendices/A-api-spec.md unseen; scoping it to
    // registries-plus-appendices then let an unrendered table sit in
    // docs/SITEMAP-DOMAIN-NAV.md, which is neither.
    const seen = []
    const scope = scopeFromLedger(ledger([{ families: ['QQ'], file: 'docs/A.md', form: 'table' }]), {
      listMarkdown: (dir) => {
        seen.push(dir)
        return [`${dir}/appendices/Z-brand-new-appendix.md`, `${dir}/NOBODY-LISTED-THIS.md`]
      },
    })
    expect(seen).toEqual(SWEPT_DIRS)
    expect(scope.sweptDirs).toEqual(SWEPT_DIRS)
    expect(scope.files).toContain('docs/appendices/Z-brand-new-appendix.md')
    expect(scope.files).toContain('docs/NOBODY-LISTED-THIS.md')
  })

  it('keeps the ledger registries separately, so a caller can name them without printing the sweep', () => {
    const scope = scopeFromLedger(ledger([{ families: ['QQ'], file: 'docs/A.md', form: 'table' }]), {
      listMarkdown: () => ['docs/A.md', 'docs/swept-only.md'],
    })
    expect(scope.registryFiles).toContain('docs/A.md')
    expect(scope.registryFiles).not.toContain('docs/swept-only.md')
    expect(scope.files).toContain('docs/swept-only.md')
  })

  it('does not list a swept file twice when a registry already names it', () => {
    // docs/appendices/E-risk-matrix.md is both an RSK registry and an appendix.
    const scope = scopeFromLedger(ledger([{ families: ['RSK'], file: 'docs/appendices/E-risk-matrix.md' }]), {
      listMarkdown: () => ['docs/appendices/E-risk-matrix.md'],
    })
    expect(scope.files.filter((f) => f === 'docs/appendices/E-risk-matrix.md')).toHaveLength(1)
  })

  it('keeps the FEAT registry in scope even if the ledger stops naming it', () => {
    const scope = scopeFromLedger(ledger([{ families: ['QQ'], file: 'docs/A.md', form: 'table' }]), noAppendices)
    expect(scope.files).toEqual(expect.arrayContaining(ALWAYS_IN_SCOPE))
  })

  it('does not list a file twice when the ledger already names it', () => {
    const scope = scopeFromLedger(ledger([{ families: ['FEAT'], file: 'docs/FEATURES.md', form: 'table' }]), noAppendices)
    expect(scope.files.filter((f) => f === 'docs/FEATURES.md')).toHaveLength(1)
  })

  it('refuses to guess when the ledger cannot be understood', () => {
    // "could not look" is never "clean": a scope this check silently failed to
    // build would look exactly like a scope with no splits in it.
    expect(scopeFromLedger('{ not json', noAppendices).ok).toBe(false)
    expect(scopeFromLedger(JSON.stringify({}), noAppendices).ok).toBe(false)
    expect(scopeFromLedger(ledger([]), noAppendices).ok).toBe(false)
    expect(scopeFromLedger(ledger([{ families: ['QQ'], dir: 'docs/decisions' }]), noAppendices).ok).toBe(false)
  })

  it('refuses a narrower sweep rather than silently shrinking its own scope', () => {
    const named = ledger([{ families: ['QQ'], file: 'docs/A.md', form: 'table' }])
    // No lister at all, a lister that throws, and a lister that returns junk are
    // all "could not look" — never a quietly registry-only run.
    expect(scopeFromLedger(named).ok).toBe(false)
    expect(scopeFromLedger(named, { listMarkdown: () => { throw new Error('EPERM') } }).reason).toMatch(/EPERM/)
    expect(scopeFromLedger(named, { listMarkdown: () => 'docs/appendices/A.md' }).ok).toBe(false)
  })

  it('reads this repository own ledger and its real spec pack', () => {
    const listMarkdown = (dir, out = []) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (e.isDirectory()) listMarkdown(`${dir}/${e.name}`, out)
        else if (e.name.endsWith('.md')) out.push(`${dir}/${e.name}`)
      }
      return out
    }
    const scope = scopeFromLedger(fs.readFileSync(path.join(ROOT, 'docs', '.id-ledger.json'), 'utf8'), {
      listMarkdown: (dir) => listMarkdown(dir),
    })
    expect(scope.ok).toBe(true)
    expect(scope.files).toContain('docs/PRD-SDD-v1.0.md')
    expect(scope.files).toContain('docs/FEATURES.md')
    expect(scope.files).toContain('docs/appendices/A-api-spec.md')
    expect(scope.files).toContain('docs/appendices/D-traceability.md')
    for (const f of scope.files) expect(fs.existsSync(path.join(ROOT, f))).toBe(true)
  })
})

describe('evaluateTableIntegrity — the finding', () => {
  const ledgerText = JSON.stringify({ registries: [{ families: ['QQ'], file: 'docs/A.md', form: 'table' }] })
  const run = (docs, listMarkdown = () => []) =>
    evaluateTableIntegrity({
      ledgerText,
      read: (p) => {
        if (!(p in docs)) throw new Error(`no fixture for ${p}`)
        return docs[p]
      },
      exists: (p) => p in docs,
      listMarkdown,
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
    const broken = evaluateTableIntegrity({ ledgerText: '{ not json', read: () => '', exists: () => true, listMarkdown: () => [] })
    expect(broken).toHaveLength(1)
    expect(broken[0].severity).toBe('critical')
    expect(broken[0].action).toMatch(/NOT the same as finding nothing/)

    // …and equally when the spec pack could not be enumerated. A registry-only
    // run that reports PASS would be this check's own defect shape.
    const unswept = evaluateTableIntegrity({ ledgerText, read: () => '', exists: () => true })
    expect(unswept[0].severity).toBe('critical')
    expect(unswept[0].details).toMatch(new RegExp(SWEPT_DIRS.join('|')))
  })

  it('reports a split in a swept appendix, not only in a named registry', () => {
    const docs = {
      'docs/A.md': clean,
      'docs/FEATURES.md': clean,
      'docs/appendices/Z-new.md': lines(HEADER, SEP, row('001'), '', row('002')),
    }
    const findings = run(docs, () => ['docs/appendices/Z-new.md'])
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].files).toEqual(['docs/appendices/Z-new.md'])
    expect(findings[0].details).toContain('docs/appendices/Z-new.md:4')
  })

  it('raises a CRITICAL for a row wider than its header, naming file and line', () => {
    const docs = { 'docs/A.md': lines(HEADER, SEP, row('001'), '| QQ-002 | a `|| 0` d | ✅ |'), 'docs/FEATURES.md': clean }
    const findings = run(docs)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].details).toContain('docs/A.md:4')
    expect(findings[0].action).toMatch(/DISCARDS/)
  })

  it('raises a CRITICAL for a delimiter row that does not match its header', () => {
    const docs = { 'docs/A.md': lines(HEADER, '|---|---|', row('001')), 'docs/FEATURES.md': clean }
    const [finding] = run(docs)
    expect(finding.severity).toBe('critical')
    expect(finding.details).toContain('docs/A.md:2')
    expect(finding.action).toMatch(/does not recognize the block as a table/)
  })

  it('counts short rows in one info line and never blocks on them', () => {
    // The boundary that keeps this check readable: 24 per-row findings in a tree
    // with nothing wrong on the page is how a check's output stops being read.
    const docs = { 'docs/A.md': lines(HEADER, SEP, '| QQ-001 | two only |'), 'docs/FEATURES.md': clean }
    const findings = run(docs)
    expect(findings.every((f) => f.severity === 'info')).toBe(true)
    expect(findings).toHaveLength(1)
    expect(findings[0].details).toContain('docs/A.md:1')
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
      listMarkdown: () => [],
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
    expect(findRaggedRows(text).filter((r) => r.kind !== 'under')).toEqual([])
  })

  it('pins the design-decision repair: no row in the registry loses a cell to GFM', () => {
    // The row that started this: a JavaScript `|| 0` default written inside a
    // code span, which GFM split into two extra cells and then discarded. Its
    // id is assembled at runtime (see the header note) so this file declares no
    // requirement coverage.
    const id = ['SDD', '071'].join('-')
    const docLines = text.split('\n')
    const at = docLines.findIndex((l) => l.startsWith(`| ${id} |`))
    expect(at).toBeGreaterThan(0)
    expect(countCells(docLines[at])).toBe(3)
    // Escaped, not deleted: the statement still says `|| 0`.
    expect(docLines[at]).toContain('`\\|\\| 0`')

    // Unescape it again and the check fires at that line — this is the guard,
    // not the repair.
    const broken = [...docLines]
    broken[at] = broken[at].replace('`\\|\\| 0`', '`|| 0`')
    const hits = findRaggedRows(broken.join('\n')).filter((r) => r.kind === 'over')
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(at + 1)
  })

  it('pins the sitemap repair: a delimiter row that unmakes its own table', () => {
    // Neither a registry nor an appendix, and the reason the sweep is the whole
    // spec pack: an eight-column header over a seven-column delimiter, which
    // GFM does not recognize as a table at all.
    const nav = fs
      .readFileSync(path.join(ROOT, 'docs', 'SITEMAP-DOMAIN-NAV.md'), 'utf8')
      .replace(/\r\n/g, '\n')
    expect(findRaggedRows(nav).filter((r) => r.kind !== 'under')).toEqual([])
  })

  it('pins the API spec repair: an unescaped pipe in prose truncates a row too', () => {
    // Not a registry row and not inside a code span the author expected to
    // protect it — `view=overview|timeline|workspace` in the Project core table.
    const spec = fs
      .readFileSync(path.join(ROOT, 'docs', 'appendices', 'A-api-spec.md'), 'utf8')
      .replace(/\r\n/g, '\n')
    expect(findRaggedRows(spec).filter((r) => r.kind !== 'under')).toEqual([])
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

  it('pins the appendix repair: the API spec Scope table is one contiguous table', () => {
    // The sixth break, and the reason docs/appendices/ is swept. Two GET rows
    // were appended below the blank line that ended this table in August 2026
    // and rendered as literal pipe text until this check found them. If anyone
    // reintroduces the blank, this fails before CI does.
    const spec = fs.readFileSync(path.join(ROOT, 'docs', 'appendices', 'A-api-spec.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(findSplitTables(spec)).toEqual([])

    const specLines = spec.split('\n')
    const at = specLines.findIndex((l) => l.includes('`/api/business/strategy?businessId=`'))
    expect(at).toBeGreaterThan(0)
    // The row above it is a real table row of the same width — i.e. this row is
    // inside the table, not stranded under it.
    expect(isTableRow(specLines[at - 1])).toBe(true)
    expect(isSeparatorRow(specLines[at - 1])).toBe(false)
    expect(countCells(specLines[at - 1])).toBe(countCells(specLines[at]))
  })
})
