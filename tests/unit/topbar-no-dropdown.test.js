import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const topbar = readFileSync(resolve(process.cwd(), 'src/components/layouts/Topbar.jsx'), 'utf8')

describe('Topbar scope boundary', () => {
  it('does not retain the deprecated scope dropdown components', () => {
    expect(topbar).not.toContain('HeroSwitcher')
    expect(topbar).not.toContain('ScopeSelect')
  })

  it('keeps the non-scope navigation controls', () => {
    expect(topbar).toContain('Open command palette')
    expect(topbar).toContain('New Project')
    expect(topbar).toContain('ViewToggle')
  })

  it('provides an explicit return path to Business Routing without a dropdown', () => {
    expect(topbar).toContain('Change Business')
    expect(topbar).toContain('href="/businesses"')
  })

  it('shows the three-level Base Context Bar, not a repeated domain chip', () => {
    expect(topbar).toContain('BASE_CONTEXT_LEVELS')
    expect(topbar).toContain('currentTenant')
    expect(topbar).not.toContain('domainForPath')
  })

  it('derives Business and Organization from a deep-linked Project owner', () => {
    expect(topbar).toContain('routeProjectId')
    expect(topbar).toContain('currentBusiness || routeBusiness')
    expect(topbar).toContain('currentTenant || routeTenant')
  })
})
