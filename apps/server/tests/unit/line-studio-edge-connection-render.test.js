// @req FR-144, FR-146 — the Edge Connection page renders the real device-pairing
//   flow (FR-144 mint/list), never the mock telemetry it used to show.
// @spec SDD-060
// @tested tests/unit/line-studio-edge-connection-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineStudioEdgeConnection from '@/modules/line-oa-studio/ui/LineStudioEdgeConnection'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('LINE OA Edge Connection rendering', () => {
  it('renders the real pairing form and never the removed mock telemetry', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(LineStudioEdgeConnection),
    ))
    // The real FR-144 pairing form is present.
    expect(html).toContain('จับคู่ Edge Device ใหม่')
    expect(html).toContain('สร้างไฟล์จับคู่ใหม่')
    // The removed mock telemetry never appears again.
    expect(html).not.toContain('edg-node-01')
    expect(html).not.toContain('edgk_live_8921a7f0e812d4')
    expect(html).not.toContain('99.98%')
  })

  it('renders without a selected business (no crash, no fetch)', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: {} },
      createElement(LineStudioEdgeConnection),
    ))
    expect(html).toContain('กรุณาเลือก Business ก่อนจัดการ')
  })
})
