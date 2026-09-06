import { describe, expect, it } from 'vitest'
import { taskWeight, milestoneReadiness, clampPercent } from '@/modules/project-manager/progress/strategies'

// @req FR-010 — an open required gate caps reported progress below 100.
// @spec BR-006, .brain/reviews/pm-r2-progress.md F1
// @tested tests/unit/gate-cap-rounding.test.js
//
// The defect: the cap tested the RAW percent while the screen showed the
// ROUNDED one. `clampPercent` rounds to one decimal, so any raw value in
// [99.95, 100) failed `>= 100`, took no cap and no warning, and then rendered as
// **100.0%** with a required gate still open — the exact statement BR-006 exists
// to prevent, and the one the file's own header claims it makes.
//
// The check and the display disagreed about what "100" means. Same family as
// `role` meaning one thing to the resolver and another to its callers.

/** 2499 of 2500 weight complete → 99.96%, which rounds to 100.0. */
function almostComplete() {
  const items = [
    { status: 'DONE', weight: 2499 },
    { status: 'IN_PROGRESS', weight: 1 },
  ]
  return items
}

describe('the rounding window the cap used to miss', () => {
  it('rounds to 100.0 without the cap — the premise of the bug', () => {
    expect(clampPercent((2499 / 2500) * 100)).toBe(100)
  })

  it('never reports 100 while a required gate is open', () => {
    const result = taskWeight({
      items: almostComplete(),
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(result.percent).toBeLessThan(100)
  })

  it('says why, rather than silently shaving the number', () => {
    const result = taskWeight({
      items: almostComplete(),
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(result.warnings.join(' ')).toMatch(/gate/i)
  })

  it('applies the same rule to milestone readiness', () => {
    const result = milestoneReadiness({
      milestones: [
        { status: 'DONE', weight: 2499 },
        { status: 'PLANNED', weight: 1 },
      ],
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(result.percent).toBeLessThan(100)
    expect(result.warnings.join(' ')).toMatch(/gate/i)
  })
})

describe('what must not change', () => {
  it('still reports 100 when every required gate is satisfied', () => {
    const result = taskWeight({
      items: [{ status: 'DONE', weight: 10 }],
      gates: [{ required: true, status: 'PASSED' }],
    })
    expect(result.percent).toBe(100)
  })

  it('leaves a genuinely mid-flight number alone', () => {
    const result = taskWeight({
      items: [{ status: 'DONE', weight: 1 }, { status: 'PLANNED', weight: 1 }],
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(result.percent).toBe(50)
    expect(result.warnings.join(' ')).not.toMatch(/capped/i)
  })

  it('ignores gates that are not required', () => {
    const result = taskWeight({
      items: [{ status: 'DONE', weight: 10 }],
      gates: [{ required: false, status: 'OPEN' }],
    })
    expect(result.percent).toBe(100)
  })
})
