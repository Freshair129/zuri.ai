// @req FR-142 — the public origin comes from PUBLIC_BASE_URL at run time, falls
// back to the build-time NEXT_PUBLIC_APP_URL and then to the development default;
// a Vercel hostname is never assumed anywhere.
// @spec ADR-058
// @tested tests/unit/public-base-url.test.js
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PUBLIC_BASE_URL,
  LINE_WEBHOOK_PATH,
  lineWebhookUrl,
  resolveBrowserOrigin,
  resolvePublicBaseUrl,
} from '@/lib/public-base-url'

describe('resolvePublicBaseUrl', () => {
  it('prefers PUBLIC_BASE_URL over NEXT_PUBLIC_APP_URL over the default', () => {
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'https://my-zuri.ngrok-free.app', NEXT_PUBLIC_APP_URL: 'http://localhost:4000' }))
      .toBe('https://my-zuri.ngrok-free.app')
    expect(resolvePublicBaseUrl({ NEXT_PUBLIC_APP_URL: 'http://localhost:4000' })).toBe('http://localhost:4000')
    expect(resolvePublicBaseUrl({})).toBe(DEFAULT_PUBLIC_BASE_URL)
    expect(resolvePublicBaseUrl(undefined)).toBe(DEFAULT_PUBLIC_BASE_URL)
  })

  it('reduces the value to an origin: no trailing slash, path or query survives', () => {
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'https://my-zuri.ngrok-free.app/' })).toBe('https://my-zuri.ngrok-free.app')
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'https://my-zuri.ngrok-free.app/api?x=1#y' })).toBe('https://my-zuri.ngrok-free.app')
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: '  http://localhost:3000  ' })).toBe('http://localhost:3000')
  })

  it('treats an empty, unparsable or non-HTTP value as unset', () => {
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: '' })).toBe(DEFAULT_PUBLIC_BASE_URL)
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'my-zuri.ngrok-free.app' })).toBe(DEFAULT_PUBLIC_BASE_URL)
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'ftp://files.example' })).toBe(DEFAULT_PUBLIC_BASE_URL)
    expect(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'javascript:alert(1)' })).toBe(DEFAULT_PUBLIC_BASE_URL)
  })

  it('never contains a Vercel hostname by default', () => {
    expect(resolvePublicBaseUrl({})).not.toMatch(/vercel/i)
  })
})

describe('resolveBrowserOrigin', () => {
  it('uses the origin the page was actually served from when a window exists', () => {
    expect(resolveBrowserOrigin({ location: { origin: 'https://my-zuri.ngrok-free.app' }, env: { PUBLIC_BASE_URL: 'http://localhost:3000' } }))
      .toBe('https://my-zuri.ngrok-free.app')
  })

  it('falls back to the environment during server rendering', () => {
    expect(resolveBrowserOrigin({ env: { NEXT_PUBLIC_APP_URL: 'http://localhost:4000' } })).toBe('http://localhost:4000')
    expect(resolveBrowserOrigin({ location: { origin: 'null' }, env: {} })).toBe(DEFAULT_PUBLIC_BASE_URL)
  })
})

describe('lineWebhookUrl', () => {
  it('appends the one real webhook path to the origin', () => {
    expect(LINE_WEBHOOK_PATH).toBe('/api/agent/line-webhook')
    expect(lineWebhookUrl('https://my-zuri.ngrok-free.app')).toBe('https://my-zuri.ngrok-free.app/api/agent/line-webhook')
    expect(lineWebhookUrl('https://my-zuri.ngrok-free.app/')).toBe('https://my-zuri.ngrok-free.app/api/agent/line-webhook')
    expect(lineWebhookUrl(undefined)).toBe(`${DEFAULT_PUBLIC_BASE_URL}/api/agent/line-webhook`)
  })
})
