import { describe, expect, it } from 'vitest'
import {
  resolveReportWindow, bangkokDate, parseIsoDate, enumerateDays, MAX_WINDOW_DAYS, ReportWindowError,
} from '@/modules/marketing/insights/domain/report-window'

// 2026-09-24 01:30 in Bangkok is still 2026-09-23 in UTC.
const NOW = new Date('2026-09-23T18:30:00.000Z')

describe('report window', () => {
  it('uses the Asia/Bangkok calendar day, not the container timezone', () => {
    expect(bangkokDate(NOW)).toBe('2026-09-24')
    expect(bangkokDate('2026-09-23T16:59:59.000Z')).toBe('2026-09-23')
    expect(bangkokDate('2026-09-23T17:00:00.000Z')).toBe('2026-09-24')
  })

  it('defaults to the 28 complete days ending yesterday, with a 28-day comparison', () => {
    const window = resolveReportWindow({}, { now: NOW })
    expect(window).toMatchObject({
      from: '2026-08-27', to: '2026-09-23', days: 28, includesPartialDay: false, inclusive: 'BOTH',
      previous: { from: '2026-07-30', to: '2026-08-26', days: 28 },
    })
    expect(enumerateDays(window.previous.from, window.to)).toHaveLength(56)
  })

  it('treats both ends as inclusive and flags today as partial', () => {
    const window = resolveReportWindow({ from: '2026-09-24', to: '2026-09-24' }, { now: NOW })
    expect(window).toMatchObject({ days: 1, includesPartialDay: true, previous: { from: '2026-09-23', to: '2026-09-23' } })
  })

  it('refuses malformed, impossible, reversed, future and oversized windows', () => {
    const bad = [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026/09/01', to: '2026-09-02' },
      { from: '2026-09-10', to: '2026-09-01' },
      { from: '2026-09-20', to: '2026-09-25' },
      { from: '2026-09-01' },
      { from: '2026-01-01', to: '2026-09-01' },
    ]
    for (const input of bad) {
      expect(() => resolveReportWindow(input, { now: NOW }), JSON.stringify(input)).toThrow(ReportWindowError)
    }
    const widest = resolveReportWindow({ from: '2026-06-23', to: '2026-09-23' }, { now: NOW })
    expect(widest.days).toBe(MAX_WINDOW_DAYS)
  })

  it('parses only real calendar dates', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull()
    expect(parseIsoDate('2026-02-29')).toBeNull()
    expect(parseIsoDate('2026-9-1')).toBeNull()
  })
})
