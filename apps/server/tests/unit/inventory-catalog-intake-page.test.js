// @req FR-208, FR-209 — the Import tab renders under the scoped provider: with a
//   Business active it shows the Inventory tabs (Import among them), the Excel
//   card with this Business's template link, the JSON card, the LINE hint and
//   the recent-intakes table; with no Business it asks for one and offers no
//   upload. Nothing can be committed before a preview exists.
// @spec SEC-001
// @tested tests/unit/inventory-catalog-intake-page.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import InventoryCatalogIntakePage from '@/app/(pm)/inventory/catalog-intake/page'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children, ...rest }) => createElement('a', { href: typeof href === 'string' ? href : href?.pathname || '', ...rest }, children) }
})
vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory/catalog-intake',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}))
vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const render = (selection = {}) => renderToStaticMarkup(createElement(ScopeProvider, { inventory: sampleInventory(), selection }, createElement(InventoryCatalogIntakePage)))

describe('the Import tab', () => {
  it('offers Excel and JSON intake for the active Business, with nothing to commit yet', () => {
    const html = render({ businessId: 'biz-1' })
    expect(html).toContain('นำเข้าสินค้า')
    expect(html).toMatch(/href="\/inventory\/catalog-intake"[^>]*aria-current="page"/)
    expect(html).toContain('href="/api/inventory/catalog-intakes/template?businessId=biz-1"')
    expect(html).toContain('aria-label="ไฟล์ .xlsx ที่กรอกแล้ว"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*ตรวจไฟล์<\/button>/)
    expect(html).toContain('aria-label="รายการ (JSON)"')
    expect(html).toContain('#sku')
    expect(html).toContain('การนำเข้าล่าสุด')
    expect(html).not.toContain('ยืนยันบันทึกทั้งชุด')
  })

  it('asks for a Business when none is active', () => {
    const html = render()
    expect(html).toContain('เลือก Business ก่อนเพื่อนำเข้าสินค้า')
    expect(html).not.toContain('ดาวน์โหลดแม่แบบ')
  })
})
