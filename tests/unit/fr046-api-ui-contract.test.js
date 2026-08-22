import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-046 — Business Routing uses one protected entry response.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const filesUnder = (path) => readdirSync(path).flatMap((name) => {
  const child = resolve(path, name)
  return statSync(child).isDirectory() ? filesUnder(child) : [child]
})

describe('FR-046 API and UI boundary', () => {
  it('exposes the additive entry route through the request-viewer seam', () => {
    const route = read('src/app/api/entry/route.js')
    expect(route).toContain('resolveRequestViewer(request)')
    expect(route).toContain('buildViewerEntry')
  })

  it('uses one entry fetch and no broad scope/viewer fetch on Business Routing', () => {
    const page = read('src/app/(entry)/businesses/page.jsx')
    expect(page).toContain("useFetch('/api/entry')")
    expect(page).not.toContain("useFetch('/api/scope')")
    expect(page).not.toContain("useFetch('/api/viewer')")

    const scopeContext = read('src/context/ScopeContext.jsx')
    expect(scopeContext).toContain("ENTRY_PATHS.has(pathname)")
    expect(scopeContext).toContain('if (ENTRY_PATHS.has(pathname))')
  })

  it('issues the session cookie through explicit server session routes', () => {
    const login = read('src/app/login/page.jsx')
    const loginRoute = read('src/app/api/auth/login/route.js')
    const sessionPort = read('src/modules/identity/session-port.js')
    expect(login).toContain('action="/api/auth/login"')
    expect(loginRoute).toContain('AUTH_SESSION_COOKIE')
    expect(sessionPort).toContain('verifySessionToken')
    expect(sessionPort).not.toContain('ZURI_LOCAL_DEMO_AUTH')
    expect(sessionPort).not.toContain('LOCAL_DEMO_COOKIE')
    expect(loginRoute).toContain('httpOnly: true')
  })

  it('has no API route that calls the pure viewer resolver without request identity', () => {
    const offenders = filesUnder(resolve(process.cwd(), 'src/app/api'))
      .filter((path) => path.endsWith('route.js'))
      .filter((path) => readFileSync(path, 'utf8').includes("from '@/modules/identity/resolve-viewer'"))
    expect(offenders).toEqual([])
  })

  it('passes request identity into the profile and platform permission services', () => {
    for (const path of ['src/app/api/profile/route.js', 'src/app/api/platform/users/route.js']) {
      const route = read(path)
      expect(route).toContain('resolveRequestViewer(request)')
      expect(route).toContain('resolve:')
    }
  })
})
