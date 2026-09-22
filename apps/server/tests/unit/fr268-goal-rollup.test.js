import { describe, it, expect } from 'vitest'
import { rollupGoal } from '@/modules/project-manager/progress/goal-rollup'

// @req SDD-107, BR-044
// @tested tests/unit/fr268-goal-rollup.test.js

describe('rollupGoal', () => {
  it('is the unweighted mean of Key Result progress', () => {
    expect(rollupGoal([100, 50, 0]).percent).toBe(50)
    expect(rollupGoal([80, 60]).percent).toBe(70)
  })

  it('is 0 with a warning, never null, for an empty list', () => {
    const r = rollupGoal([])
    expect(r.percent).toBe(0)
    expect(r.count).toBe(0)
    expect(r.warnings[0]).toMatch(/no key results/i)
  })

  it('ignores non-finite entries rather than propagating NaN', () => {
    expect(rollupGoal([100, NaN, undefined, 50]).percent).toBe(75)
  })

  it('names its formula in the result', () => {
    expect(rollupGoal([100]).formula).toMatch(/mean/i)
  })
})
