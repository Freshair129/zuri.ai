// @req FR-206 — the SKU hygiene page renders under the scoped provider: with a
//   Business active it shows the tab strip (with its own tab), the lifecycle
//   form and the replenishment card; without one it asks for a Business. The
//   real component is rendered (react-dom/server), so a field the provider
//   does not expose fails here the way it fails in the browser.
// @req FR-201 — the dashboard's SKU form narrows by the master's nature: with a
//   SERVICE master selected the stock-policy select is gone and the note says
//   why; with a GOOD master that declares axes there is one field per axis.
// @spec SEC-001
// @tested tests/unit/inventory-hygiene-page.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import InventoryHygienePage from '@/app/(pm)/inventory/hygiene/page'
import InventoryPage from '@/app/(pm)/inventory/page'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children, ...rest }) => createElement('a', { href: typeof href === 'string' ? href : href?.pathname || '', ...rest }, children) }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory/hygiene',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

function render(Page, { selection = {} } = {}) {
  return renderToStaticMarkup(createElement(ScopeProvider, { inventory: sampleInventory(), selection }, createElement(Page)))
}

describe('the SKU hygiene tab', () => {
  it('renders the report frame, the lifecycle form and the replenishment card for the active Business', () => {
    const html = render(InventoryHygienePage, { selection: { businessId: 'biz-1' } })
    expect(html).toContain('SKU Hygiene')
    expect(html).toContain('href="/inventory/hygiene"')
    expect(html).toContain('href="/inventory/stocktakes"')
    expect(html).toContain('จัดการวงจรชีวิต SKU')
    expect(html).toContain('รวมเข้ากับ SKU อื่น (MERGE)')
    expect(html).toContain('ควรสั่งซื้อ')
    expect(html).toContain('Alpha Co')
    expect(html).not.toContain('เลือก Business ก่อน')
  })

  it('asks for a Business when none is active', () => {
    const html = render(InventoryHygienePage)
    expect(html).toContain('เลือก Business ก่อน')
    expect(html).not.toContain('Alpha Co')
  })
})

describe('the dashboard SKU form narrows by nature', () => {
  it('offers counted or uncounted for a good, never a service, before any master is loaded', () => {
    const html = render(InventoryPage, { selection: { businessId: 'biz-1' } })
    expect(html).toContain('นโยบายสต๊อก')
    // React marks the controlled selection with `selected=""`, so match the value alone.
    expect(html).toMatch(/<option value="TRACKED"[^>]*>นับสต๊อก/)
    expect(html).toMatch(/<option value="UNTRACKED"[^>]*>ไม่นับสต๊อก/)
    // The master form offers บริการ (service) as a nature; the SKU policy select never offers it.
    expect(html).not.toMatch(/<option value="SERVICE"[^>]*>บริการ<\/option>/)
    expect(html).toMatch(/<option value="SERVICE"[^>]*>บริการ \(service\)<\/option>/)
    expect(html).toContain('ประเภทสินค้าหลัก')
    expect(html).toContain('แกน variant')
  })
})
