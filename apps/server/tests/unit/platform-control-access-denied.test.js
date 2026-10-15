import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/access-denied/route'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'

// Match the repository's JSX test harness; Next supplies the JSX runtime in
// production, while Vitest's existing transform uses the classic React global.
globalThis.React = React

const guardMocks = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((location) => {
    throw Object.assign(new Error(`redirect:${location}`), { location })
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error('not found'), { status: 404 })
  }),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [] }),
}))

vi.mock('next/navigation', () => ({
  redirect: guardMocks.redirect,
  notFound: guardMocks.notFound,
  useRouter: () => ({ refresh: guardMocks.refresh }),
}))

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: guardMocks.resolveRequestViewer,
}))

const controlChild = createElement('section', null, 'PRIVATE CONTROL CONTENT')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FR-105 access denied response', () => {
  it('returns a generic final 403 with private caching and crawler refusal', async () => {
    const response = GET()
    const html = await response.text()

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(response.headers.get('Content-Type')).toMatch(/^text\/html; charset=utf-8$/)
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).toContain('<h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>')
    expect(html).toContain('<a href="/login">เข้าสู่ระบบด้วยบัญชีอื่น</a>')
    expect(html).toContain('<a href="/">กลับหน้าหลัก</a>')
  })

  it('does not reflect query parameters or redirect to caller supplied URLs', async () => {
    const supplied = 'https://evil.example/<script>alert(1)</script>'
    const request = new Request(`https://zuri.local/access-denied?next=${encodeURIComponent(supplied)}&message=${encodeURIComponent(supplied)}`)
    const response = GET(request)
    const html = await response.text()

    expect(response.status).toBe(403)
    expect(response.headers.get('Location')).toBeNull()
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('<script>')
    expect([...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])).toEqual(['/login', '/'])
  })
})

describe('FR-105 server control guard response', () => {
  it('sends a missing session to Login', async () => {
    guardMocks.resolveRequestViewer.mockResolvedValueOnce(null)
    await expect((await import('@/components/layouts/PlatformControlGuard')).default({ children: controlChild }))
      .rejects.toMatchObject({ location: '/login' })
  })

  it('sends a real authentication failure to Login', async () => {
    guardMocks.resolveRequestViewer.mockRejectedValueOnce(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    await expect((await import('@/components/layouts/PlatformControlGuard')).default({ children: controlChild }))
      .rejects.toMatchObject({ location: '/login' })
  })

  it('renders the existing retry state on a session-store outage without control content', async () => {
    guardMocks.resolveRequestViewer.mockRejectedValueOnce(Object.assign(new Error('SESSION_UNAVAILABLE'), { status: 503 }))
    const result = await (await import('@/components/layouts/PlatformControlGuard')).default({ children: controlChild })
    const html = renderToStaticMarkup(result)

    expect(html).not.toContain('PRIVATE CONTROL CONTENT')
    expect(guardMocks.redirect).not.toHaveBeenCalled()
  })

  it('redirects a signed-in non-operator to the final 403 page without rendering control content', async () => {
    guardMocks.resolveRequestViewer.mockResolvedValueOnce(makeViewer({ isOperator: false }))
    await expect((await import('@/components/layouts/PlatformControlGuard')).default({ children: controlChild }))
      .rejects.toMatchObject({ location: '/access-denied' })
    expect(guardMocks.notFound).not.toHaveBeenCalled()
  })

  it('continues to render children for an installation Operator', async () => {
    guardMocks.resolveRequestViewer.mockResolvedValueOnce(makeOperatorViewer())
    const result = await (await import('@/components/layouts/PlatformControlGuard')).default({ children: controlChild })

    expect(result).toBe(controlChild)
  })
})
