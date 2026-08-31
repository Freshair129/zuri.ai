// @req FR-046, FR-095, FR-096, FR-107 — request identity comes from a
// server-owned, persisted session adapter; the installation-operator capability
// is resolved per request from the PlatformGrant store.
// @spec ADR-017, ADR-045 D2-D4, SDD-024, SDD-052, SEC-008, SEC-018
// @tested tests/unit/fr046-session-port.test.js, tests/unit/iam-session.test.js, tests/unit/operator-bootstrap.test.js

import prisma from '@/lib/db'
import { AUTH_SESSION_COOKIE, hashSessionToken, verifySessionToken } from './auth-service'
import { hasOperatorGrant } from './operator-bootstrap'

// Exported because FR-123's consent gate has to bind its anti-CSRF and signed
// request tokens to *this* session, and therefore has to read the same cookie
// off the same request shapes (NextRequest, plain Request, a header bag) this
// port already handles. A second reader would be a second definition of "the
// session cookie", which is exactly the kind of drift the binding exists to
// prevent.
export function readRequestCookie(request, name) {
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

      const sessionCookie = readRequestCookie(request, AUTH_SESSION_COOKIE)
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
          // @req FR-107 — resolved from the PlatformGrant store on every
          // request, never snapshotted into the session: revoking the grant
          // denies the very next request (NFR-019 discipline). Where the store
          // does not exist (test doubles, pre-migration databases) this reads
          // false — the pre-FR-107 behavior, never a widened one.
          platformGrant: await hasOperatorGrant(session.principalId, db),
          sessionId: session.sessionId ?? `legacy-${session.issuedAt}-${session.expiresAt}`,
        }
      }

      return { state: 'UNAUTHENTICATED' }
    },
  }
}
