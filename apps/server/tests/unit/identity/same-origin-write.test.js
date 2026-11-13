import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { config, middleware } from '@/middleware.js'
import {
  CROSS_ORIGIN_WRITE_ALLOWLIST,
  SAME_ORIGIN_WRITE_METHODS,
  evaluateSameOriginWrite,
  matchesCrossOriginWriteAllowlist,
  validateAllowlist,
} from '@/modules/identity/same-origin-write'

// @req FR-252 — every API write rejects cross-origin browser requests before route handling.
// @spec ADR-097
// @tested tests/unit/identity/same-origin-write.test.js

const configuredEnv = { PUBLIC_BASE_URL: 'https://zuri.example' }

function evaluate({
  method = 'POST',
  pathname = '/api/auth/login',
  origin,
  host = 'zuri.example',
  forwardedHost,
  forwardedProto,
  secFetchSite,
  env = configuredEnv,
  allowlist,
} = {}) {
  const headers = new Headers()
  if (origin !== undefined) headers.set('origin', origin)
  if (host !== undefined) headers.set('host', host)
  if (forwardedHost !== undefined) headers.set('x-forwarded-host', forwardedHost)
  if (forwardedProto !== undefined) headers.set('x-forwarded-proto', forwardedProto)
  if (secFetchSite !== undefined) headers.set('sec-fetch-site', secFetchSite)
  return evaluateSameOriginWrite({ method, pathname, headers, env, ...(allowlist ? { allowlist } : {}) })
}

describe('same-origin API write guard', () => {
  it('publishes only the four write methods and has no cross-origin exceptions today', () => {
    expect(SAME_ORIGIN_WRITE_METHODS).toEqual(['POST', 'PUT', 'PATCH', 'DELETE'])
    expect(CROSS_ORIGIN_WRITE_ALLOWLIST).toEqual([])
  })

  it('accepts the configured public origin using public-base-url resolution semantics', () => {
    expect(evaluate({ origin: 'https://zuri.example' })).toEqual({ allowed: true })
    expect(evaluate({ origin: 'https://zuri.example', env: { NEXT_PUBLIC_APP_URL: 'https://zuri.example/app' } }))
      .toEqual({ allowed: true })
  })

  it.each([
    ['unset public URL', {}],
    ['different public URL', { PUBLIC_BASE_URL: 'https://configured.example' }],
  ])('accepts the request host when the public URL is %s', (_label, env) => {
    expect(evaluate({
      origin: 'https://e2e.example:3101',
      host: 'e2e.example:3101',
      env,
    })).toEqual({ allowed: true })
  })

  it('requires the configured public-origin scheme when falling back to the request host', () => {
    const env = { PUBLIC_BASE_URL: 'https://app.example' }

    expect(evaluate({ origin: 'http://app.example', host: 'app.example', env })).toEqual({
      allowed: false,
      status: 403,
      code: 'CSRF_INVALID',
    })
    expect(evaluate({ origin: 'https://app.example', host: 'app.example', env })).toEqual({ allowed: true })
  })

  it('uses the configured scheme while allowing a worktree host port to differ', () => {
    const env = { PUBLIC_BASE_URL: 'http://localhost:3100' }

    expect(evaluate({ origin: 'http://localhost:3101', host: 'localhost:3101', env }))
      .toEqual({ allowed: true })
    expect(evaluate({ origin: 'https://localhost:3101', host: 'localhost:3101', env })).toEqual({
      allowed: false,
      status: 403,
      code: 'CSRF_INVALID',
    })
  })

  it('uses the first forwarded protocol when no public URL is configured', () => {
    expect(evaluate({ origin: 'http://h', host: 'h', env: {}, forwardedProto: 'https, http' }))
      .toMatchObject({ allowed: false, status: 403, code: 'CSRF_INVALID' })
    expect(evaluate({ origin: 'https://h', host: 'h', env: {}, forwardedProto: 'https, http' }))
      .toEqual({ allowed: true })
  })

  it('treats an unsupported first forwarded protocol as absent', () => {
    expect(evaluate({ origin: 'http://h', host: 'h', env: {}, forwardedProto: 'ftp, https' }))
      .toEqual({ allowed: true })
  })

  it.each(['http', 'https'])('allows either scheme without a configured or forwarded protocol (%s)', (scheme) => {
    expect(evaluate({ origin: `${scheme}://h`, host: 'h', env: {} })).toEqual({ allowed: true })
  })

  it('uses the first forwarded host value for deployments behind a proxy', () => {
    expect(evaluate({
      origin: 'https://e2e.example:3101',
      host: 'internal-proxy:8080',
      forwardedHost: 'e2e.example:3101, internal-proxy:8080',
      env: { PUBLIC_BASE_URL: 'https://configured.example' },
    })).toEqual({ allowed: true })
  })

  it.each(SAME_ORIGIN_WRITE_METHODS)('refuses a cross-origin %s', (method) => {
    expect(evaluate({ method, origin: 'https://attacker.invalid' })).toEqual({
      allowed: false,
      status: 403,
      code: 'CSRF_INVALID',
    })
  })

  it.each(['null', ''])('refuses an invalid Origin value %j', (origin) => {
    expect(evaluate({ origin })).toMatchObject({ allowed: false, status: 403, code: 'CSRF_INVALID' })
  })

  it('allows non-browser clients when Origin and Sec-Fetch-Site are absent', () => {
    expect(evaluate({ origin: undefined, secFetchSite: undefined })).toEqual({ allowed: true })
  })

  it.each(['cross-site', 'same-site'])('refuses an Origin-less request marked %s', (secFetchSite) => {
    expect(evaluate({ origin: undefined, secFetchSite })).toMatchObject({
      allowed: false,
      status: 403,
      code: 'CSRF_INVALID',
    })
  })

  it.each(['same-origin', 'none'])('allows an Origin-less request marked %s', (secFetchSite) => {
    expect(evaluate({ origin: undefined, secFetchSite })).toEqual({ allowed: true })
  })

  it('does not apply the write guard to GET, even with a hostile Origin', () => {
    expect(evaluate({ method: 'GET', origin: 'https://attacker.invalid' })).toEqual({ allowed: true })
  })

  it('lets a validated bearer or signature allowlist entry bypass the Origin check', () => {
    const entry = {
      pattern: '/api/signed-webhook',
      reason: 'This webhook authenticates with a request signature and never uses cookies.',
    }
    const originalLength = CROSS_ORIGIN_WRITE_ALLOWLIST.length
    CROSS_ORIGIN_WRITE_ALLOWLIST.push(entry)
    try {
      expect(matchesCrossOriginWriteAllowlist('/api/signed-webhook/events')).toBe(true)
      expect(evaluate({ pathname: '/api/signed-webhook/events', origin: 'https://attacker.invalid' }))
        .toEqual({ allowed: true })
    } finally {
      CROSS_ORIGIN_WRITE_ALLOWLIST.splice(originalLength)
    }
    expect(CROSS_ORIGIN_WRITE_ALLOWLIST).toEqual([])
  })

  it('rejects allowlist entries without a reason or without cookie-free bearer/signature auth', () => {
    expect(() => validateAllowlist([{ pattern: '/api/hook' }])).toThrow(/reason/i)
    expect(() => validateAllowlist([{
      pattern: '/api/hook',
      reason: 'This route authenticates with cookies.',
    }])).toThrow(/bearer|signature|cookie/i)
  })

  it('returns only the redacted refusal contract', () => {
    const result = evaluate({ origin: 'https://secret-attacker.invalid' })
    expect(result).toEqual({ allowed: false, status: 403, code: 'CSRF_INVALID' })
    expect(JSON.stringify(result)).not.toContain('secret-attacker.invalid')
  })
})

describe('Next middleware integration', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://zuri.example')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the typed no-store refusal for a cross-site login POST', async () => {
    const response = await middleware(new NextRequest('https://zuri.example/api/auth/login', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.invalid',
        'sec-fetch-site': 'cross-site',
        host: 'zuri.example',
      },
    }))

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/i)
    expect(await response.json()).toMatchObject({
      code: 'CSRF_INVALID',
      message: 'CSRF validation failed.',
      requestId: expect.any(String),
      retryable: false,
    })
  })

  it('passes same-origin and bearer requests to route handling', async () => {
    const sameOrigin = await middleware(new NextRequest('https://zuri.example/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://zuri.example', host: 'zuri.example' },
    }))
    const bearer = await middleware(new NextRequest('https://zuri.example/api/line-oa/worker', {
      method: 'POST',
      headers: { authorization: 'Bearer worker-token', host: 'zuri.example' },
    }))

    expect(sameOrigin.headers.get('x-middleware-next')).toBe('1')
    expect(bearer.headers.get('x-middleware-next')).toBe('1')
  })

  it('matches /api and its nested routes', () => {
    const matchers = Array.isArray(config.matcher) ? config.matcher : [config.matcher]
    const covers = (pathname) => matchers.some((matcher) => {
      if (typeof matcher !== 'string') return false
      if (matcher === '/api/:path*') return pathname === '/api' || pathname.startsWith('/api/')
      return pathname === matcher
    })

    expect(config.runtime).toBe('nodejs')
    expect(covers('/api')).toBe(true)
    expect(covers('/api/auth/login')).toBe(true)
  })
})
