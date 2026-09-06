import { describe, expect, it } from 'vitest'
import { formatProgressPercent } from '@/modules/project-manager/progress/strategies'

// @req FR-010 — a progress percent renders identically everywhere it appears.
// @spec BR-005, BR-006, SDD-005
// @tested tests/unit/format-progress-percent.test.js
//
// The defect: PRJ-B01-TRANSFORM's progress (58.3%, one underlying number) read
// "58%" on the /projects Dashboard list (`Math.round(...)%`) and "58.3%" on
// the Project page and `/overview` (the raw value, uninterpolated), three
// render sites apart, none of them wrong on their own terms and all three
// disagreeing. `formatProgressPercent` is the one place that decision gets
// made now, so every render site shows the same digits for the same number.

describe('formatProgressPercent', () => {
  it('renders a fractional percent with one decimal place', () => {
    expect(formatProgressPercent(58.3)).toBe('58.3%')
  })

  it('does not round away the fraction the way Math.round(...) did', () => {
    // The exact regression: a Dashboard-style caller used to do
    // `${Math.round(percent)}%`, silently turning 58.3 into "58%".
    expect(formatProgressPercent(58.3)).not.toBe(`${Math.round(58.3)}%`)
  })

  it('renders a whole-number percent with no trailing .0', () => {
    expect(formatProgressPercent(100)).toBe('100%')
    expect(formatProgressPercent(0)).toBe('0%')
    expect(formatProgressPercent(50)).toBe('50%')
  })

  it('clamps and rounds to one decimal first, same as clampPercent', () => {
    expect(formatProgressPercent(99.96)).toBe('100%')
    expect(formatProgressPercent(-5)).toBe('0%')
    expect(formatProgressPercent(150)).toBe('100%')
  })

  it('treats non-finite input as 0, same as clampPercent', () => {
    expect(formatProgressPercent(NaN)).toBe('0%')
    expect(formatProgressPercent(undefined)).toBe('0%')
  })

  it('never returns more than one decimal digit', () => {
    expect(formatProgressPercent(33.333333)).toBe('33.3%')
  })
})
