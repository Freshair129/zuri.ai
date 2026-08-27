import { describe, it, expect } from 'vitest'
import { evidencePath, candidatePaths, findBrokenEvidence } from '../../scripts/roadmap-evidence.mjs'

// @spec scripts/roadmap-evidence.mjs — preflight Check 13 (roadmap-evidence)
//
// docs/roadmap/ROADMAP.md declares itself `source_of_truth: true` and
// `live_document: true`, and GoVibe Mission Control reads it directly. Its
// `Source Section` column is the only pointer a reader has from a delivery claim
// to the artefact backing it. On 2026-08-27 a row was given a path to a feature
// note that existed only in another branch, and the entire governance chain
// reported `dangling 0` and PASS — the broken-link check above it matches
// markdown links, and these cells are bare paths. This file is the regression.
//
// EVERY ID AND PATH BELOW IS SYNTHETIC, for the reason given at length in
// tests/unit/id-anchor-stability.test.js: scripts/doc-graph.mjs turns any
// requirement-id-shaped token appearing in a test file into a `verifies` edge, so
// quoting real rows as fixture data would credit this test, in TRACE.md and
// Appendix D, as the test for requirements it does not exercise. Fixtures here
// use a `QQ-` family that no registry declares.

const table = (rows, { heading = '## Backlog Items', columns = ['ID', 'Status', 'Source Section'] } = {}) =>
  [
    heading,
    '',
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
  ].join('\n')

const row = (id, source, { status = 'done' } = {}) => `| ${id} | ${status} | ${source} |`

describe('evidencePath — which cells claim a location at all', () => {
  it('ignores registry references, which name an id or a section rather than a file', () => {
    for (const ref of ['PRD-SDD 1.3', 'PRD-SDD QQ-001', 'ADR-024', 'ADR-017; ADR-045', 'ZURI-INTEGRATION-ASSESSMENT']) {
      expect(evidencePath(ref)).toBeNull()
    }
  })

  it('ignores an empty or placeholder cell', () => {
    expect(evidencePath('')).toBeNull()
    expect(evidencePath('   ')).toBeNull()
    expect(evidencePath('-')).toBeNull()
  })

  it('treats anything containing a slash as a location claim', () => {
    expect(evidencePath('../domains/sample/features/QQ-001-note.md')).toBe('../domains/sample/features/QQ-001-note.md')
    expect(evidencePath('  changes/QQ-CR-001-note.md  ')).toBe('changes/QQ-CR-001-note.md')
  })

  it('strips a trailing annotation but still reads the path underneath it', () => {
    expect(evidencePath('../domains/sample/features/QQ-001 (PRD row)')).toBe('../domains/sample/features/QQ-001')
  })

  it('takes the href out of a markdown link', () => {
    expect(evidencePath('[the note](../domains/sample/features/QQ-001-note.md)')).toBe(
      '../domains/sample/features/QQ-001-note.md'
    )
  })
})

describe('candidatePaths — where a reference is allowed to resolve from', () => {
  it('tries the roadmap directory and docs/, because the column genuinely mixes both', () => {
    expect(candidatePaths('../domains/sample/note.md')).toContain('docs/domains/sample/note.md')
    expect(candidatePaths('changes/note.md')).toContain('docs/changes/note.md')
    expect(candidatePaths('changes/note.md')).toContain('docs/roadmap/changes/note.md')
  })

  it('accepts a missing .md, because several real cells omit it', () => {
    expect(candidatePaths('../domains/sample/note')).toContain('docs/domains/sample/note.md')
  })

  it('never probes a path that walks out of the repository', () => {
    for (const candidate of candidatePaths('../../../../etc/passwd')) {
      expect(candidate.startsWith('..')).toBe(false)
    }
  })
})

describe('findBrokenEvidence', () => {
  const withFiles = (...paths) => {
    const present = new Set(paths)
    return (p) => present.has(p)
  }

  it('passes a row whose reference resolves relative to the roadmap directory', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([row('TASK-QQ-001', '../domains/sample/features/QQ-001-note.md')]),
      exists: withFiles('docs/domains/sample/features/QQ-001-note.md'),
    })
    expect(broken).toEqual([])
  })

  it('passes a row whose reference resolves relative to docs/ instead', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([row('TASK-QQ-002', 'changes/QQ-CR-001-note.md')]),
      exists: withFiles('docs/changes/QQ-CR-001-note.md'),
    })
    expect(broken).toEqual([])
  })

  it('reports a reference that resolves from neither base — the 2026-08-27 case', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([row('TASK-QQ-003', '../domains/sample/features/QQ-003-absent.md')]),
      exists: withFiles(),
    })
    expect(broken).toEqual(['TASK-QQ-003::../domains/sample/features/QQ-003-absent.md'])
  })

  it('checks every reference in a multi-reference cell, not just the first', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([
        row('TASK-QQ-004', '../domains/sample/features/QQ-004-here.md; ../domains/sample/features/QQ-004-gone.md'),
      ]),
      exists: withFiles('docs/domains/sample/features/QQ-004-here.md'),
    })
    expect(broken).toEqual(['TASK-QQ-004::../domains/sample/features/QQ-004-gone.md'])
  })

  it('lets a registry reference stand alongside a path without being probed', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([row('TASK-QQ-005', 'ADR-024; ../domains/sample/features/QQ-005-note.md')]),
      exists: withFiles('docs/domains/sample/features/QQ-005-note.md'),
    })
    expect(broken).toEqual([])
  })

  // The laundering case. If a trailing parenthetical exempted a cell from the
  // check, every broken pointer in this file could be silenced by typing five
  // characters after it, and the check would be worth nothing.
  it('does not let a trailing annotation exempt a path that resolves to nothing', () => {
    const { broken } = findBrokenEvidence({
      roadmapText: table([row('TASK-QQ-006', '../domains/sample/features/QQ-006 (PRD row)')]),
      exists: withFiles(),
    })
    expect(broken).toEqual(['TASK-QQ-006::../domains/sample/features/QQ-006'])
  })

  it('finds the column by its header, so inserting a column ahead of it cannot mislead the check', () => {
    const roadmapText = [
      '## Backlog Items',
      '',
      '| ID | Owner | Source Section | Notes |',
      '| --- | --- | --- | --- |',
      '| TASK-QQ-007 | Someone | ../domains/sample/features/QQ-007-absent.md | free text |',
      '',
    ].join('\n')
    const { broken } = findBrokenEvidence({ roadmapText, exists: withFiles() })
    expect(broken).toEqual(['TASK-QQ-007::../domains/sample/features/QQ-007-absent.md'])
  })

  it('reads only the backlog table, stopping where it ends', () => {
    const roadmapText = `${table([row('TASK-QQ-008', '../domains/sample/features/QQ-008-note.md')])}
## Something else

| ID | Status | Source Section |
| --- | --- | --- |
| TASK-QQ-009 | done | ../domains/sample/features/QQ-009-absent.md |
`
    const { broken } = findBrokenEvidence({
      roadmapText,
      exists: withFiles('docs/domains/sample/features/QQ-008-note.md'),
    })
    expect(broken).toEqual([])
  })

  // A check whose input has moved must say so. Reporting a clean pass because it
  // could not find the table is the same failure it exists to prevent.
  it('reports the table having gone missing rather than passing silently', () => {
    const { broken, structural } = findBrokenEvidence({
      roadmapText: '# ROADMAP\n\nno table here\n',
      exists: withFiles(),
    })
    expect(broken).toEqual([])
    expect(structural).toHaveLength(1)
    expect(structural[0].title).toMatch(/not found/i)
  })

  it('reports the Source Section column having gone missing rather than passing silently', () => {
    const roadmapText = table([`| TASK-QQ-010 | done | something |`], { columns: ['ID', 'Status', 'Evidence'] })
    const { broken, structural } = findBrokenEvidence({ roadmapText, exists: withFiles() })
    expect(broken).toEqual([])
    expect(structural).toHaveLength(1)
    expect(structural[0].title).toMatch(/no Source Section column/i)
  })
})
