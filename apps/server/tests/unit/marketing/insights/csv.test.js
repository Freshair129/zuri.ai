import { describe, expect, it } from 'vitest'
import { csvTextCell, csvNumberCell, toCsv, metricSeriesCsv, exportFilename } from '@/modules/marketing/insights/domain/csv'

describe('insights CSV', () => {
  it('quotes commas, quotes and newlines per RFC 4180 and keeps Thai text intact', () => {
    expect(csvTextCell('a,b')).toBe('"a,b"')
    expect(csvTextCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvTextCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvTextCell('ยอดการมองเห็น')).toBe('ยอดการมองเห็น')
  })

  it('neutralises spreadsheet formulas in text cells only', () => {
    expect(csvTextCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvTextCell('+1')).toBe("'+1")
    expect(csvTextCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvNumberCell(-5)).toBe('-5')
    expect(csvNumberCell(0)).toBe('0')
    expect(csvNumberCell(null)).toBe('')
    expect(() => csvNumberCell(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('starts with a BOM and uses CRLF', () => {
    const text = toCsv([{ key: 'a', kind: 'text' }], [{ a: 'x' }])
    expect(text).toBe('﻿a\r\nx\r\n')
  })

  it('writes the chart points value for value; empty means no value, not zero', () => {
    const text = metricSeriesCsv([
      { date: '2026-09-01', organic: 7, paid: 3, value: 10, quality: 'OBSERVED', unit: 'count' },
      { date: '2026-09-02', organic: null, paid: null, value: null, quality: 'NOT_SYNCED', unit: null },
    ])
    expect(text.split('\r\n')).toEqual([
      '﻿date,organic,paid,total,quality,unit',
      '2026-09-01,7,3,10,OBSERVED,count',
      '2026-09-02,,,,NOT_SYNCED,',
      '',
    ])
  })

  it('builds filenames only from safe tokens', () => {
    expect(exportFilename({ brand: '056laos', metricKey: 'views', from: '2026-09-01', to: '2026-09-28' }))
      .toBe('insights-056laos-views-2026-09-01-2026-09-28.csv')
    expect(exportFilename({ brand: '../x', metricKey: 'a"b', from: '1', to: '2' })).toBe('insights-x-ab-1-2.csv')
  })
})
