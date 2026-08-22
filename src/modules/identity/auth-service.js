import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/db'

// @req FR-046 — credential login verifies PersonCredential and issues a signed session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/auth-service.test.js, tests/unit/fr046-auth-route.test.js

export const AUTH_SESSION_COOKIE = 'zuri_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const SESSION_PREFIX = 'zuri_sess'
const PASSWORD_HASH_PREFIX = 'scrypt'
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_SALT_BYTES = 16
const MIN_SESSION_SECRET_LENGTH = 32

export function requireSessionSecret(env = process.env) {
  const secret = env.ZURI_SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error('SESSION_SECRET_REQUIRED')
  }
  return secret
}

export function hashPassword(password, salt = randomBytes(PASSWORD_SALT_BYTES).toString('hex')) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('PASSWORD_INVALID')
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex')
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derivedKey}`
}

export function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false
  const match = storedHash.match(/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/i)
  if (!match) return false

  try {
    const expected = Buffer.from(match[2], 'hex')
    const actual = scryptSync(password, match[1], PASSWORD_KEY_LENGTH)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodePayload(value) {
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    return payload
  } catch {
    return null
  }
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

export function generateSessionToken(principalId, { secret, now = Date.now() } = {}) {
  if (typeof principalId !== 'string' || !principalId.trim()) throw new Error('SESSION_PRINCIPAL_REQUIRED')
  const sessionSecret = secret ?? requireSessionSecret()
  const issuedAt = Math.floor(now / 1000)
  const payload = encodePayload({
    sub: principalId,
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS,
  })
  return `${SESSION_PREFIX}.${payload}.${sign(payload, sessionSecret)}`
}

export function verifySessionToken(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== 'string') return null
  const [prefix, encodedPayload, signature] = token.split('.')
  if (prefix !== SESSION_PREFIX || !encodedPayload || !signature) return null

  const sessionSecret = secret ?? requireSessionSecret()
  const expectedSignature = sign(encodedPayload, sessionSecret)
  const expectedBuffer = Buffer.from(expectedSignature)
  const actualBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return null

  const payload = decodePayload(encodedPayload)
  const nowSeconds = Math.floor(now / 1000)
  if (
    typeof payload?.sub !== 'string' || !payload.sub.trim() ||
    !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
    payload.exp <= nowSeconds || payload.exp <= payload.iat ||
    payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS ||
    payload.iat > nowSeconds + 60
  ) return null

  return {
    principalId: payload.sub,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  }
}

/**
 * Verify a submitted identifier and password without exposing whether the
 * identifier or the password was the part that failed.
 */
export async function authenticateUser({ username, password, db = prisma, env = process.env } = {}) {
  const identifier = typeof username === 'string' ? username.trim() : ''
  if (!identifier || typeof password !== 'string' || !password) {
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  const person = await db.person.findFirst({
    where: { OR: [{ email: identifier }, { code: identifier }] },
    include: { credential: true },
  })
  if (!person?.credential || !verifyPassword(password, person.credential.passwordHash)) {
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  return {
    success: true,
    token: generateSessionToken(person.id, { secret: requireSessionSecret(env) }),
    user: { id: person.id, code: person.code, displayName: person.displayName },
  }
}
