import { describe, it, expect } from 'vitest'
import {
  keyResultProgress,
  expectedProgress,
  keyResultStatus,
  KEY_RESULT_STATUS,
} from '@/modules/project-manager/progress/key-result-progress'

// @req FR-268, SDD-107
// @tested tests/unit/fr268-key-result-progress.test.js

describe('keyResultProgress', () => {
  it('computes UP direction as a share of the baseline-to-target span', () => {
    expect(keyResultProgress({ baseline: 0, target: 20, direction: 'UP' }, 5)).toBe(25)
    expect(keyResultProgress({ baseline: 0, target: 20, direction: 'UP' }, 20)).toBe(100)
    expect(keyResultProgress({ baseline: 0, target: 20, direction: 'UP' }, 0)).toBe(0)
  })

  it('computes DOWN direction as a share reclaimed from the baseline', () => {
    // churn 10% -> 2%: at 6% you are halfway there
    expect(keyResultProgress({ baseline: 10, target: 2, direction: 'DOWN' }, 6)).toBe(50)
    expect(keyResultProgress({ baseline: 10, target: 2, direction: 'DOWN' }, 2)).toBe(100)
    expect(keyResultProgress({ baseline: 10, target: 2, direction: 'DOWN' }, 10)).toBe(0)
  })

  it('clamps beyond the target instead of exceeding 100 or going negative', () => {
    expect(keyResultProgress({ baseline: 0, target: 20, direction: 'UP' }, 40)).toBe(100)
    expect(keyResultProgress({ baseline: 0, target: 20, direction: 'UP' }, -10)).toBe(0)
  })

  it('treats a flat baseline===target defensively rather than dividing by zero', () => {
    expect(keyResultProgress({ baseline: 5, target: 5, direction: 'UP' }, 5)).toBe(100)
    expect(keyResultProgress({ baseline: 5, target: 5, direction: 'UP' }, 3)).toBe(0)
  })

  it('returns 0 for non-numeric input rather than NaN', () => {
    expect(keyResultProgress({ baseline: 0, target: 10, direction: 'UP' }, undefined)).toBe(0)
    expect(keyResultProgress({ baseline: 0, target: 10, direction: 'UP' }, 'not a number')).toBe(0)
  })
})

describe('expectedProgress', () => {
  const start = '2026-09-01T00:00:00Z'
  const due = '2026-09-11T00:00:00Z' // 10-day window

  it('is null with no due date on the Key Result or its goal — never a fabricated 0 or 100', () => {
    expect(expectedProgress({ startAt: start, dueAt: null }, Date.parse(start))).toBeNull()
  })

  it('is proportional to elapsed time within [startAt, dueAt]', () => {
    const twoDaysIn = Date.parse('2026-09-03T00:00:00Z')
    expect(expectedProgress({ startAt: start, dueAt: due }, twoDaysIn)).toBe(20)
  })

  it('is 0 before startAt and 100 at/after dueAt', () => {
    expect(expectedProgress({ startAt: start, dueAt: due }, Date.parse('2026-08-20T00:00:00Z'))).toBe(0)
    expect(expectedProgress({ startAt: start, dueAt: due }, Date.parse('2026-09-11T00:00:00Z'))).toBe(100)
    expect(expectedProgress({ startAt: start, dueAt: due }, Date.parse('2026-10-01T00:00:00Z'))).toBe(100)
  })

  it('falls back to due-only (0 before due, 100 at/after) when no startAt is given', () => {
    expect(expectedProgress({ startAt: null, dueAt: due }, Date.parse('2026-09-05T00:00:00Z'))).toBe(0)
    expect(expectedProgress({ startAt: null, dueAt: due }, Date.parse(due))).toBe(100)
  })
})

describe('keyResultStatus', () => {
  it('is OK when progress is within the OK gap of expected', () => {
    expect(keyResultStatus(50, 55, 4)).toBe(KEY_RESULT_STATUS.OK)
  })

  it('is WARN when the gap exceeds the OK threshold but not the WARN threshold', () => {
    expect(keyResultStatus(30, 55, 4)).toBe(KEY_RESULT_STATUS.WARN)
  })

  it('is BAD when the gap exceeds the WARN threshold', () => {
    expect(keyResultStatus(0, 55, 4)).toBe(KEY_RESULT_STATUS.BAD)
  })

  it('low confidence (<=2) bumps an otherwise-OK status to WARN', () => {
    expect(keyResultStatus(55, 55, 2)).toBe(KEY_RESULT_STATUS.WARN)
  })

  it('critical confidence (<=1) forces BAD regardless of the numbers', () => {
    expect(keyResultStatus(100, 50, 1)).toBe(KEY_RESULT_STATUS.BAD)
  })

  it('with no expected value, decides from confidence alone rather than defaulting to OK', () => {
    expect(keyResultStatus(10, null, 4)).toBe(KEY_RESULT_STATUS.OK)
    expect(keyResultStatus(10, null, 2)).toBe(KEY_RESULT_STATUS.WARN)
  })
})
