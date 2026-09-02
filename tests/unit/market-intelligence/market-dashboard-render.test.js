// @req FR-092 — the "แปลข้อมูลจากแหล่งภายนอก" translation trigger button renders only
// for a viewer who owns the active Business, derived the same way
// overview/page.jsx and customer/conversations/page.jsx already gate their own
// owner-only controls: `viewer.ownedBusinessIds` from `/api/viewer`, never the global
// `viewer.role` label. Rendered with `react-dom/server` (no DOM needed) — the same
// harness tests/unit/sot-pipeline-scope-render.test.js uses.
// @spec SDD-049, BR-001, SEC-001, ADR-038
// @tested tests/unit/market-intelligence/market-dashboard-render.test.js

import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import MarketDashboard from '@/modules/market-intelligence/components/MarketDashboard'
import { sampleInventory } from '../../factories/scope-context'
import { makeViewer, ownsElsewhere } from '../../factories/viewer'

// esbuild's classic JSX runtime emits a bare React.createElement for any JSX this file
// itself evaluates transitively — see tests/unit/sot-pipeline-scope-render.test.js.
globalThis.React = React

const h = vi.hoisted(() => ({ fetched: [] }))

function fetchState(data) {
  return { data, loading: false, error: null, reload: () => {} }
}

let viewerData
let observationsData

vi.mock('@/modules/project-manager/components/useApi', async () => {
  const { createElement } = await import('react')
  return {
    api: vi.fn(async () => ({ translated: 0, unchanged: 0, failed: [] })),
    LoadingCard: () => createElement('div', { role: 'status' }, 'Loading…'),
    useFetch: (path) => {
      h.fetched.push(path)
      if (path === '/api/viewer') return fetchState(viewerData)
      if (path && path.startsWith('/api/market/observations')) return fetchState(observationsData)
      return fetchState(null)
    },
  }
})

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../../factories/scope-context')
  return createScopeContextDouble()
})

const { ScopeProvider } = await import('@/context/ScopeContext')

function render({ owner }) {
  h.fetched.length = 0
  // @tested tests/factories/viewer.js — the resolved-viewer shape `/api/viewer`
  // serializes over the wire, built the sanctioned way rather than by hand
  // (docs/decisions and CLAUDE.md both require it: a hand-built `{ role, … }`
  // literal is exactly the shape that hid three authorization holes before).
  viewerData = owner
    ? makeViewer({ visibleBusinessIds: ['biz-1'], ownedBusinessIds: ['biz-1'] })
    : makeViewer({ visibleBusinessIds: ['biz-1'], ownedBusinessIds: [] })
  observationsData = {
    version: '1.0',
    observations: [],
    counts: { observations: 0, providers: 0, byResolutionStatus: {} },
    limit: 50,
    truncated: false,
  }
  return renderToStaticMarkup(
    createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(MarketDashboard),
    ),
  )
}

describe('MarketDashboard translation trigger button (FR-092)', () => {
  it('renders the button for a viewer who owns the active Business', () => {
    const html = render({ owner: true })

    expect(html).toContain('แปลข้อมูลจากแหล่งภายนอก')
  })

  it('does not render the button for a viewer who only sees the Business', () => {
    const html = render({ owner: false })

    expect(html).not.toContain('แปลข้อมูลจากแหล่งภายนอก')
  })

  it('reads ownership from ownedBusinessIds, never from the global role label', () => {
    // The FR-059 authorization RCA shape: role is the global OWNER label (true because
    // this principal owns SOME Business), but not this one — `ownsElsewhere()` is the
    // sanctioned factory for exactly this attacker/edge shape.
    h.fetched.length = 0
    viewerData = ownsElsewhere({ owns: 'biz-owned-elsewhere', sees: 'biz-1' })
    observationsData = { observations: [], counts: { observations: 0, providers: 0, byResolutionStatus: {} }, truncated: false }

    const html = renderToStaticMarkup(
      createElement(
        ScopeProvider,
        { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
        createElement(MarketDashboard),
      ),
    )

    expect(html).not.toContain('แปลข้อมูลจากแหล่งภายนอก')
  })
})
