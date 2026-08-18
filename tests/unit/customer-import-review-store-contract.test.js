import { describe, expect, it } from 'vitest'

import {
  mapTargetCustomer,
  nextDecisionVersion,
} from '@/modules/crm/customer-import-review-store'

// @req FR-078 — the production customer review adapter preserves decision
// versions and maps PostgreSQL rows into the service's stable field contract.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-store-contract.test.js

describe('FR-078 customer review store adapter contract', () => {
  it('increments the latest decision version regardless of adapter casing', () => {
    expect(nextDecisionVersion()).toBe(1)
    expect(nextDecisionVersion({ decisionVersion: 1 })).toBe(2)
    expect(nextDecisionVersion({ decision_version: 2 })).toBe(3)
  })

  it('maps PostgreSQL target names to the service field contract', () => {
    expect(mapTargetCustomer({ id: 'customer-1', display_name: 'Restricted Name' })).toEqual({
      id: 'customer-1',
      displayName: 'Restricted Name',
    })
  })
})
