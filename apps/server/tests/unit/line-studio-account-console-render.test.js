// @req FR-146, FR-149 — the LINE OA account console has no Edge controls and retains
//   the browser-provisioned model-provider key card.
// @spec ADR-109 D1, D2; SDD-060
// @tested tests/unit/line-studio-account-console-render.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineStudioAccountConsole from '@/modules/line-oa-studio/ui/LineStudioAccountConsole'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('LINE OA account console rendering', () => {
  it('keeps device pairing and heartbeat telemetry out of the account surface', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(LineStudioAccountConsole),
    ))
    expect(html).not.toMatch(/Edge Device|จับคู่ Edge|ไฟล์จับคู่/)
    expect(html).not.toMatch(/heartbeat|telemetry/i)
    expect(html).not.toContain('edg-node-01')
    expect(html).not.toContain('edgk_live_8921a7f0e812d4')
    expect(html).not.toContain('99.98%')
  })

  it('renders without a selected business (no crash, no fetch)', () => {
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: {} },
      createElement(LineStudioAccountConsole),
    ))
    expect(html).toContain('กรุณาเลือก Business ก่อนจัดการ')
  })
})

// Client components render under a node environment with no DOM and no fetch, so a control that
// only appears once credentials have loaded cannot be asserted from the markup. The shipped source
// is the checkable surface — the same approach integrations-page-claims.test.js takes.
describe('the LINE account console keeps PRP model key configuration', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/modules/line-oa-studio/ui/LineStudioAccountConsole.jsx'), 'utf8')

  it('retains the model provider key card while removing device credential calls', () => {
    expect(page).toContain('LineOaModelKeyCard')
    expect(page).toContain('/api/integration/model-providers?businessId=')
    expect(page).not.toMatch(/api\/platform\/edge-devices|จับคู่ Edge|edge-pairing/i)
  })

  // @req FR-235 — the publisher's grounding-mode control (ADR-090 D1). The
  // account card is a client component that fetches, so — same as the revoke
  // button above — the shipped source is the checkable surface.
  it('offers all three grounding modes and saves through the versioned CONFIGURE_KNOWLEDGE_GROUNDING action', () => {
    expect(page).toContain('account.knowledgeGrounding')
    for (const mode of ['BUSINESS_KNOWLEDGE', 'GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']) {
      expect(page).toContain(`value="${mode}"`)
    }
    expect(page).toMatch(/action:\s*"CONFIGURE_KNOWLEDGE_GROUNDING"/)
    expect(page).toMatch(/knowledgeGrounding:\s*grounding/)
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
