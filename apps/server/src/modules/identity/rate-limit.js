// @req FR-224 — the product's first rate limit: fixed-window counters in
//   RateLimitBucket, consumed with compare-and-set so concurrent requests cannot
//   both take the last slot, answering 429 CREDENTIAL_RATE_LIMITED with
//   retryAfterSeconds.
// @spec ADR-089 D4; ADR-058 (a table, not Redis)
// @tested tests/integration/credential-rate-limit.test.js

import prisma from '@/lib/db'

/** The limits ADR-089 D4 / design §4.6 set. Weights: a rejected LINE validation counts twice. */
export const CREDENTIAL_RATE_LIMITS = Object.freeze({
  personBusiness: Object.freeze({ limit: 5, windowSeconds: 15 * 60 }),
  lineValidation: Object.freeze({ limit: 60, windowSeconds: 60 }),
})

export function credentialWriteKey(personId, businessId) {
  return `CREDENTIAL_WRITE:${personId}:${businessId}`
}

export const LINE_VALIDATION_KEY = 'LINE_VALIDATION:INSTALLATION'

function limited(retryAfterSeconds) {
  const error = new Error('CREDENTIAL_RATE_LIMITED')
  error.status = 429
  error.code = 'CREDENTIAL_RATE_LIMITED'
  error.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds))
  return error
}

function isUniqueViolation(error) {
  return error?.name === 'PrismaClientKnownRequestError' && error?.code === 'P2002'
}

/**
 * Take `weight` from a bucket, or refuse without taking anything.
 *
 * @param {object} options
 * @param {boolean} [options.force] add the weight even past the limit (used to make
 *   a rejected validation count twice after it already happened); never refuses
 * @returns {Promise<{count: number, remaining: number, resetAt: Date}>}
 */
export async function consumeRateLimit({ key, limit, windowSeconds, weight = 1, force = false, db = prisma, now = () => new Date() }) {
  if (typeof key !== 'string' || !key || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1
    || !Number.isInteger(weight) || weight < 1) {
    throw new Error('RATE_LIMIT_CONFIGURATION_INVALID')
  }
  const windowMs = windowSeconds * 1000
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const at = now()
    const row = await db.rateLimitBucket.findUnique({ where: { key } })
    if (!row) {
      if (!force && weight > limit) throw limited(windowSeconds)
      try {
        await db.rateLimitBucket.create({ data: { key, windowStart: at, count: weight } })
        return { count: weight, remaining: Math.max(0, limit - weight), resetAt: new Date(at.getTime() + windowMs) }
      } catch (error) {
        if (isUniqueViolation(error)) continue
        throw error
      }
    }
    const resetAt = new Date(row.windowStart.getTime() + windowMs)
    if (resetAt.getTime() <= at.getTime()) {
      if (!force && weight > limit) throw limited(windowSeconds)
      const reset = await db.rateLimitBucket.updateMany({
        where: { key, windowStart: row.windowStart, count: row.count },
        data: { windowStart: at, count: weight },
      })
      if (reset.count === 1) return { count: weight, remaining: Math.max(0, limit - weight), resetAt: new Date(at.getTime() + windowMs) }
      continue
    }
    if (!force && row.count + weight > limit) throw limited((resetAt.getTime() - at.getTime()) / 1000)
    const taken = await db.rateLimitBucket.updateMany({
      where: { key, windowStart: row.windowStart, count: row.count },
      data: { count: row.count + weight },
    })
    if (taken.count === 1) return { count: row.count + weight, remaining: Math.max(0, limit - row.count - weight), resetAt }
  }
  // Five lost compare-and-sets in a row is contention, and contention on a limit is
  // itself the answer.
  throw limited(1)
}
