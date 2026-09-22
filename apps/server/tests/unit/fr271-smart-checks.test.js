import { describe, it, expect } from 'vitest'
import { smartChecks } from '@/modules/project-manager/progress/smart-checks'

// @req FR-271
// @tested tests/unit/fr271-smart-checks.test.js

const goal = { title: 'Grow enterprise revenue', targetAt: '2026-12-31T00:00:00Z' }
const now = Date.parse('2026-09-22T00:00:00Z')

const base = {
  title: 'Close 12 enterprise deals',
  metric: 'Closed-won deals',
  unit: 'deals',
  baseline: 0,
  target: 12,
  dueAt: '2026-12-15T00:00:00Z',
}

describe('smartChecks', () => {
  it('passes every deterministic check on a well-formed input', () => {
    const r = smartChecks(base, goal, now)
    expect(r).toEqual({ specific: true, measurable: true, achievable: null, relevant: null, timeBound: true })
  })

  it('never fabricates Achievable or Relevant — always null', () => {
    const r = smartChecks(base, goal, now)
    expect(r.achievable).toBeNull()
    expect(r.relevant).toBeNull()
  })

  describe('specific', () => {
    it('fails on an empty title', () => {
      expect(smartChecks({ ...base, title: '  ' }, goal, now).specific).toBe(false)
    })
    it('fails when the title only repeats the goal title', () => {
      expect(smartChecks({ ...base, title: goal.title }, goal, now).specific).toBe(false)
      expect(smartChecks({ ...base, title: ' Grow Enterprise Revenue ' }, goal, now).specific).toBe(false)
    })
  })

  describe('measurable', () => {
    it('fails when metric or unit is missing', () => {
      expect(smartChecks({ ...base, metric: '' }, goal, now).measurable).toBe(false)
      expect(smartChecks({ ...base, unit: '' }, goal, now).measurable).toBe(false)
    })
    it('fails when baseline or target is not a number', () => {
      expect(smartChecks({ ...base, baseline: 'n/a' }, goal, now).measurable).toBe(false)
      expect(smartChecks({ ...base, target: undefined }, goal, now).measurable).toBe(false)
    })
    it('fails when target equals baseline', () => {
      expect(smartChecks({ ...base, baseline: 5, target: 5 }, goal, now).measurable).toBe(false)
    })
  })

  describe('timeBound', () => {
    it('fails with no due date', () => {
      expect(smartChecks({ ...base, dueAt: null }, goal, now).timeBound).toBe(false)
    })
    it('fails with a due date already in the past', () => {
      expect(smartChecks({ ...base, dueAt: '2026-01-01T00:00:00Z' }, goal, now).timeBound).toBe(false)
    })
    it('fails with a due date past the goal\'s own target date', () => {
      expect(smartChecks({ ...base, dueAt: '2027-06-01T00:00:00Z' }, goal, now).timeBound).toBe(false)
    })
    it('passes with no goal target date at all — nothing to exceed', () => {
      const r = smartChecks(base, { ...goal, targetAt: null }, now)
      expect(r.timeBound).toBe(true)
    })
  })
})
