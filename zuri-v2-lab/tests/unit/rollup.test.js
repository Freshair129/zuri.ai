import { describe, it, expect } from 'vitest'
import { rollupProject } from '@/modules/project-manager/progress/rollup'

describe('project weighted roll-up', () => {
  it('computes Σ(progress × weight) / Σ(weight)', () => {
    const r = rollupProject([
      { percent: 100, progressWeight: 1 },
      { percent: 50, progressWeight: 2 },
      { percent: 0, progressWeight: 1 },
    ])
    // (100 + 100 + 0) / 4 = 50
    expect(r.percent).toBe(50)
  })

  it('handles empty workstream list', () => {
    const r = rollupProject([])
    expect(r.percent).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('handles zero total weight', () => {
    const r = rollupProject([{ percent: 80, progressWeight: 0 }])
    expect(r.percent).toBe(0)
    expect(r.warnings.some((w) => w.includes('weights sum to 0'))).toBe(true)
  })

  it('is deterministic', () => {
    const input = [
      { percent: 33.3, progressWeight: 1.2 },
      { percent: 66.6, progressWeight: 1.5 },
    ]
    expect(rollupProject(input).percent).toBe(rollupProject(input).percent)
  })
})
