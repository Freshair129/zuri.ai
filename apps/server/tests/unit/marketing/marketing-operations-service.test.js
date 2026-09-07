import { describe, expect, it } from 'vitest'
import { sectionFor, operationsPagePath } from '@/modules/marketing/components/operations/operations-contract'

// @req FR-162 — UI helpers preserve explicit unavailable source state and
// addressable tab URLs.
// @spec SDD-089
// @tested tests/unit/marketing/marketing-operations-service.test.js

describe('Marketing Operations read helpers', () => {
  it('keeps an unavailable section distinct from an empty section', () => {
    expect(sectionFor(null, 'calendar').state).toBe('UNAVAILABLE')
    expect(sectionFor({ sections: { calendar: { state: 'EMPTY', rows: [] } } }, 'calendar').state).toBe('EMPTY')
    expect(operationsPagePath('handoffs', { q: 'stock' })).toBe('/growth/operations?tab=handoffs&q=stock')
  })
})
