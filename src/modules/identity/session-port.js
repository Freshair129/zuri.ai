// @req FR-046, FR-095, FR-096 — request identity comes from a server-owned,
// persisted session adapter.
// @spec ADR-017, ADR-045 D2-D4, SDD-024, SDD-052, SEC-008, SEC-018
// @tested tests/unit/fr046-session-port.test.js, tests/unit/iam-session.test.js

import prisma from '@/lib/db'
import { AUTH_SESSION_COOKIE, hashSessionToken, verifySessionToken } from './auth-service'

function cookieValue(request, name) {
  if (request?.cookies?.get) {
    const cookie = request.cookies.get(name)
    if (typeof cookie === 'string') return cookie
    if (cookie?.value) return cookie.value
  }
  const header = (typeof request?.headers?.get === 'function' ? request.headers.get('cookie') : request?.headers?.cookie) || ''
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

function normalizeTrustedSession(value) {
  if (value == null) return null
  if (!value || typeof value.principalId !== 'string' || !value.principalId.trim()) {
    throw new Error('Trusted session adapter returned an invalid principal')
  }
  return {
    state: 'AUTHENTICATED',
    principalId: value.principalId,
    platformGrant: value.platformGrant === true,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
  }
}

/**
 * Provider-neutral request session port.
 */
export function createSessionPort({ readTrustedSession = async () => null, env = process.env, db = prisma } = {}) {
  return {
    async read(request) {
      const trusted = normalizeTrustedSession(await readTrustedSession(request))
      if (trusted) return trusted

      const sessionCookie = cookieValue(request, AUTH_SESSION_COOKIE)
      if (sessionCookie) {
        const session = verifySessionToken(sessionCookie, { secret: env.ZURI_SESSION_SECRET })
        if (!session) return { state: 'UNAUTHENTICATED' }

        // Current login tokens carry a session id and must match a live row.
        // Development-only legacy tokens without `sid` remain compatible;
        // production never accepts them.
        if (session.sessionId) {
          if (typeof db.session?.findUnique !== 'function') {
            if (env.NODE_ENV === 'production') return { state: 'UNAUTHENTICATED' }
          } else {
            const persisted = await db.session.findUnique({ where: { id: session.sessionId } })
            const live = persisted &&
              persisted.personId === session.principalId &&
              persisted.tokenHash === hashSessionToken(sessionCookie) &&
              persisted.status === 'ACTIVE' &&
              persisted.expiresAt > new Date()
            if (!live) return { state: 'UNAUTHENTICATED' }
            if (typeof db.session.updateMany === 'function') {
              await db.session.updateMany({
                where: { id: session.sessionId, status: 'ACTIVE' },
                data: { lastSeenAt: new Date() },
              })
            }
          }
        } else if (env.NODE_ENV === 'production') {
          return { state: 'UNAUTHENTICATED' }
        }

        return {
          state: 'AUTHENTICATED',
          principalId: session.principalId,
          platformGrant: false,
          sessionId: session.sessionId ?? `legacy-${session.issuedAt}-${session.expiresAt}`,
        }
      }

      return { state: 'UNAUTHENTICATED' }
    },
  }
}
