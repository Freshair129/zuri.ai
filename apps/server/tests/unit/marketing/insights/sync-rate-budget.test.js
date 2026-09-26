import { describe, expect, it } from 'vitest'
import { planCallBudget, CALLS_PER_HOUR_CAP } from '@/modules/marketing/insights/domain/sync-rate-budget'

const HOUR_MS = 60 * 60 * 1000
const NOW = Date.parse('2026-09-24T19:00:00.000Z')

describe('sync rate budget', () => {
  it('allows every planned call when the log is empty and under the cap', () => {
    const plan = planCallBudget({ callLog: [], plannedCalls: 50, nowMs: NOW })
    expect(plan).toEqual({ allowed: 50, deferredCalls: 0, deferredUntilMs: null })
  })

  it('caps at 200 calls/hour and defers the rest until the oldest call ages out', () => {
    const callLog = Array.from({ length: 190 }, (_, index) => NOW - index * 1000)
    const oldest = Math.min(...callLog)
    const plan = planCallBudget({ callLog, plannedCalls: 20, nowMs: NOW })
    expect(plan.allowed).toBe(CALLS_PER_HOUR_CAP - 190)
    expect(plan.deferredCalls).toBe(20 - (CALLS_PER_HOUR_CAP - 190))
    expect(plan.deferredUntilMs).toBe(oldest + HOUR_MS)
  })

  it('ignores calls older than the trailing hour', () => {
    const callLog = [NOW - HOUR_MS - 1, NOW - HOUR_MS]
    const plan = planCallBudget({ callLog, plannedCalls: 5, nowMs: NOW })
    expect(plan).toEqual({ allowed: 5, deferredCalls: 0, deferredUntilMs: null })
  })

  it('includes a call timestamped exactly now', () => {
    const callLog = Array.from({ length: CALLS_PER_HOUR_CAP }, () => NOW)
    const plan = planCallBudget({ callLog, plannedCalls: 1, nowMs: NOW })
    expect(plan).toEqual({ allowed: 0, deferredCalls: 1, deferredUntilMs: NOW + HOUR_MS })
  })

  it('defers to one hour from now when a burst alone exceeds the cap with no history', () => {
    const plan = planCallBudget({ callLog: [], plannedCalls: 250, nowMs: NOW })
    expect(plan).toEqual({ allowed: CALLS_PER_HOUR_CAP, deferredCalls: 50, deferredUntilMs: NOW + HOUR_MS })
  })

  it('rejects an invalid plannedCalls or a missing clock', () => {
    expect(() => planCallBudget({ plannedCalls: -1, nowMs: NOW })).toThrow()
    expect(() => planCallBudget({ plannedCalls: 1 })).toThrow()
  })
})
