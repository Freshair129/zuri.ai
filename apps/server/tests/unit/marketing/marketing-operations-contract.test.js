import { describe, expect, it } from 'vitest'
import {
  MARKETING_OPERATIONS_TABS,
  zMarketingOperationsActionInput,
  zMarketingOperationsCreateInput,
} from '@/modules/marketing/domain/marketing-operations-contract'

// @req FR-162 — strict Operations intake contract rejects forged scope and
// unknown mutation fields before the owner service runs.
// @spec SDD-089, SEC-001
// @tested tests/unit/marketing/marketing-operations-contract.test.js

describe('Marketing Operations contract', () => {
  it('accepts a bounded create payload and normalizes optional fields', () => {
    const value = zMarketingOperationsCreateInput.parse({
      businessId: 'business-1',
      title: 'Autumn landing refresh',
      capability: 'Website & CRO',
      objective: 'Improve qualified conversion from the search landing page.',
      requiredAt: null,
      evidenceReference: null,
      responsibleOwnerId: null,
    })
    expect(value.title).toBe('Autumn landing refresh')
    expect(MARKETING_OPERATIONS_TABS.map((tab) => tab.key)).toEqual(['intake', 'calendar', 'approvals', 'handoffs'])
  })

  it('refuses forged fields and empty updates', () => {
    expect(() => zMarketingOperationsCreateInput.parse({
      businessId: 'business-1', title: 'Request', capability: 'SEO', objective: 'Objective', actorId: 'forged',
    })).toThrow()
    expect(() => zMarketingOperationsActionInput.parse({
      action: 'update', businessId: 'business-1', expectedVersion: 1, fields: {},
    })).toThrow()
  })
})
