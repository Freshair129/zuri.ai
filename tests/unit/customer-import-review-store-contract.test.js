import { describe, expect, it } from 'vitest'

import {
  createDefaultCustomerReviewStore,
  CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED,
  mapTargetCustomer,
  nextDecisionVersion,
} from '@/modules/crm/customer-import-review-store'

// @req FR-078 — the production customer review adapter preserves decision
// versions and maps PostgreSQL rows into the service's stable field contract.
// An unconfigured target is a distinct 503 the queue page can recognize —
// never a silent local fallback in production, never indistinguishable from
// a configured target that is merely failing.
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

  describe('createDefaultCustomerReviewStore target resolution', () => {
    it('throws a stable, recognizable 503 when no target is configured at all', () => {
      let caught = null
      try {
        createDefaultCustomerReviewStore({ env: {} })
      } catch (error) {
        caught = error
      }
      expect(caught).not.toBeNull()
      expect(caught.status).toBe(503)
      expect(caught.message).toBe(CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED)
    })

    it('never silently falls back to the local Prisma target in production, even if ZURI_CUSTOMER_REVIEW_MODE=local is set', () => {
      let caught = null
      try {
        createDefaultCustomerReviewStore({ env: { NODE_ENV: 'production', ZURI_CUSTOMER_REVIEW_MODE: 'local' } })
      } catch (error) {
        caught = error
      }
      expect(caught).not.toBeNull()
      expect(caught.status).toBe(503)
      expect(caught.message).toBe(CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED)
    })

    it('resolves the local Prisma fixture target outside production when explicitly opted in', () => {
      const store = createDefaultCustomerReviewStore({ env: { NODE_ENV: 'test', ZURI_CUSTOMER_REVIEW_MODE: 'local' } })
      expect(typeof store.listCases).toBe('function')
      expect(typeof store.resolveScope).toBe('function')
    })
  })
})
