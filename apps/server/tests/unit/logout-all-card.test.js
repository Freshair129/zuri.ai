import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LogoutAllCard, { LogoutAllButton, logoutAllClientAction } from '@/modules/identity/ui/LogoutAllCard'

// @req FR-046, FR-095 — profile logout-all uses session-bound CSRF and refuses to redirect on failure.
// @spec ADR-124 D5, SEC-018
// @tested tests/unit/logout-all-card.test.js

globalThis.React = React

describe('LogoutAllCard', () => {
  it('renders the session status and Thai logout-all action', () => {
    const html = renderToStaticMarkup(createElement(LogoutAllCard, { active: true }))

    expect(html).toContain('Sessions')
    expect(html).toContain('อุปกรณ์นี้')
    expect(html).toContain('ออกจากระบบทุกอุปกรณ์')
    expect(html).toContain('type="button"')
  })

  it('disables the logout-all button and shows progress while pending', () => {
    const html = renderToStaticMarkup(createElement(LogoutAllButton, { busy: true, onClick: vi.fn() }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('กำลังออกจากระบบ…')
  })

  it('requests a no-store CSRF token before posting logout-all', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: true })
    const onPending = vi.fn()
    const onError = vi.fn()
    const originalWindow = globalThis.window
    const windowMock = { confirm: vi.fn(() => true), location: { assign: vi.fn() } }
    globalThis.window = windowMock

    let result
    try {
      result = await logoutAllClientAction({ fetchImpl, onPending, onError })
    } finally {
      if (originalWindow === undefined) delete globalThis.window
      else globalThis.window = originalWindow
    }

    expect(result).toBe(true)
    expect(windowMock.confirm).toHaveBeenCalledWith('ต้องการออกจากระบบทุกอุปกรณ์หรือไม่? อุปกรณ์ทั้งหมดจะต้องเข้าสู่ระบบอีกครั้ง')
    expect(windowMock.location.assign).toHaveBeenCalledWith('/login')
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/auth/csrf', { method: 'GET', cache: 'no-store' })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/auth/logout-all', {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf-token' },
    })
    expect(onPending.mock.calls).toEqual([[true], [false]])
    expect(onError).toHaveBeenCalledWith('')
  })

  it('keeps the caller on the page and reports a Thai error after failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'csrf-token' }) })
      .mockResolvedValueOnce({ ok: false })
    const onError = vi.fn()
    const onPending = vi.fn()
    const originalWindow = globalThis.window
    const windowMock = { confirm: vi.fn(() => true), location: { assign: vi.fn() } }
    globalThis.window = windowMock

    let result
    try {
      result = await logoutAllClientAction({ fetchImpl, onPending, onError })
    } finally {
      if (originalWindow === undefined) delete globalThis.window
      else globalThis.window = originalWindow
    }

    expect(result).toBe(false)
    expect(onError).toHaveBeenNthCalledWith(2, 'ออกจากระบบทุกอุปกรณ์ไม่สำเร็จ กรุณาลองอีกครั้ง')
    expect(windowMock.location.assign).not.toHaveBeenCalled()
    expect(onPending.mock.calls).toEqual([[true], [false]])
  })

  it('does not send a request when the user cancels confirmation', async () => {
    const fetchImpl = vi.fn()
    const onPending = vi.fn()
    const originalWindow = globalThis.window
    const windowMock = { confirm: vi.fn(() => false), location: { assign: vi.fn() } }
    globalThis.window = windowMock

    let result
    try {
      result = await logoutAllClientAction({ fetchImpl, onPending })
    } finally {
      if (originalWindow === undefined) delete globalThis.window
      else globalThis.window = originalWindow
    }

    expect(result).toBe(false)
    expect(windowMock.confirm).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(windowMock.location.assign).not.toHaveBeenCalled()
    expect(onPending).not.toHaveBeenCalled()
  })
})
