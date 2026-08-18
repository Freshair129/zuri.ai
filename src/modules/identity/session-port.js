// @req FR-046 — request identity comes from a server-owned session adapter.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-port.test.js

export const LOCAL_DEMO_COOKIE = 'zuri_local_demo_session'

// @req FR-046 — the pre-session demo bootstrap is a server-owned capability,
// available only in an explicitly enabled non-production environment.
// @spec ADR-017, SDD-024, SEC-008
export function requireTrustedLocalDemo({ env = process.env } = {}) {
  if (env.NODE_ENV !== 'production' && env.ZURI_LOCAL_DEMO_AUTH === '1') return

  throw new Error('LOCAL_DEMO_NOT_ALLOWED')
}

function cookieValue(request, name) {
  const header = request?.headers?.get?.('cookie') || ''
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
    localDemo: false,
  }
}

/**
 * Provider-neutral request session port. A future LINE/OIDC/passwordless adapter may
 * supply `readTrustedSession`; client headers/body/query values are never inspected.
 */
export function createSessionPort({ readTrustedSession = async () => null, env = process.env } = {}) {
  return {
    async read(request) {
      const trusted = normalizeTrustedSession(await readTrustedSession(request))
      if (trusted) return trusted

      const demoAllowed = env.NODE_ENV !== 'production' && env.ZURI_LOCAL_DEMO_AUTH === '1'
      if (demoAllowed && cookieValue(request, LOCAL_DEMO_COOKIE) === 'enabled') {
        return {
          state: 'AUTHENTICATED',
          principalId: null,
          platformGrant: false,
          sessionId: 'local-demo',
          localDemo: true,
        }
      }

      return { state: 'UNAUTHENTICATED' }
    },
  }
}
