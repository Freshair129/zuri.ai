// @req FR-203, FR-204 — the SKU detail page renders under the scoped provider:
//   with a Business active it shows the Inventory tab strip, the identifier desk
//   (all five kinds offered, GTIN first) and the unit-conversion desk, both
//   disabled until the SKU has loaded; without a Business it asks for one. The
//   dashboard shows the lookup box that resolves a code before anything is
//   created. The real components are rendered (react-dom/server), so a field
//   the provider does not expose fails here the way it fails in the browser.
// @spec SEC-001
// @tested tests/unit/inventory-product-page.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import InventoryProductPage from '@/app/(pm)/inventory/products/[productId]/page'
import InventoryPage from '@/app/(pm)/inventory/page'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children, ...rest }) => createElement('a', { href: typeof href === 'string' ? href : href?.pathname || '', ...rest }, children) }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory/products/prod-1',
  useParams: () => ({ productId: 'prod-1' }),
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

describe('the SKU detail page', () => {
  it('renders both desks, disabled until the SKU loads, under the Inventory tabs', () => {
    const html = render(InventoryProductPage, { selection: { businessId: 'biz-1' } })
    expect(html).toContain('href="/inventory/hygiene"')
    expect(html).toContain('href="/inventory"')
    expect(html).toContain('กลับไปคลังสินค้า')
    expect(html).toContain('บาร์โค้ด / รหัสคู่ค้า')
    expect(html).toContain('หน่วยแปลง')
    for (const kind of ['GTIN', 'BARCODE', 'SUPPLIER_CODE', 'MANUFACTURER_PART', 'LEGACY_CODE']) {
      expect(html).toMatch(new RegExp(`<option value="${kind}"`))
    }
    expect(html).toMatch(/<option value="GTIN"[^>]*selected/)
    // Nothing is writable before the SKU (and so its Business and nature) is known.
    expect(html).toMatch(/<fieldset disabled=""/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>เพิ่มรหัส<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>เพิ่มหน่วยแปลง<\/button>/)
    expect(html).not.toContain('เลือก Business ก่อน')
  })

  it('asks for a Business when none is active and offers no desk', () => {
    const html = render(InventoryProductPage)
    expect(html).toContain('เลือก Business ก่อนเพื่อดู SKU')
    expect(html).not.toContain('เพิ่มรหัส')
  })
})

describe('the dashboard lookup', () => {
  it('offers resolve-before-create for the active Business', () => {
    const html = render(InventoryPage, { selection: { businessId: 'biz-1' } })
    expect(html).toContain('ค้นหา SKU ด้วยรหัส')
    expect(html).toContain('aria-label="บาร์โค้ดหรือรหัส"')
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
  })
})
