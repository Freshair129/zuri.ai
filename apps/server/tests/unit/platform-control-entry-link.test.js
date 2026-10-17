import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @tested tests/unit/platform-control-entry-link.test.js

const fromRoot = (...parts) => resolve(process.cwd(), ...parts)

describe('Zuri navigation no longer advertises Developer Delivery Control', () => {
  const settings = readFileSync(fromRoot('src', 'app', '(pm)', 'settings', 'page.jsx'), 'utf8')
  const topbar = readFileSync(fromRoot('src', 'components', 'layouts', 'Topbar.jsx'), 'utf8')

  it('removes the Platform Control card and its roadmap, error, and usage links from Settings', () => {
    expect(settings).not.toMatch(/PlatformControlCard|\/control\/(roadmap|errors|usage)|isInstallationOperator/)
    expect(settings).toContain('function AddBusinessCard')
    expect(settings).toContain('function PhysicalStockCard')
    expect(settings).toContain('Mode → default strategy')
  })

  it('removes the Roadmap button from the BusinessShell topbar', () => {
    expect(topbar).not.toMatch(/RoadmapButton|\/control\/roadmap|MapIcon|isInstallationOperator|useFetch/)
    expect(topbar).toContain('aria-label="Open command palette (Ctrl+K)"')
    expect(topbar).toContain('aria-label="Current group, organization, and business"')
  })
})

describe('remaining PlatformControlShell routing', () => {
  const shell = readFileSync(fromRoot('src', 'components', 'layouts', 'PlatformControlShell.jsx'), 'utf8')

  it('keeps the route back to Business Routing for the remaining control pages', () => {
    expect(shell).toContain('href="/businesses"')
  })
})
