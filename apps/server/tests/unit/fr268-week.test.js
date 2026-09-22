import { describe, it, expect } from 'vitest'
import { weekStartFor } from '@/modules/project-manager/progress/week'

// @req FR-268, ADR-101 D1
// @tested tests/unit/fr268-week.test.js
//
// Every expected ISO string here is UTC-7 from the Bangkok wall-clock Monday
// 00:00 it names — Bangkok never observes DST, so this offset is exact, not
// approximate. Values were cross-checked by direct computation, not by hand,
// since UTC+7 arithmetic is exactly the kind of by-one-day slip a reviewer
// should not have to re-derive from prose.

describe('weekStartFor', () => {
  it('returns Monday 00:00 Bangkok, expressed as the equivalent UTC instant', () => {
    // 2026-09-24T10:30:00Z is 2026-09-24 17:30 Bangkok (Thursday); that week's
    // Monday 00:00 Bangkok is 2026-09-21 00:00, i.e. 2026-09-20T17:00:00Z.
    expect(weekStartFor(Date.parse('2026-09-24T10:30:00Z')).toISOString()).toBe('2026-09-20T17:00:00.000Z')
  })

  it('is idempotent on a timestamp that is already the week start', () => {
    const monday = weekStartFor(Date.parse('2026-09-24T10:30:00Z'))
    expect(weekStartFor(monday).getTime()).toBe(monday.getTime())
  })

  it('rolls a Bangkok-Sunday back to the Monday that started its own week', () => {
    // 2026-09-27T10:00:00Z is 2026-09-27 17:00 Bangkok (Sunday) — same week as the case above.
    expect(weekStartFor(Date.parse('2026-09-27T10:00:00Z')).toISOString()).toBe('2026-09-20T17:00:00.000Z')
  })

  it('crosses a month/year boundary correctly', () => {
    // 2027-01-01T05:00:00Z is 2027-01-01 12:00 Bangkok (Friday); its Monday is 2026-12-28.
    expect(weekStartFor(Date.parse('2027-01-01T05:00:00Z')).toISOString()).toBe('2026-12-27T17:00:00.000Z')
  })

  it('is exact at the Bangkok-midnight-Monday boundary, on both sides', () => {
    // 2026-09-20T17:00:00Z is exactly 2026-09-21 00:00 Bangkok (Monday) — maps to itself.
    expect(weekStartFor(Date.parse('2026-09-20T17:00:00Z')).toISOString()).toBe('2026-09-20T17:00:00.000Z')
    // One second earlier is 2026-09-20 23:59:59 Bangkok (Sunday) — the PRIOR week.
    expect(weekStartFor(Date.parse('2026-09-20T16:59:59Z')).toISOString()).toBe('2026-09-13T17:00:00.000Z')
  })
})
