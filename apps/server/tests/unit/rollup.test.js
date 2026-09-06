import { describe, it, expect } from 'vitest'
import { rollupProject, rollupBusiness } from '@/modules/project-manager/progress/rollup'

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

// @req FR-020 — business/group cards on the multi-business landing.
describe('business roll-up', () => {
  it('weights each project by its own workstream weight', () => {
    const r = rollupBusiness([
      { percent: 100, totalWeight: 1 },
      { percent: 0, totalWeight: 3 },
    ])
    // (100×1 + 0×3) / 4 = 25 — the big project dominates, as it should.
    expect(r.percent).toBe(25)
  })

  it('equals one flat weighted average over every workstream in the business', () => {
    const p1 = rollupProject([
      { percent: 100, progressWeight: 1 },
      { percent: 50, progressWeight: 2 },
    ])
    const p2 = rollupProject([{ percent: 0, progressWeight: 1 }])
    const viaProjects = rollupBusiness([p1, p2]).percent
    const flat = rollupProject([
      { percent: 100, progressWeight: 1 },
      { percent: 50, progressWeight: 2 },
      { percent: 0, progressWeight: 1 },
    ]).percent
    expect(viaProjects).toBe(flat)
  })

  it('reports a business with no projects as 0% with a warning, not NaN', () => {
    const r = rollupBusiness([])
    expect(r.percent).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('handles projects that carry no weight at all', () => {
    const r = rollupBusiness([{ percent: 90, totalWeight: 0 }])
    expect(r.percent).toBe(0)
    expect(r.warnings.some((w) => w.includes('no workstream weight'))).toBe(true)
  })
})
