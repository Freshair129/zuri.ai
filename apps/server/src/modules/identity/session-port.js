// @req FR-046, FR-095, FR-096, FR-107, FR-252 — request identity comes from a
// server-owned, persisted session adapter; the installation-operator capability
// is resolved per request from the PlatformGrant store.
// @spec ADR-017, ADR-045 D2-D4, ADR-097, ADR-124 D2, SDD-024, SDD-052, SEC-008, SEC-018
// @tested tests/unit/fr046-session-port.test.js, tests/unit/iam-session.test.js, tests/unit/operator-bootstrap.test.js,
//   tests/unit/session-idle-timeout.test.js, tests/integration/session-idle-multi-instance.test.js

import prisma from '@/lib/db'
import {
  AUTH_SESSION_COOKIE,
  hashSessionToken,
  SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_LAST_SEEN_THROTTLE_SECONDS,
  verifySessionToken,
} from './auth-service'
import { hasOperatorGrant } from './operator-bootstrap'
import { hasSuperadminGrant } from './superadmin-grant'
import { recordAudit } from '@/modules/project-manager/application/audit'

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
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='))
      } catch {
        // Malformed credentials are unauthenticated, not a session-store outage.
        return null
      }
    }
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
    ...(value.superadminGrant === true ? { superadminGrant: true } : {}),
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    ...(value.expiresAt != null ? { expiresAt: value.expiresAt } : {}),
  }
}

function validDate(value) {
  if (value == null) return null
  try {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
    return Number.isFinite(date.getTime()) ? date : null
  } catch {
    return null
  }
}

async function sessionStoreCall(operation) {
  try {
    return await operation()
  } catch (cause) {
    const error = new Error('SESSION_STORE_UNAVAILABLE')
    error.cause = cause
    throw error
  }
}

/**
 * Provider-neutral request session port.
 */
export function createSessionPort({ readTrustedSession = async () => null, env = process.env, db = prisma, now = () => Date.now() } = {}) {
  return {
    async read(request) {
      const trusted = normalizeTrustedSession(await readTrustedSession(request))
      if (trusted) return trusted

      const sessionCookie = readRequestCookie(request, AUTH_SESSION_COOKIE)
      if (sessionCookie) {
        const nowMs = now()
        const session = verifySessionToken(sessionCookie, { secret: env.ZURI_SESSION_SECRET, now: nowMs })
        if (!session) return { state: 'UNAUTHENTICATED' }

        // Current login tokens carry a session id and must match a live row.
        // Development-only legacy tokens without `sid` remain compatible;
        // production never accepts them.
        let persistedExpiresAt = null
        if (session.sessionId) {
          if (typeof db.session?.findUnique !== 'function') {
            if (env.NODE_ENV === 'production') throw new Error('SESSION_STORE_UNAVAILABLE')
          } else {
            const persisted = await sessionStoreCall(() => db.session.findUnique({ where: { id: session.sessionId } }))
            const live = persisted &&
              persisted.personId === session.principalId &&
              persisted.tokenHash === hashSessionToken(sessionCookie) &&
              persisted.status === 'ACTIVE' &&
              persisted.expiresAt > new Date(nowMs)
            if (!live) return { state: 'UNAUTHENTICATED' }

            const lastSeenAt = validDate(persisted.lastSeenAt)
            const idleLimitSeconds = session.remember
              ? SESSION_IDLE_TIMEOUT_REMEMBER_SECONDS
              : SESSION_IDLE_TIMEOUT_SECONDS
            const idleExpired = !lastSeenAt || nowMs - lastSeenAt.getTime() >= idleLimitSeconds * 1000
            if (idleExpired) {
              if (typeof db.session.updateMany === 'function') {
                await sessionStoreCall(async () => {
                  const revoke = async (tx) => {
                    const result = await tx.session.updateMany({
                      where: { id: session.sessionId, status: 'ACTIVE' },
                      data: {
                        status: 'REVOKED',
                        revokedAt: new Date(nowMs),
                        revokeReason: 'IDLE_TIMEOUT',
                        version: { increment: 1 },
                      },
                    })

                    if (result.count > 0) {
                      await recordAudit(tx, {
                        entityType: 'SESSION',
                        entityId: session.sessionId,
                        action: 'SESSION_REVOKED_IDLE_TIMEOUT',
                        actorType: 'SYSTEM',
                        actorId: null,
                        payload: {
                          reason: 'IDLE_TIMEOUT',
                          personId: session.principalId,
                          revokedCount: 1,
                          remember: session.remember === true,
                        },
                      })
                    }
                  }

                  if (typeof db.$transaction === 'function') {
                    // Audit and revoke commit together; audit failure rolls back and sessionStoreCall preserves the refusal.
                    return db.$transaction(revoke)
                  }
                  if (env.NODE_ENV === 'production') throw new Error('SESSION_STORE_UNAVAILABLE')
                  return revoke(db)
                })
              } else if (env.NODE_ENV === 'production') {
                throw new Error('SESSION_STORE_UNAVAILABLE')
              }
              return { state: 'UNAUTHENTICATED' }
            }

            if (typeof db.session.updateMany === 'function') {
              if (nowMs - lastSeenAt.getTime() >= SESSION_LAST_SEEN_THROTTLE_SECONDS * 1000) {
                await sessionStoreCall(() => db.session.updateMany({
                  where: {
                    id: session.sessionId,
                    status: 'ACTIVE',
                    lastSeenAt: { lt: new Date(nowMs - SESSION_LAST_SEEN_THROTTLE_SECONDS * 1000) },
                  },
                  data: { lastSeenAt: new Date(nowMs) },
                }))
              }
            }
            persistedExpiresAt = persisted.expiresAt
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
          // @req FR-200 — never take this capability from cookie claims or headers.
          ...(await hasSuperadminGrant(session.principalId, db) ? { superadminGrant: true } : {}),
          sessionId: session.sessionId ?? `legacy-${session.issuedAt}-${session.expiresAt}`,
          ...(persistedExpiresAt ? { expiresAt: persistedExpiresAt } : {}),
        }
      }

      return { state: 'UNAUTHENTICATED' }
    },
  }
}
