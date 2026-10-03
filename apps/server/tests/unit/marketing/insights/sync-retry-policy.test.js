import { describe, expect, it } from 'vitest'
import {
  decideRetry, notificationForDecision, ERROR_CLASS, RETRY_DELAY_MS,
} from '@/modules/marketing/insights/domain/sync-retry-policy'

const NOW = Date.parse('2026-09-24T19:00:00.000Z')

describe('sync retry policy', () => {
  it('retries once after five minutes on a transient error', () => {
    const decision = decideRetry({ attempt: 1, errorClass: ERROR_CLASS.TRANSIENT, nowMs: NOW })
    expect(decision).toMatchObject({ action: 'RETRY', retryAtMs: NOW + RETRY_DELAY_MS, delayMs: RETRY_DELAY_MS })
  })

  it('gives up after the one retry', () => {
    const decision = decideRetry({ attempt: 2, errorClass: ERROR_CLASS.TRANSIENT, nowMs: NOW })
    expect(decision).toMatchObject({ action: 'FINAL_FAILURE', alertCode: 'TRANSIENT_ERROR', retryAtMs: null })
  })

  it.each([ERROR_CLASS.AUTH, ERROR_CLASS.SCHEMA, ERROR_CLASS.PERMISSION])('never retries a permanent %s error', (errorClass) => {
    const decision = decideRetry({ attempt: 1, errorClass, nowMs: NOW })
    expect(decision.action).toBe('FINAL_FAILURE')
    expect(decision.retryAtMs).toBeNull()
  })

  it('honours a provider Retry-After longer than five minutes exactly, never shortening it', () => {
    const decision = decideRetry({
      attempt: 1, errorClass: ERROR_CLASS.TRANSIENT, retryAfterMs: 20 * 60 * 1000, nowMs: NOW,
    })
    expect(decision).toMatchObject({ action: 'DEFERRED', retryAtMs: NOW + 20 * 60 * 1000, delayMs: 20 * 60 * 1000 })
  })

  it('keeps the five-minute default when Retry-After is shorter than the default', () => {
    const decision = decideRetry({
      attempt: 1, errorClass: ERROR_CLASS.TRANSIENT, retryAfterMs: 60 * 1000, nowMs: NOW,
    })
    expect(decision).toMatchObject({ action: 'RETRY', delayMs: RETRY_DELAY_MS })
  })

  it('treats an unclassified error as transient, with its own alert code', () => {
    const first = decideRetry({ attempt: 1, errorClass: ERROR_CLASS.UNKNOWN, nowMs: NOW })
    expect(first).toMatchObject({ action: 'RETRY' })
    const second = decideRetry({ attempt: 2, errorClass: ERROR_CLASS.UNKNOWN, nowMs: NOW })
    expect(second).toMatchObject({ action: 'FINAL_FAILURE', alertCode: 'UNKNOWN_ERROR' })
  })

  it('rejects an invalid attempt or a missing clock', () => {
    expect(() => decideRetry({ attempt: 0, errorClass: ERROR_CLASS.TRANSIENT, nowMs: NOW })).toThrow()
    expect(() => decideRetry({ attempt: 1, errorClass: ERROR_CLASS.TRANSIENT })).toThrow()
  })

  it('turns only a FINAL_FAILURE decision into a notification, exactly once', () => {
    const retry = decideRetry({ attempt: 1, errorClass: ERROR_CLASS.TRANSIENT, nowMs: NOW })
    expect(notificationForDecision(retry, { syncRunId: 'fx-sync-1', failureKey: 'k' })).toBeNull()

    const deferred = decideRetry({
      attempt: 1, errorClass: ERROR_CLASS.TRANSIENT, retryAfterMs: 20 * 60 * 1000, nowMs: NOW,
    })
    expect(notificationForDecision(deferred, { syncRunId: 'fx-sync-1', failureKey: 'k' })).toBeNull()

    const final = decideRetry({ attempt: 1, errorClass: ERROR_CLASS.AUTH, nowMs: NOW })
    expect(notificationForDecision(final, { syncRunId: 'fx-sync-1', failureKey: 'k' }))
      .toEqual({ syncRunId: 'fx-sync-1', failureKey: 'k', reasonCode: 'AUTH_ERROR' })
  })
})
