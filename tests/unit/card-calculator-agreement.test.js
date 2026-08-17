import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { activeItems, weightedPipeline, slaScore } from '@/modules/project-manager/progress/strategies'

// @req FR-009 — an execution-mode card and its calculator report the same figure.
// @spec BR-005, .brain/reviews/pm-r2-progress.md F2/F3
// @tested tests/unit/card-calculator-agreement.test.js
//
// CLAUDE.md: "Never report a number a page would disagree with."
//
// The cards and the calculators shared a formula but not a population. The
// calculators reduce over `activeItems`, which drops CANCELLED and deleted rows;
// the cards reduced over the raw list. One cancelled deal was enough to put
// 157,000 on the tile and 125,000 in the Explain panel of the same screen.
//
// A shared formula is not agreement. Both sides must also agree on what they are
// summing over — which is why `activeItems` is exported and both now call it.

const source = (p) => readFileSync(p, 'utf8')
const modes = source('src/modules/project-manager/views/execution/mode-bodies.jsx')

const DEALS = [
  { subtype: 'DEAL', status: 'DONE', numericValue: 125000, probability: 1, metrics: {} },
  { subtype: 'DEAL', status: 'CANCELLED', numericValue: 32000, probability: 1, metrics: {} },
]

describe('the population is shared, not just the formula', () => {
  it('drops a cancelled row', () => {
    expect(activeItems(DEALS)).toHaveLength(1)
    expect(activeItems(DEALS)[0].status).toBe('DONE')
  })

  it('drops a soft-deleted row', () => {
    const withDeleted = [...DEALS, { subtype: 'DEAL', status: 'DONE', numericValue: 9, deletedAt: new Date(), metrics: {} }]
    expect(activeItems(withDeleted)).toHaveLength(1)
  })

  it('the calculator never counts the cancelled deal', () => {
    const result = weightedPipeline({ items: DEALS })
    const evidence = JSON.stringify(result.evidence)
    expect(evidence).not.toContain('157000')
    expect(evidence).toContain('125000')
  })

  it('the cards reduce over the same population the calculators do', () => {
    // Source assertions: the components are client modules whose totals are
    // computed inline. What must not regress is which list they start from.
    expect(modes).toContain("from '../../progress/strategies'")
    expect(modes).toContain('activeItems(workstream.items)')
    // The raw-list reductions that produced the disagreement.
    expect(modes).not.toContain('workstream.items.reduce')
    expect(modes).not.toMatch(/const deals = workstream\.items\.filter/)
  })
})

describe('the SLA card and slaScore agree on their population too', () => {
  it('excludes a cancelled operations item from the calculator', () => {
    const items = [
      { status: 'DONE', metrics: { slaMet: 9, slaTotal: 10 } },
      { status: 'CANCELLED', metrics: { slaMet: 0, slaTotal: 10 } },
    ]
    expect(activeItems(items)).toHaveLength(1)
    const result = slaScore({ items })
    // Pin the population, not the composite formula. `slaScore` is the mean of
    // its available signals, so asserting a headline percentage would pin a
    // formula this test has no business owning — and would break the day a
    // signal is added. What must hold is that the cancelled row contributed
    // nothing: 10 SLA opportunities, not 20.
    expect(result.evidence.itemCount).toBe(1)
    expect(result.evidence.slaTotal).toBe(10)
    expect(result.evidence.slaMet).toBe(9)
  })
})
