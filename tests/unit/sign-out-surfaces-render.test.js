// @req FR-046, FR-095 — a sign-out control now exists on every shell that can
// hold a signed-in person. These tests render the real components
// (react-dom/server — no DOM needed, the sanctioned pattern from
// tests/unit/sot-pipeline-scope-render.test.js) rather than grepping source
// text, so a control wired into a branch the real tree never reaches — or one
// pasted into a comment — would fail here the way it fails in the browser.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out-surfaces-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import Topbar from '@/components/layouts/Topbar'
import PlatformControlShell from '@/components/layouts/PlatformControlShell'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

// esbuild's classic JSX runtime emits a bare React.createElement — see
// tests/unit/global-view-drilldown.test.js for why this is set here.
globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children, ...rest }) =>
      createElement('a', { href: typeof href === 'string' ? href : href?.pathname || '', ...rest }, children),
  }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/overview',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const SIGN_OUT_LABEL = 'ออกจากระบบ'

describe('FR-046/FR-095 sign-out control renders on every signed-in shell', () => {
  it('BusinessShell chrome (Topbar) offers sign-out next to the profile link', () => {
    const html = renderToStaticMarkup(
      createElement(
        ScopeProvider,
        { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
        createElement(Topbar, { onOpenPalette: () => {} })
      )
    )
    expect(html).toContain(SIGN_OUT_LABEL)
    expect(html).toContain('My profile')
    // Both controls are real interactive buttons/links, not dead markup.
    expect(html).toMatch(/aria-label="ออกจากระบบ"[^>]*>/)
  })

  it('PlatformControlShell (operator surface, /control/**) offers sign-out alongside the way back to Business', () => {
    const html = renderToStaticMarkup(
      createElement(PlatformControlShell, {}, createElement('p', null, 'roadmap content'))
    )
    expect(html).toContain(SIGN_OUT_LABEL)
    expect(html).toContain('กลับสู่ Business')
    expect(html).toContain('roadmap content')
  })

  it('BusinessRoutingShell (the shared pre-shell for /businesses, /waiting-room, /workspace-home, /onboarding/profile) offers sign-out', () => {
    const html = renderToStaticMarkup(
      createElement(BusinessRoutingShell, {}, createElement('p', null, 'routing content'))
    )
    expect(html).toContain(SIGN_OUT_LABEL)
    expect(html).toContain('routing content')
    expect(html).toContain('data-shell="business-routing"')
  })
})
