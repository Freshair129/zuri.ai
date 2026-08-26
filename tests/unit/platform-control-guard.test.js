import { describe, expect, it } from 'vitest'
import { resolvePlatformControlDecision } from '@/lib/platform-control-guard'
import { makeDevViewer, makeOperatorViewer, makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-105 — only the named installation capability can admit the control route.
// @spec ADR-048 D2, SEC-020
// @tested tests/unit/platform-control-guard.test.js

describe('Platform Control guard', () => {
  it('waits for the trusted viewer resolution before rendering', () => {
    expect(resolvePlatformControlDecision({ viewerLoading: true })).toEqual({ state: 'LOADING' })
  })

  it('uses the entry boundary when a trusted viewer is unavailable', () => {
    expect(resolvePlatformControlDecision({ viewer: null })).toEqual({ state: 'AUTH_REQUIRED', redirect: '/login' })
    expect(resolvePlatformControlDecision({ viewerError: 'unavailable' })).toEqual({ state: 'AUTH_REQUIRED', redirect: '/login' })
  })

  it('admits an installation operator without a Business selection', () => {
    expect(resolvePlatformControlDecision({ viewer: makeOperatorViewer({ ownedBusinessIds: [] }) })).toEqual({ state: 'READY' })
  })

  it('refuses a DEV visibility grant when it does not carry isOperator', () => {
    expect(resolvePlatformControlDecision({ viewer: makeDevViewer({ isOperator: false }) })).toEqual({ state: 'FORBIDDEN' })
  })

  it('refuses Business and Tenant authority no matter how broad it is', () => {
    expect(resolvePlatformControlDecision({ viewer: makeViewer({ isOperator: false }) })).toEqual({ state: 'FORBIDDEN' })
    expect(resolvePlatformControlDecision({ viewer: ownsElsewhere({ isOperator: false }) })).toEqual({ state: 'FORBIDDEN' })
  })
})
