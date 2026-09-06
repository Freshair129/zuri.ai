import { describe, expect, it } from 'vitest'
import { OPERATIONS_TABS, operationsCollectionPath, intakePagePath, handoffPagePath } from '@/modules/marketing/components/operations/operations-contract'

// @req FR-162 — Operations interface inventory is backed by one collection,
// one Intake form/detail and one handoff detail route.
// @spec SDD-089
// @tested tests/unit/marketing/marketing-operations-ui.test.js

describe('Marketing Operations UI contract', () => {
  it('keeps all four tabs URL-addressable without a nested tab layer', () => {
    expect(OPERATIONS_TABS).toHaveLength(4)
    expect(operationsCollectionPath('b-1', 'calendar')).toBe('/api/growth/operations?businessId=b-1&tab=calendar')
    expect(intakePagePath('i-1')).toBe('/growth/operations/intake/i-1')
    expect(handoffPagePath('h-1')).toBe('/growth/operations/handoffs/h-1')
  })
})
