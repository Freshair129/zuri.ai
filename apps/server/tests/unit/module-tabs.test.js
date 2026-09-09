// @req FR-170 — a sub-domain module with multiple pages renders them as
//   in-canvas tabs, active tab derived from the URL (`usePathname()`), never
//   from separate component state — the "id binding" the owner asked for.
// @spec ADR-069
// @tested tests/unit/module-tabs.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ModuleTabs } from '@/components/ui'
import { COMMERCE_TABS, PROCUREMENT_TABS } from '@/lib/module-tabs'

// esbuild's classic JSX runtime emits a bare React.createElement — see
// tests/unit/global-view-drilldown.test.js for why this is set here.
globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
  }
})

let currentPath = '/procurement'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}))

describe("ModuleTabs — the in-canvas view switcher", () => {
  it('renders one link per tab, pointing at that tab\'s real route', () => {
    currentPath = '/procurement'
    const html = renderToStaticMarkup(createElement(ModuleTabs, { tabs: PROCUREMENT_TABS }))
    expect(html).toContain('href="/procurement"')
    expect(html).toContain('href="/procurement/purchase-orders"')
    expect(html).toContain('Dashboard')
    expect(html).toContain('Purchase Orders')
  })

  it('marks the tab matching the current path active, via aria-current — not local state', () => {
    currentPath = '/procurement/purchase-orders'
    const html = renderToStaticMarkup(createElement(ModuleTabs, { tabs: PROCUREMENT_TABS }))
    const purchaseOrdersLink = html.match(/<a href="\/procurement\/purchase-orders"[^>]*>/)[0]
    const dashboardLink = html.match(/<a href="\/procurement"[^>]*>/)[0]
    expect(purchaseOrdersLink).toContain('aria-current="page"')
    expect(dashboardLink).not.toContain('aria-current')
  })

  it('no tab is active when the path matches neither — never a false positive', () => {
    currentPath = '/somewhere-else'
    const html = renderToStaticMarkup(createElement(ModuleTabs, { tabs: PROCUREMENT_TABS }))
    expect(html).not.toContain('aria-current')
  })

  it('the Commerce (Order Management) tab list names Dashboard and Orders', () => {
    currentPath = '/commerce/orders'
    const html = renderToStaticMarkup(createElement(ModuleTabs, { tabs: COMMERCE_TABS }))
    expect(html).toContain('href="/commerce"')
    expect(html).toContain('href="/commerce/orders"')
    expect(html.match(/<a href="\/commerce\/orders"[^>]*>/)[0]).toContain('aria-current="page"')
  })
})
