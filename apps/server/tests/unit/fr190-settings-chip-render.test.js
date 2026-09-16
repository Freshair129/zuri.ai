// @req FR-190 — the settings page that carries the transport chip still mounts
//   and renders. Rendered, not grepped: a wrong import path or a mistyped prop
//   is exactly what a source-text assertion cannot see (the lesson of
//   D1-shell-domain-layers-01).
// @spec ADR-061, SDD-018
// @tested tests/unit/fr190-settings-chip-render.test.js
//
// react-dom/server runs no effects, so the account list is empty here and the
// chip's own wording never reaches the markup. What this pins is that the page
// compiles with the presenter imported and mounts inside a real scope value.
// What each chip says is pinned by fr190-transport-health-presentation.test.js,
// and what the endpoint returns by fr190-line-transport-health.test.js.
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import LineStudioSettings from '@/modules/line-oa-studio/ui/LineStudioSettings'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

// esbuild's classic JSX runtime emits a bare React.createElement.
globalThis.React = React

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/line-oa/settings',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

function renderSettings(selection) {
  return renderToStaticMarkup(
    createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection },
      createElement(LineStudioSettings),
    ),
  )
}

describe('LINE OA settings renders with the transport chip wired in', () => {
  it('mounts for a chosen Business and shows the empty-account state', () => {
    const markup = renderSettings({ businessId: 'biz-1' })
    expect(markup).toContain('สถานะบัญชี LINE OA')
    expect(markup).toContain('ยังไม่มีบัญชี LINE OA')
    expect(markup).not.toContain('undefined')
  })

  it('asks for a Business before anything else when none is chosen', () => {
    const markup = renderSettings({})
    expect(markup).toContain('เลือก Business')
  })
})
