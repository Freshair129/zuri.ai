import { describe, expect, it } from 'vitest'
import {
  SIGNUP_RATE_LIMIT_MAX,
  SIGNUP_RATE_LIMIT_WINDOW_MS,
  createSignupRateLimiter,
  signupSourceKey,
} from '@/modules/identity/signup-rate-limit'

// @req FR-120 — the per-source rate limit named as a compensating control for
// the enumeration a distinguishable "email taken" answer permits.
// @spec SEC-008
// @tested tests/unit/fr120-signup-rate-limit.test.js
//
// Every test here drives an INJECTED clock. A limiter tested with the real one
// either sleeps for its window or asserts nothing about expiry — and the second
// is the trap, because a window that never resets passes every test that only
// counts upward while locking real callers out permanently.

const headers = (entries) => new Headers(entries)

describe('FR-120 signup rate limit', () => {
  it('permits exactly the configured number of attempts, then refuses', () => {
    const limiter = createSignupRateLimiter({ max: 3, windowMs: 1000, now: () => 0 })

    expect(limiter.check('1.2.3.4').allowed).toBe(true)
    expect(limiter.check('1.2.3.4').allowed).toBe(true)
    expect(limiter.check('1.2.3.4').allowed).toBe(true)
    expect(limiter.check('1.2.3.4').allowed).toBe(false)
  })

  it('counts each source separately, so one caller cannot lock out another', () => {
    const limiter = createSignupRateLimiter({ max: 1, windowMs: 1000, now: () => 0 })

    expect(limiter.check('1.2.3.4').allowed).toBe(true)
    expect(limiter.check('1.2.3.4').allowed).toBe(false)
    expect(limiter.check('5.6.7.8').allowed).toBe(true)
  })

  it('reopens the window once it has elapsed', () => {
    let clock = 0
    const limiter = createSignupRateLimiter({ max: 1, windowMs: 1000, now: () => clock })

    expect(limiter.check('1.2.3.4').allowed).toBe(true)
    expect(limiter.check('1.2.3.4').allowed).toBe(false)

    clock = 1000
    expect(limiter.check('1.2.3.4').allowed).toBe(true)
  })

  it('keeps counting refused attempts, so retrying does not extend the window', () => {
    // A limiter that stopped counting once over would let a caller who keeps
    // trying reset their own `resetAt` on every new bucket — the refusal would
    // expire on the last attempt rather than the first.
    let clock = 0
    const limiter = createSignupRateLimiter({ max: 1, windowMs: 1000, now: () => clock })

    limiter.check('1.2.3.4')
    clock = 500
    expect(limiter.check('1.2.3.4').retryAfterSeconds).toBe(1)
    clock = 900
    expect(limiter.check('1.2.3.4').allowed).toBe(false)
    clock = 1000
    expect(limiter.check('1.2.3.4').allowed).toBe(true)
  })

  it('drops expired windows instead of holding one entry per source forever', () => {
    let clock = 0
    const limiter = createSignupRateLimiter({ max: 5, windowMs: 1000, now: () => clock })

    limiter.check('a')
    limiter.check('b')
    expect(limiter.size).toBe(2)

    clock = 2000
    limiter.check('c')
    expect(limiter.size).toBe(1)
  })

  it('evicts the oldest window at the key cap rather than refusing a new caller', () => {
    // Fail-closed here would be its own denial of service: anyone able to fill
    // the table could stop every honest caller from signing up.
    const limiter = createSignupRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: () => 0 })

    limiter.check('first')
    limiter.check('second')
    expect(limiter.check('third').allowed).toBe(true)
    expect(limiter.size).toBe(2)
    // 'first' was evicted, so it starts a fresh window — the documented cost of
    // choosing eviction over refusal.
    expect(limiter.check('first').allowed).toBe(true)
  })

  it('folds a missing or empty key into one shared bucket rather than exempting it', () => {
    // The alternative — treating "no key" as "no limit" — would make the header
    // the control depends on optional, and an attacker omits an optional header.
    const limiter = createSignupRateLimiter({ max: 1, windowMs: 1000, now: () => 0 })

    expect(limiter.check(undefined).allowed).toBe(true)
    expect(limiter.check('').allowed).toBe(false)
    expect(limiter.check(null).allowed).toBe(false)
  })

  it('ships a window generous enough to survive an office behind one NAT', () => {
    // Not a tautology: with no proxy header every caller shares one bucket, so a
    // tight limit is an outage rather than a control. If someone tightens this,
    // the test says why the number was chosen.
    expect(SIGNUP_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(20)
    expect(SIGNUP_RATE_LIMIT_WINDOW_MS).toBeLessThanOrEqual(30 * 60 * 1000)
  })
})

describe('FR-120 signup source key', () => {
  it('takes the client hop from a forwarded chain, not the nearest proxy', () => {
    expect(signupSourceKey(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then to one shared bucket', () => {
    expect(signupSourceKey(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(signupSourceKey(headers({}))).toBe('unknown')
    expect(signupSourceKey(undefined)).toBe('unknown')
  })

  it('does not treat a blank forwarded header as a client address', () => {
    // `x-forwarded-for: ""` split on ',' yields [''], which is falsy but is not
    // undefined — the shape that would have keyed every such request under the
    // empty string while looking like it had found an address.
    expect(signupSourceKey(headers({ 'x-forwarded-for': '  ' }))).toBe('unknown')
  })
})
