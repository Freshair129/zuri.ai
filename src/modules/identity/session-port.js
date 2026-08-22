// @req FR-046 — request identity comes from a server-owned session adapter.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-port.test.js

import { AUTH_SESSION_COOKIE, verifySessionToken } from './auth-service'

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
export function createSessionPort({ readTrustedSession = async () => null, env = process.env } = {}) {
  return {
    async read(request) {
      const trusted = normalizeTrustedSession(await readTrustedSession(request))
      if (trusted) return trusted

      const sessionCookie = cookieValue(request, AUTH_SESSION_COOKIE)
      if (sessionCookie) {
        const session = verifySessionToken(sessionCookie, { secret: env.ZURI_SESSION_SECRET })
        if (!session) return { state: 'UNAUTHENTICATED' }
        return {
          state: 'AUTHENTICATED',
          principalId: session.principalId,
          platformGrant: false,
          sessionId: `session-${session.issuedAt}-${session.expiresAt}`,
        }
      }

      return { state: 'UNAUTHENTICATED' }
    },
  }
}
