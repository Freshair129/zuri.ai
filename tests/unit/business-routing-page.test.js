import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'src/app/(entry)/businesses/page.jsx'), 'utf8')

// @req FR-044 — Business Routing is the viewer-authorized pre-shell selection boundary.
// @spec ADR-015, SDD-022
// @tested tests/unit/business-routing-page.test.js

describe('FR-044 Business Routing page', () => {
  it('resolves viewer and scope inventory through the shared fetch hook', () => {
    expect(page).toContain("useFetch('/api/viewer')")
    expect(page).toContain("useFetch('/api/scope')")
    expect(page).toContain('buildBusinessRouting({')
    expect(page).toContain('BusinessRoutingShell')
  })

  it('persists Business selection in ScopeContext before entering Overview', () => {
    expect(page).toContain('scope.select({ portfolioId: tenant?.portfolioId || null, businessId: business.id })')
    expect(page).toContain("router.push('/overview')")
  })

  it('renders Portfolio and Tenant as context labels rather than selectable shells', () => {
    expect(page).toContain('Portfolio:')
    expect(page).toContain('Tenant:')
    expect(page).not.toContain('Select a portfolio')
    expect(page).not.toContain('onClick={() => scope.select({ portfolioId:')
  })
})
