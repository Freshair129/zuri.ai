// @req FR-224 — the product's first rate limit: fixed-window counters in
//   RateLimitBucket, consumed with compare-and-set so concurrent requests cannot
//   both take the last slot, answering 429 CREDENTIAL_RATE_LIMITED with
//   retryAfterSeconds.
// @req FR-296, FR-297 — durable login buckets and the shared per-Person TOTP bucket.
// @spec ADR-089 D4; ADR-058 (a table, not Redis); SEC-026
// @tested tests/integration/credential-rate-limit.test.js, tests/integration/auth-rate-limit.test.js

import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import prisma from '@/lib/db'

/** The limits ADR-089 D4 / design §4.6 set. Weights: a rejected LINE validation counts twice. */
export const CREDENTIAL_RATE_LIMITS = Object.freeze({
  personBusiness: Object.freeze({ limit: 5, windowSeconds: 15 * 60 }),
  lineValidation: Object.freeze({ limit: 60, windowSeconds: 60 }),
})

export const AUTHENTICATION_RATE_LIMITS = Object.freeze({
  passwordLogin: Object.freeze({
    identifierAddress: Object.freeze({ limit: 10, windowSeconds: 15 * 60 }),
    identifier: Object.freeze({ limit: 50, windowSeconds: 15 * 60 }),
    address: Object.freeze({ limit: 200, windowSeconds: 15 * 60 }),
  }),
  totpVerification: Object.freeze({
    person: Object.freeze({ limit: 5, windowSeconds: 15 * 60 }),
  }),
})

const hashRateLimitKeyPart = value => createHash('sha256').update(value, 'utf8').digest('hex')

/**
 * Derive the login client address from the proxy-appended x-forwarded-for chain.
 * ZURI_TRUSTED_PROXY_HOPS selects the entry N positions from the right (default
 * 1; production's ngrok proxy appends the client address). Missing or short
 * chains, and entries that are not IPs, return null so login uses only the
 * identifier bucket. Unlike signupSourceKey, this never trusts the leftmost
 * caller-supplied hop or creates a shared `unknown` address bucket.
 */
export function passwordLoginClientAddress(headers, env = process.env) {
  const rawHops = env?.ZURI_TRUSTED_PROXY_HOPS
  const configuredHops = rawHops === undefined || rawHops === null ? '' : String(rawHops).trim()
  const hops = configuredHops === '' ? 1 : Number(configuredHops)
  if (!Number.isSafeInteger(hops) || hops < 1 || (configuredHops !== '' && !/^\d+$/.test(configuredHops))) {
    throw new Error('RATE_LIMIT_CONFIGURATION_INVALID')
  }

  const forwarded = headers?.get?.('x-forwarded-for')
  if (typeof forwarded !== 'string' || !forwarded.trim()) return null

  const chain = forwarded.split(',').map(entry => entry.trim())
  if (chain.length < hops) return null

  const address = chain[chain.length - hops]
  return isIP(address) ? address : null
}

/**
 * Stable, PII-minimized buckets. Email and code are separate normalized
 * identifiers, so without a pre-lookup one account can get a separate 50-attempt
 * identifier budget for each.
 */
export function passwordLoginRateLimitKeys(username, headers, env = process.env) {
  const identifier = typeof username === 'string' ? username.trim().toLowerCase() : ''
  const address = passwordLoginClientAddress(headers, env)
  const identifierHash = hashRateLimitKeyPart(identifier)
  if (!address) {
    return {
      identifierAddress: null,
      identifier: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER:${identifierHash}`,
      address: null,
    }
  }

  const addressHash = hashRateLimitKeyPart(address)
  return {
    identifierAddress: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER_ADDRESS:${identifierHash}:${addressHash}`,
    identifier: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER:${identifierHash}`,
    address: `AUTH_RATE_LIMIT:LOGIN:ADDRESS:${addressHash}`,
  }
}

export function totpVerificationRateLimitKey(personId) {
  if (typeof personId !== 'string' || !personId.trim()) throw new Error('RATE_LIMIT_CONFIGURATION_INVALID')
  return `AUTH_RATE_LIMIT:MFA:TOTP_PERSON:${hashRateLimitKeyPart(personId)}`
}

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

export function isRateLimitError(error) {
  return error?.status === 429 && error?.code === 'CREDENTIAL_RATE_LIMITED'
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

/** Consume login windows in identifier+address, identifier, then address order. */
export async function consumeLoginRateLimits({ username, headers, db = prisma, now = () => new Date() } = {}) {
  const keys = passwordLoginRateLimitKeys(username, headers)
  const buckets = keys.identifierAddress
    ? ['identifierAddress', 'identifier', 'address']
    : ['identifier']

  for (const bucket of buckets) {
    const limits = AUTHENTICATION_RATE_LIMITS.passwordLogin[bucket]
    try {
      await consumeRateLimit({ key: keys[bucket], ...limits, db, now })
    } catch (error) {
      if (!isRateLimitError(error)) throw error
      const retry = Number.isInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0
        ? error.retryAfterSeconds
        : 1
      throw limited(retry)
    }
  }
}

/** One shared TOTP budget per Person across enrollment and step-up verification. */
export async function consumeTotpVerificationRateLimit({ personId, db = prisma, now = () => new Date() } = {}) {
  return consumeRateLimit({
    key: totpVerificationRateLimitKey(personId),
    ...AUTHENTICATION_RATE_LIMITS.totpVerification.person,
    db,
    now,
  })
}
