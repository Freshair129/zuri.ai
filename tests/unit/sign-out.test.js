import { describe, expect, it, vi } from 'vitest'
import {
  buildSignOutRequest,
  performSignOut,
  resolveSignOutRedirect,
  SIGN_OUT_REDIRECT_PATH,
  SIGN_OUT_SESSION_WARNING_TH,
} from '@/modules/identity/sign-out'

// @req FR-046, FR-095 — one pure module every sign-out control calls, instead
// of four hand-written fetch-then-redirect copies.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out.test.js

describe('buildSignOutRequest', () => {
  it('always posts to the one logout route', () => {
    expect(buildSignOutRequest()).toEqual({ path: '/api/auth/logout', method: 'POST' })
  })
})

describe('resolveSignOutRedirect', () => {
  it('always sends the person to /login', () => {
    expect(resolveSignOutRedirect({ ok: true }).path).toBe(SIGN_OUT_REDIRECT_PATH)
    expect(resolveSignOutRedirect({ ok: false }).path).toBe(SIGN_OUT_REDIRECT_PATH)
    expect(resolveSignOutRedirect(null).path).toBe(SIGN_OUT_REDIRECT_PATH)
  })

  it('carries no warning when the server confirmed the revoke', () => {
    expect(resolveSignOutRedirect({ ok: true }).warning).toBeNull()
  })

  it('surfaces a Thai warning — never silently drops — when the server did not confirm', () => {
    expect(resolveSignOutRedirect({ ok: false }).warning).toBe(SIGN_OUT_SESSION_WARNING_TH)
    expect(resolveSignOutRedirect(null).warning).toBe(SIGN_OUT_SESSION_WARNING_TH)
    expect(resolveSignOutRedirect(undefined).warning).toBe(SIGN_OUT_SESSION_WARNING_TH)
  })
})

describe('performSignOut', () => {
  it('posts to /api/auth/logout and redirects with no warning on success', async () => {
    const fetchImpl = vi.fn(async (path, init) => {
      expect(path).toBe('/api/auth/logout')
      expect(init).toEqual({ method: 'POST' })
      return { ok: true, json: async () => ({ success: true }) }
    })
    const result = await performSignOut(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ path: '/login', warning: null })
  })

  // The route's own 503 path (session store unavailable) still clears the
  // cookie — read src/app/api/auth/logout/route.js — so the person must still
  // end up redirected, just told the server-side revoke may not have happened.
  it('still redirects on the route\'s 503 path, but with the warning surfaced', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'AUTH_UNAVAILABLE' }),
    }))
    const result = await performSignOut(fetchImpl)
    expect(result).toEqual({ path: '/login', warning: SIGN_OUT_SESSION_WARNING_TH })
  })

  it('still redirects when the network request itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await performSignOut(fetchImpl)
    expect(result).toEqual({ path: '/login', warning: SIGN_OUT_SESSION_WARNING_TH })
  })

  it('still redirects when the response body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input') },
    }))
    const result = await performSignOut(fetchImpl)
    expect(result).toEqual({ path: '/login', warning: SIGN_OUT_SESSION_WARNING_TH })
  })

  it('defaults to the global fetch when no implementation is supplied', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
    try {
      const result = await performSignOut()
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
      expect(result).toEqual({ path: '/login', warning: null })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
