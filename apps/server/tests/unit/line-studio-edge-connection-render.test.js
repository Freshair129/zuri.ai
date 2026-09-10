// @req FR-144, FR-146 — the Edge Connection page renders the real device-pairing
//   flow (FR-144 mint/list/revoke), never the mock telemetry it used to show.
// @spec SDD-060
// @tested tests/unit/line-studio-edge-connection-render.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// Client components render under a node environment with no DOM and no fetch, so a control that
// only appears once credentials have loaded cannot be asserted from the markup. The shipped source
// is the checkable surface — the same approach integrations-page-claims.test.js takes.
describe('the one surface that governs device keys offers all three operations', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/modules/line-oa-studio/ui/LineStudioEdgeConnection.jsx'), 'utf8')

  it('can revoke, not only mint and list', () => {
    // Consolidating the pairing UI here (PR #304) removed the Integrations page's revoke button
    // and did not replace it, so for a while nothing in the product could withdraw a device key —
    // a retired device's credential stayed ACTIVE with no way to say otherwise.
    expect(page).toMatch(/["']DELETE["']/)
    expect(page).toMatch(/api\/platform\/edge-devices\/credentials\/\$\{encodeURIComponent\(credential\.id\)\}/)
    expect(page).toContain('เพิกถอน')
  })

  it('warns that revocation is immediate and unrecoverable before doing it', () => {
    // FR-144 has no grace window: the next request with that key is 401.
    expect(page).toMatch(/window\.confirm\(/)
    expect(page).toMatch(/รับงานไม่ได้ทันที/)
  })
})

describe('LINE OA Studio has one Integrations page, not two', () => {
  it('no longer ships an alias route that re-exports the Platform page', () => {
    // Saved links redirect to the one workspace; they must not render a second copy.
    const compatibility = readFileSync(resolve(process.cwd(), 'src/app/(pm)/line-oa/integrations/page.jsx'), 'utf8')
    expect(compatibility).toContain("redirect('/platform/integrations')")
    expect(compatibility).not.toMatch(/export\s*\{\s*default\s*\}\s*from/)
    for (const file of ['src/config/domains.js', 'src/modules/line-oa-studio/ui/LineStudioProjects.jsx', 'tests/e2e/warmup-routes.js']) {
      expect(readFileSync(resolve(process.cwd(), file), 'utf8')).not.toContain('/line-oa/integrations')
    }
  })
})
