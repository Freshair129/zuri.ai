import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/db'
import { isInstallationOperator } from './viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-046, FR-095 — credential login verifies PersonCredential and issues a signed,
// persisted, revocable session.
// @req FR-120 — the same session-minting path serves self-serve signup, which
// calls `authenticateUser` rather than issuing a second kind of session, and
// whose lowercased email this lookup must therefore also match.
// @req FR-104 — owner-assisted password reset: mint is authenticated authority, the
// raw token appears exactly once (in the mint response, for out-of-band handover),
// storage is hash-bound, and consumption revokes every active session.
// @spec ADR-017, ADR-045 D2, SDD-024, SDD-052, SEC-008, SEC-018
// @tested tests/unit/auth-service.test.js, tests/unit/iam-session.test.js, tests/unit/fr046-auth-route.test.js
// @tested tests/unit/password-reset-service.test.js, tests/integration/password-reset-flow.test.js

export const AUTH_SESSION_COOKIE = 'zuri_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

const SESSION_PREFIX = 'zuri_sess'
const PASSWORD_HASH_PREFIX = 'scrypt'
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_SALT_BYTES = 16
const MIN_SESSION_SECRET_LENGTH = 32

export function hashSessionToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('SESSION_TOKEN_REQUIRED')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

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

export function generateSessionToken(principalId, { secret, now = Date.now(), sessionId = null } = {}) {
  if (typeof principalId !== 'string' || !principalId.trim()) throw new Error('SESSION_PRINCIPAL_REQUIRED')
  const sessionSecret = secret ?? requireSessionSecret()
  const issuedAt = Math.floor(now / 1000)
  const payload = encodePayload({
    sub: principalId,
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS,
    ...(typeof sessionId === 'string' && sessionId.trim() ? { sid: sessionId.trim() } : {}),
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
    sessionId: typeof payload.sid === 'string' && payload.sid.trim() ? payload.sid : null,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  }
}

export async function persistSession({ token, sessionId, personId, db = prisma, env = process.env, secret, now = Date.now(), assurance = 'PASSWORD' } = {}) {
  if (typeof db.session?.create !== 'function') return null
  const sessionSecret = secret ?? requireSessionSecret(env)
  const verified = verifySessionToken(token, { secret: sessionSecret, now })
  if (!verified || verified.sessionId !== sessionId || verified.principalId !== personId) {
    throw new Error('SESSION_PERSISTENCE_INVALID')
  }

  return db.session.create({
    data: {
      id: sessionId,
      personId,
      tokenHash: hashSessionToken(token),
      status: 'ACTIVE',
      assurance,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(verified.expiresAt * 1000),
    },
  })
}

export async function revokeSessionToken(token, {
  db = prisma,
  env = process.env,
  now = Date.now(),
  reason = 'LOGOUT',
} = {}) {
  if (typeof db.session?.updateMany !== 'function') return false
  const session = verifySessionToken(token, { secret: requireSessionSecret(env), now })
  if (!session?.sessionId) return false

  const result = await db.session.updateMany({
    where: {
      id: session.sessionId,
      personId: session.principalId,
      tokenHash: hashSessionToken(token),
      status: 'ACTIVE',
    },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(now),
      revokeReason: reason,
      version: { increment: 1 },
    },
  })
  return result.count > 0
}

export async function revokeAllSessions(personId, { db = prisma, now = Date.now(), reason = 'LOGOUT_ALL' } = {}) {
  if (typeof db.session?.updateMany !== 'function') return 0
  if (typeof personId !== 'string' || !personId.trim()) throw new Error('SESSION_PRINCIPAL_REQUIRED')

  const result = await db.session.updateMany({
    where: { personId, status: 'ACTIVE' },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(now),
      revokeReason: reason,
      version: { increment: 1 },
    },
  })
  return result.count
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

  // FR-120 stores a self-serve signup's email trimmed and lowercased, so this
  // lookup has to accept the casing the person actually types or signup would
  // create accounts their owners cannot sign into. Additive on purpose: both
  // exact-match arms are untouched, so every identifier that resolved before
  // still resolves — including a `code`, which is uppercase and would resolve
  // to nothing if the identifier were simply lowercased before the query.
  const lowered = identifier.toLowerCase()
  const person = await db.person.findFirst({
    where: {
      OR: [
        { email: identifier },
        ...(lowered === identifier ? [] : [{ email: lowered }]),
        { code: identifier },
      ],
    },
    include: { credential: true },
  })
  if (!person?.credential || !verifyPassword(password, person.credential.passwordHash)) {
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  const sessionId = randomUUID()
  const token = generateSessionToken(person.id, { secret: requireSessionSecret(env), sessionId })
  await persistSession({
    token,
    sessionId,
    personId: person.id,
    db,
    env,
    secret: requireSessionSecret(env),
    now: Date.now(),
  })

  return {
    success: true,
    token,
    sessionId,
    user: { id: person.id, code: person.code, displayName: person.displayName },
  }
}

// --- FR-104 — owner-assisted password reset ---------------------------------
//
// WHY THERE IS NO PUBLIC FORGOT-PASSWORD ROUTE
// --------------------------------------------
// This repository has no mail transport, so a public "forgot password" endpoint
// has exactly two possible shapes: one that returns the reset token to the
// unauthenticated caller — an account-takeover primitive, which is what the
// abandoned FR-082 draft on codex/postgres-primary-runtime shipped
// (`resetToken: token // Returned for API response`) and the reason it was not
// revived as-is — or one that returns nothing and therefore resets nothing.
// Neither is a password reset. What this product actually has is a staffed
// installation: a Business owner who already administers their members'
// Memberships (FR-038) hands the reset link over the counter or over LINE. So
// minting is an authenticated, audited authority action, and only the consume
// leg is public.

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

/** Reset tokens are stored hash-bound (SEC-014's invite-token discipline): the
 * `PasswordResetToken.token` column holds this digest, never the raw secret. */
export function hashPasswordResetToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('RESET_TOKEN_REQUIRED')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Mint a single-use, expiring reset token for one Person.
 *
 * Authority mirrors FR-038's membership administration: the installation
 * operator, or an owner of a Business where the target holds a Membership.
 * `viewer.role === 'OWNER'` alone is never enough — it is the global label
 * (resolve-viewer.js), and an OWNER-of-somewhere-else must not reset the
 * password of a person they have no authority over.
 *
 * The raw token is returned exactly once, to this authenticated caller, for
 * out-of-band handover. It is not persisted, logged, or ever shown again.
 */
export async function mintPasswordReset({ targetPersonId, viewer, db = prisma, now = Date.now() } = {}) {
  if (typeof targetPersonId !== 'string' || !targetPersonId.trim()) throw failure(400, 'TARGET_PERSON_REQUIRED')

  const target = await db.person.findUnique({
    where: { id: targetPersonId },
    select: { id: true, code: true, displayName: true },
  })
  if (!target) throw failure(404, 'PERSON_NOT_FOUND')

  if (!isInstallationOperator(viewer)) {
    const owned = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds : []
    const governs = owned.length > 0 && await db.membership.findFirst({
      where: { personId: target.id, businessId: { in: owned } },
      select: { id: true },
    })
    if (!governs) throw failure(403, 'Minting a password reset requires owner authority over a Business this person belongs to')
  }

  const raw = randomBytes(32).toString('hex')
  const expiresAt = new Date(now + PASSWORD_RESET_TTL_MS)

  await db.passwordResetToken.create({
    data: { personId: target.id, token: hashPasswordResetToken(raw), expiresAt },
  })
  await recordAudit(db, {
    entityType: 'PERSON',
    entityId: target.id,
    action: 'PASSWORD_RESET_MINTED',
    actorId: viewer?.principal?.id ?? null,
    // No token material here in any form — the audit stream answers "who minted
    // a reset for whom, when", never "what was the secret".
    payload: { targetPersonCode: target.code, expiresAt: expiresAt.toISOString() },
  })

  return { resetToken: raw, personId: target.id, personCode: target.code, expiresAt: expiresAt.toISOString() }
}

/**
 * Consume a reset token: set the new credential, burn the token, revoke every
 * active session. One generic INVALID_OR_EXPIRED_TOKEN for unknown, used and
 * expired alike — distinguishing them tells an attacker which guesses landed.
 */
export async function resetPassword({ token, newPassword, db = prisma, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token || typeof newPassword !== 'string' || !newPassword) {
    return { success: false, error: 'TOKEN_AND_PASSWORD_REQUIRED' }
  }

  let passwordHash
  try {
    passwordHash = hashPassword(newPassword)
  } catch {
    return { success: false, error: 'PASSWORD_INVALID' }
  }

  const record = await db.passwordResetToken.findUnique({
    where: { token: hashPasswordResetToken(token) },
    select: { id: true, personId: true, usedAt: true, expiresAt: true },
  })
  if (!record || record.usedAt || record.expiresAt <= new Date(now)) {
    return { success: false, error: 'INVALID_OR_EXPIRED_TOKEN' }
  }

  await db.$transaction(async (tx) => {
    await tx.personCredential.upsert({
      where: { personId: record.personId },
      update: { passwordHash },
      create: { personId: record.personId, passwordHash },
    })
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date(now) },
    })
    await recordAudit(tx, {
      entityType: 'PERSON',
      entityId: record.personId,
      action: 'PASSWORD_RESET_COMPLETED',
      // The consumer is unauthenticated by design; the actor of record is the
      // mint event one row earlier in this Person's audit stream.
      payload: {},
    })
  })

  // A stolen session must not survive the reset that exists to evict it.
  await revokeAllSessions(record.personId, { db, now, reason: 'PASSWORD_RESET' })

  return { success: true }
}
