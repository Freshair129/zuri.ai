// @req FR-252 — pricing inputs expose units, immutable edits and truthful server previews.
// @spec ADR-097
// @tested tests/unit/pricing-rules-ui.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PricingVariables, PricingFormulas, PricingPreviewInputs, PricingResults, emptyPreviewInput, setAtPath, pricingDiff } from '@/modules/commerce/ui/PricingRulesEditor'
import { defaultPricingRules } from '@/modules/commerce/domain/pricing-rules'
import PricingRulesPage from '@/app/(pm)/commerce/pricing-rules/page'
import PricingCatalogSubmit, { CatalogPriceReview } from '@/modules/commerce/ui/PricingCatalogSubmit'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/commerce/pricing-rules', useSearchParams: () => new URLSearchParams(''), useRouter: () => ({ push() {}, replace() {} }) }))
vi.mock('@/context/ScopeContext', async () => { const { createScopeContextDouble } = await import('../factories/scope-context'); return createScopeContextDouble() })
const render = (component, props) => renderToStaticMarkup(createElement(component, props))

describe('FR-252 pricing console', () => {
  it('does not allow a draft preview to become a Knowledge publication', () => {
    const html = render(PricingCatalogSubmit, { businessId: 'biz-1', activeRule: null })
    expect(html).toContain('ไม่ใช้ตัวเลขทดลองด้านบน')
    expect(html).toContain('เลือกชุดสูตรที่อนุมัติและใช้งานอยู่ก่อนส่งราคาขาย')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>ยืนยันราคาขายและส่งเข้า Knowledge<\/button>/)
    expect(html).not.toContain('สถานะรับเข้าคิว:')
  })
  it('shows the exact ledger-calculated sale prices for explicit review without claiming admission', () => {
    const html = render(CatalogPriceReview, { preview: { ruleVersion: 3, prices: [{ quantity: 100, currency: 'THB', unitPriceSatang: 24550, totalPriceSatang: 2455000 }] } })
    expect(html).toContain('245.50 บาท')
    expect(html).toContain('24,550.00 บาท')
    expect(html).toContain('NOT_SUBMITTED')
    expect(html).not.toContain('ADMITTED')
  })
  it('asks for Business and does not offer a policy editor outside scope', () => {
    const html = render(ScopeProvider, { inventory: sampleInventory(), children: createElement(PricingRulesPage) })
    expect(html).toContain('เลือก Business ก่อนเพื่อจัดการสูตรคำนวณราคา')
    expect(html).not.toContain('ชื่อชุดสูตร')
  })
  it('renders typed editable controls for every supported policy group with explicit units', () => {
    const rules = defaultPricingRules()
    const html = render(PricingVariables, { rules, onChange() {} })
    for (const label of ['THB/CNY', 'THB/USD', 'THB/m³', 'THB/kg', 'กำไรขั้นต่ำตามชนิดสินค้า', 'ระยะเวลาผลิตและส่ง', 'ส่งในประเทศหนึ่งจุด', 'Ladder และกลุ่มลูกค้า']) expect(html).toContain(label)
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('<textarea')
    const readonly = render(PricingVariables, { rules, disabled: true, onChange() {} })
    expect(readonly).toMatch(/^<fieldset disabled=""/)
  })
  it('keeps entered factory cost unverified and empty instead of inventing a product or cost', () => {
    const input = emptyPreviewInput()
    expect(input.factoryUnitCost.amount).toBe('')
    expect(input.carton.cbm).toBe('')
    const html = render(PricingPreviewInputs, { input, onChange() {} })
    expect(html).toContain('ยังไม่ใช่ต้นทุนที่ Procurement ยืนยัน')
    expect(html).toContain('ปริมาตรลัง (m³)')
    expect(html).toContain('อัตราคงที่')
  })
  it('edits a nested variable without changing its immutable source and computes a useful diff', () => {
    const before = defaultPricingRules()
    const after = setAtPath(before, ['fx', 'cnyToThb'], '6.25')
    expect(before.fx.cnyToThb).not.toBe('6.25')
    expect(pricingDiff(before, after)).toEqual([{ key: 'fx.cnyToThb', before: before.fx.cnyToThb, after: '6.25' }])
  })
  it('renders expression input and permitted variables without executing them in the browser', () => {
    const html = render(PricingFormulas, { rules: defaultPricingRules(), onChange() {}, errors: [{ field: 'formulas.0.expression', message: 'Unknown variable' }] })
    expect(html).toContain('aria-label="นิพจน์ candidatePrice"')
    expect(html).toContain('ceilToStep')
    expect(html).toContain('Unknown variable')
  })
  it('shows integer-satang server results and missing comparison truthfully', () => {
    const html = render(PricingResults, { preview: { result: { unitPriceSatang: 12550, totalPriceSatang: 25100, unitLandedCostSatang: 10000, grossProfitSatang: 5100, priceDriver: 'floor', warnings: ['MISSING_WEIGHT'], breakdown: { factoryCostSatang: 1234 } } } })
    expect(html).toContain('125.50 บาท')
    expect(html).toContain('12.34 บาท')
    expect(html).toContain('ยังไม่มีรุ่นใช้งานสำหรับเปรียบเทียบ')
    expect(html).toContain('MISSING_WEIGHT')
  })
})
