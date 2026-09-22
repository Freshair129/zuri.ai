// @req FR-094, FR-095 — the authenticated profile exposes the redacted MFA
// state and the entry point for TOTP enrollment.
// @spec ADR-045 D2, D5; ADR-088; ADR-089 D4
// @tested tests/unit/mfa-security-card-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MfaSecurityCard from '@/modules/identity/ui/MfaSecurityCard'

globalThis.React = React

const h = vi.hoisted(() => ({
  factors: [],
  fetched: [],
  reload: vi.fn(),
}))

vi.mock('@/modules/project-manager/components/useApi', () => ({
  api: vi.fn(),
  useFetch: (path) => {
    h.fetched.push(path)
    return { loading: false, error: null, data: { factors: h.factors }, reload: h.reload }
  },
}))

describe('MfaSecurityCard', () => {
  it('loads redacted factor status and exposes enrollment when no factor is active', () => {
    h.factors = []
    h.fetched.length = 0

    const html = renderToStaticMarkup(createElement(MfaSecurityCard))

    expect(h.fetched).toEqual(['/api/auth/mfa/factors'])
    expect(html).toContain('Security &amp; MFA')
    expect(html).toContain('ตั้งค่า Authenticator')
    expect(html).not.toContain('otpauth://')
    expect(html).not.toContain('secret')
  })

  it('renders active status without exposing factor secrets', () => {
    h.factors = [{ id: 'factor-1', type: 'TOTP', label: 'Authenticator App', status: 'ACTIVE' }]

    const html = renderToStaticMarkup(createElement(MfaSecurityCard))

    expect(html).toContain('Authenticator เปิดใช้งานแล้ว')
    expect(html).toContain('พร้อมใช้สำหรับ session step-up')
    expect(html).toContain('เพิ่ม Authenticator')
    expect(html).not.toContain('factor-1')
    expect(html).not.toContain('otpauth://')
  })
})
