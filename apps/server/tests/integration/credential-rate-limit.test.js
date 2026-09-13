// @req FR-224 — the RateLimitBucket limiter: fixed windows, refusal without taking a
//   slot, weights and forced counts, retry hints, and compare-and-set under concurrency.
// @spec ADR-089 D4
// @tested tests/integration/credential-rate-limit.test.js
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { CREDENTIAL_RATE_LIMITS, LINE_VALIDATION_KEY, consumeRateLimit, credentialWriteKey } from '@/modules/identity/rate-limit'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'

function clock(start = Date.parse('2026-09-14T10:00:00Z')) {
  let at = start
  return { now: () => new Date(at), advance: seconds => { at += seconds * 1000 } }
}

describe('credential rate limit (FR-224)', () => {
  it('declares the ADR-089 limits', () => {
    expect(CREDENTIAL_RATE_LIMITS).toEqual({ personBusiness: { limit: 5, windowSeconds: 900 }, lineValidation: { limit: 60, windowSeconds: 60 } })
    expect(credentialWriteKey('p1', 'b1')).toBe('CREDENTIAL_WRITE:p1:b1')
  })

  it('allows five in fifteen minutes, refuses the sixth with retryAfterSeconds, and opens a new window after', async () => {
    const key = `test:${randomUUID()}`
    const time = clock()
    for (let i = 1; i <= 5; i += 1) {
      expect(await consumeRateLimit({ key, ...CREDENTIAL_RATE_LIMITS.personBusiness, now: time.now })).toMatchObject({ count: i, remaining: 5 - i })
      time.advance(10)
    }
    const refused = await consumeRateLimit({ key, ...CREDENTIAL_RATE_LIMITS.personBusiness, now: time.now }).catch(e => e)
    expect(refused).toMatchObject({ status: 429, code: 'CREDENTIAL_RATE_LIMITED', message: 'CREDENTIAL_RATE_LIMITED', retryAfterSeconds: 900 - 50 })
    expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(5)
    time.advance(900 - 50)
    expect(await consumeRateLimit({ key, ...CREDENTIAL_RATE_LIMITS.personBusiness, now: time.now })).toMatchObject({ count: 1 })
  })

  it('a forced weight counts even at the limit, so a rejected validation spends two slots', async () => {
    const key = `test:${randomUUID()}`
    const time = clock()
    await consumeRateLimit({ key, limit: 5, windowSeconds: 900, now: time.now })
    await consumeRateLimit({ key, limit: 5, windowSeconds: 900, force: true, now: time.now })
    expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(2)
    await consumeRateLimit({ key, limit: 5, windowSeconds: 900, weight: 3, now: time.now })
    await expect(consumeRateLimit({ key, limit: 5, windowSeconds: 900, now: time.now })).rejects.toMatchObject({ status: 429 })
    expect(await consumeRateLimit({ key, limit: 5, windowSeconds: 900, force: true, now: time.now })).toMatchObject({ count: 6, remaining: 0 })
  })

  it('never lets concurrent requests take more slots than the limit', async () => {
    const key = `test:${randomUUID()}`
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeRateLimit({ key, limit: 5, windowSeconds: 900 })))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429)).toBe(true)
    expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(5)
  })

  it('the write guard spends the installation LINE budget only on actions that call LINE, sixty a minute', async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: LINE_VALIDATION_KEY } })
    const personId = `person-${randomUUID()}`
    const session = { id: 's1', personId, status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600_000), elevatedUntil: new Date(Date.now() + 900_000) }
    const factorDb = new Proxy(prisma, { get: (target, key) => (key === 'mfaFactor' ? { findFirst: async () => ({ id: 'f1' }) } : target[key]) })
    const guard = createCredentialWriteGuard({ session, db: factorDb })
    const viewer = { principal: { id: personId } }
    await guard.assertWriteAllowed({ viewer, businessId: `b-${randomUUID()}`, action: 'REVOKE' })
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: LINE_VALIDATION_KEY } })).toBeNull()
    for (let i = 0; i < 60; i += 1) await guard.assertWriteAllowed({ viewer, businessId: `b-${randomUUID()}`, action: i % 2 ? 'VALIDATE' : 'CONNECT' })
    expect((await prisma.rateLimitBucket.findUnique({ where: { key: LINE_VALIDATION_KEY } })).count).toBe(60)
    await expect(guard.assertWriteAllowed({ viewer, businessId: `b-${randomUUID()}`, action: 'ROTATE' })).rejects.toMatchObject({ status: 429, code: 'CREDENTIAL_RATE_LIMITED' })
    await prisma.rateLimitBucket.deleteMany({ where: { key: LINE_VALIDATION_KEY } })
  })

  it('refuses a malformed configuration instead of silently not limiting', async () => {
    await expect(consumeRateLimit({ key: '', limit: 5, windowSeconds: 900 })).rejects.toThrow('RATE_LIMIT_CONFIGURATION_INVALID')
    await expect(consumeRateLimit({ key: 'k', limit: 0, windowSeconds: 900 })).rejects.toThrow('RATE_LIMIT_CONFIGURATION_INVALID')
  })
})
