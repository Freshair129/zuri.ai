import { describe, it, expect } from 'vitest'
import { claimedRequirements, findUncoveredRequirements } from '../../scripts/roadmap-coverage.mjs'

// @spec scripts/roadmap-coverage.mjs — preflight Check 14 (roadmap-coverage)
//
// On 2026-08-28 three delivered requirements were found with no row in
// docs/roadmap/ROADMAP.md — the file that declares itself source_of_truth and
// that Mission Control reads. Nothing caught it, including the evidence check
// added to that same table days earlier: a check over the rows that exist can
// never see the row that does not. This file is the regression for the check
// that starts from the other side.
//
// EVERY ID BELOW IS ASSEMBLED AT RUNTIME AND NEVER SPELLED, for the reason set
// out at length in tests/unit/id-anchor-stability.test.js: scripts/doc-graph.mjs
// turns any requirement-id-shaped token appearing in a test file into a
// `verifies` edge, so writing ids literally as fixture data would credit this
// test, in TRACE.md and Appendix D, as the test for requirements it does not
// exercise. `req()` builds them; the source text contains no such token.

const req = (n) => `FR-${String(n).padStart(3, '0')}`

const HEADER = '| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |'
const RULE = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'

const row = ({ id = 'TASK-SAMPLE', title = 'a title', deps = '-', source = '-' }) =>
  `| ${id} | PHASE-SAMPLE | task | ${title} | P1 | Someone | done | ${deps} | ${source} |`

const roadmap = (rows, { heading = '## Backlog Items', header = HEADER } = {}) =>
  [heading, '', header, RULE, ...rows, ''].join('\n')

describe('claimedRequirements — what counts as a row owning a requirement', () => {
  it('reads an id out of the row id itself', () => {
    const claimed = claimedRequirements(roadmap([row({ id: `TASK-${req(901)}`, title: 'anything' })]))
    expect(claimed.has(req(901))).toBe(true)
  })

  it('reads ids named in the title', () => {
    const claimed = claimedRequirements(roadmap([row({ title: `Two things (${req(902)}) and (${req(903)})` })]))
    expect(claimed.has(req(902))).toBe(true)
    expect(claimed.has(req(903))).toBe(true)
  })

  // The central case. Roadmap rows cite ranges as often as single ids, and a
  // literal-token scan sees only the endpoints. Without this, 22 of 32 findings
  // on main were requirements that are covered perfectly well.
  it('expands a range, not just its endpoints', () => {
    const claimed = claimedRequirements(roadmap([row({ title: `Core work (${req(901)}..${req(905).slice(3)})` })]))
    for (const n of [901, 902, 903, 904, 905]) expect(claimed.has(req(n))).toBe(true)
  })

  it('treats a descending or absurd range as a typo covering nothing', () => {
    const descending = claimedRequirements(roadmap([row({ title: `bad (${req(905)}..${req(901).slice(3)})` })]))
    expect(descending.has(req(903))).toBe(false)
    const absurd = claimedRequirements(roadmap([row({ title: `bad (${req(1)}..999)` })]))
    expect(absurd.has(req(500))).toBe(false)
  })

  // The regression that a break-test exposed and review would not have. The
  // first draft scanned the whole row, so deleting a row changed nothing when
  // the id also appeared as somebody else's dependency. Being cited as a
  // dependency is not being accounted for — it is a mention that survives
  // precisely because nobody owns the thing.
  it('does NOT count a Dependencies cell as ownership', () => {
    const claimed = claimedRequirements(roadmap([row({ title: 'unrelated', deps: `${req(904)}; ADR-050` })]))
    expect(claimed.has(req(904))).toBe(false)
  })

  it('does NOT count a Source Section cell as ownership', () => {
    const claimed = claimedRequirements(roadmap([row({ title: 'unrelated', source: `PRD-SDD ${req(906)}` })]))
    expect(claimed.has(req(906))).toBe(false)
  })

  it('does NOT count a Phases-table goal as ownership', () => {
    const text = [
      '## Phases',
      '',
      '| Phase | Goal | Exit Criteria | Status | Progress |',
      '| --- | --- | --- | --- | --- |',
      `| PHASE-SAMPLE | delivers ${req(907)} among other things | criteria | in-progress | 40 |`,
      '',
      roadmap([row({ title: 'something else' })]),
    ].join('\n')
    expect(claimedRequirements(text).has(req(907))).toBe(false)
  })

  it('stops at the end of the backlog table', () => {
    const text = `${roadmap([row({ title: 'in the table' })])}
## Something else

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-OTHER | PHASE-X | task | claims ${req(908)} | P1 | Someone | done | - | - |
`
    expect(claimedRequirements(text).has(req(908))).toBe(false)
  })

  // A check that cannot find its input must not report a clean pass. Returning
  // no claims makes every delivered requirement surface as uncovered, which is
  // loud — the opposite failure, silence, is the one this whole check exists to
  // correct.
  it('claims nothing when the backlog table is missing', () => {
    expect(claimedRequirements('# ROADMAP\n\nno table\n').size).toBe(0)
  })

  it('claims nothing when the table has no ID or Title column', () => {
    const header = '| Key | Parent ID | Type | Summary | Priority | Owner | Status | Dependencies | Source Section |'
    const text = roadmap([row({ id: `TASK-${req(909)}`, title: `names ${req(909)}` })], { header })
    expect(claimedRequirements(text).size).toBe(0)
  })
})

describe('findUncoveredRequirements', () => {
  it('reports a delivered requirement that no row owns', () => {
    const text = roadmap([row({ id: `TASK-${req(901)}`, title: `does a thing (${req(901)})` })])
    expect(findUncoveredRequirements({ roadmapText: text, delivered: [req(901), req(902)] })).toEqual([req(902)])
  })

  it('reports nothing when every delivered requirement is owned, including through a range', () => {
    const text = roadmap([row({ title: `Core (${req(901)}..${req(903).slice(3)})` })])
    expect(findUncoveredRequirements({ roadmapText: text, delivered: [req(901), req(902), req(903)] })).toEqual([])
  })

  it('does not report a requirement that has not been delivered, however absent its row', () => {
    const text = roadmap([row({ title: 'nothing relevant' })])
    expect(findUncoveredRequirements({ roadmapText: text, delivered: [] })).toEqual([])
  })

  it('returns ids sorted, so the finding and the baseline can be compared directly', () => {
    const text = roadmap([row({ title: 'nothing relevant' })])
    const delivered = [req(905), req(901), req(903)]
    expect(findUncoveredRequirements({ roadmapText: text, delivered })).toEqual([req(901), req(903), req(905)])
  })
})
