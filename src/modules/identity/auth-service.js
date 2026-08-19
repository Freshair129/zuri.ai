// @req FR-082 — Production Authentication & Password Reset service.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-service.test.js, tests/unit/auth-api.test.js
import crypto from 'node:crypto'
import prisma from '@/lib/db'

export const AUTH_SESSION_COOKIE = 'zuri_session'
const SESSION_SECRET = process.env.ZURI_SESSION_SECRET || 'zuri-production-session-secret-v1'

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${derived}`
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false
  const parts = storedHash.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const expectedHash = parts[2]
  const actualHash = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(actualHash, 'hex'))
}

export function generateSessionToken(principalId) {
  const timestamp = Date.now()
  const payload = `${principalId}:${timestamp}`
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')
  return `zuri_sess:${principalId}:${timestamp}:${signature}`
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('zuri_sess:')) return null
  const parts = token.split(':')
  if (parts.length !== 4) return null
  const [, principalId, timestampStr, signature] = parts
  const timestamp = Number(timestampStr)
  if (!principalId || !timestamp || Number.isNaN(timestamp)) return null
  
  // 7-day max session validity
  if (Date.now() - timestamp > 7 * 24 * 60 * 60 * 1000) return null

  const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(`${principalId}:${timestamp}`).digest('hex')
  if (signature !== expectedSignature) return null

  return { principalId, timestamp }
}

export async function authenticateUser({ username, password, db = prisma } = {}) {
  if (!username || !password) {
    return { success: false, error: 'CREDENTIALS_REQUIRED' }
  }

  const query = username.trim()
  const person = await db.person.findFirst({
    where: {
      OR: [
        { email: query },
        { code: query },
      ],
    },
    include: { credential: true },
  })

  if (!person) {
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  if (!person.credential?.passwordHash) {
    // Development fallback for seeded owner without password explicitly set
    if (person.code === 'PER-OWNER') {
      const token = generateSessionToken(person.id)
      return { success: true, person: { id: person.id, code: person.code, displayName: person.displayName, email: person.email }, token }
    }
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  const isValid = verifyPassword(password, person.credential.passwordHash)
  if (!isValid) {
    return { success: false, error: 'INVALID_CREDENTIALS' }
  }

  const token = generateSessionToken(person.id)
  return {
    success: true,
    person: { id: person.id, code: person.code, displayName: person.displayName, email: person.email },
    token,
  }
}

export async function createPasswordResetToken({ emailOrUsername, db = prisma } = {}) {
  if (!emailOrUsername || typeof emailOrUsername !== 'string') {
    return { success: false, error: 'IDENTIFIER_REQUIRED' }
  }

  const query = emailOrUsername.trim()
  const person = await db.person.findFirst({
    where: {
      OR: [
        { email: query },
        { code: query },
      ],
    },
  })

  if (!person) {
    // Return success to prevent email enumeration attack
    return { success: true, message: 'Password reset instructions processed' }
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await db.passwordResetToken.create({
    data: {
      personId: person.id,
      token,
      expiresAt,
    },
  })

  return {
    success: true,
    message: 'Password reset instructions processed',
    resetToken: token, // Returned for API response / development workflow
  }
}

export async function resetPassword({ token, newPassword, db = prisma } = {}) {
  if (!token || !newPassword) {
    return { success: false, error: 'TOKEN_AND_PASSWORD_REQUIRED' }
  }

  const resetRecord = await db.passwordResetToken.findUnique({
    where: { token },
    include: { person: true },
  })

  if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < new Date()) {
    return { success: false, error: 'INVALID_OR_EXPIRED_TOKEN' }
  }

  const passwordHash = hashPassword(newPassword)

  await db.$transaction([
    db.personCredential.upsert({
      where: { personId: resetRecord.personId },
      update: { passwordHash },
      create: { personId: resetRecord.personId, passwordHash },
    }),
    db.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    }),
  ])

  return { success: true, message: 'Password updated successfully' }
}
