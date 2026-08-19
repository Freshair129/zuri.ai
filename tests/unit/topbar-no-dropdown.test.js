import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const topbar = readFileSync(resolve(process.cwd(), 'src/components/layouts/Topbar.jsx'), 'utf8')
const breadcrumb = readFileSync(resolve(process.cwd(), 'src/components/layouts/Breadcrumb.jsx'), 'utf8')

describe('Topbar & Breadcrumb scope boundary', () => {
  it('does not retain the deprecated scope dropdown components in Topbar', () => {
    expect(topbar).not.toContain('HeroSwitcher')
    expect(topbar).not.toContain('ScopeSelect')
  })

  it('keeps the non-scope navigation controls in Topbar', () => {
    expect(topbar).toContain('Open command palette')
    expect(topbar).toContain('New Project')
    expect(topbar).toContain('ViewToggle')
  })

  it('Breadcrumb opens Business Routing from Organization while keeping Business read-only', () => {
    expect(breadcrumb).toContain('Select Business from Organization')
    expect(breadcrumb).toContain("href: '/businesses'")
    expect(breadcrumb).not.toContain('Change Business')
    expect(breadcrumb).not.toContain('ArrowLeftRight')
  })

  it('shows the three-level Base Context Bar, not a repeated domain chip', () => {
    expect(breadcrumb).toContain('displayTenant')
    expect(breadcrumb).toContain('displayBusiness')
    expect(breadcrumb).not.toContain('domainForPath')
  })

  it('derives Business and Organization from a deep-linked Project owner', () => {
    expect(breadcrumb).toContain('routeProjectId')
    expect(breadcrumb).toContain('currentBusiness || routeBusiness')
    expect(breadcrumb).toContain('displayTenant')
  })
})
