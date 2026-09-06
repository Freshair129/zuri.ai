import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { makeDevViewer, makeOperatorViewer, makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-105 — `/control/roadmap` needs a reachable, operator-gated entry
// point from inside the BusinessShell instead of remaining a dead-end
// reachable only by typing the URL (D1-journey-states-tests-docs-12).
// @req FR-075 — the gate is the installation operator capability itself,
// never a re-derived check against `isPlatform` or a role.
// @spec ADR-048 D2, SEC-020
// @tested tests/unit/platform-control-guard.test.js, tests/unit/platform-control-entry-link.test.js

const fromRoot = (...parts) => resolve(process.cwd(), ...parts)

describe('isInstallationOperator visibility predicate', () => {
  it('is true only for a viewer explicitly carrying isOperator: true', () => {
    expect(isInstallationOperator(makeOperatorViewer({ ownedBusinessIds: [] }))).toBe(true)
  })

  it('is false for every other shape, including one that looks operator-adjacent', () => {
    expect(isInstallationOperator(null)).toBe(false)
    expect(isInstallationOperator(undefined)).toBe(false)
    expect(isInstallationOperator({})).toBe(false)
    // A broad platform/role grant is not the installation operator capability —
    // isPlatform (DEV) and Business/Tenant OWNER authority grant nothing here.
    expect(isInstallationOperator(makeDevViewer({ isOperator: false }))).toBe(false)
    expect(isInstallationOperator(makeViewer({ isOperator: false }))).toBe(false)
    expect(isInstallationOperator(ownsElsewhere({ isOperator: false }))).toBe(false)
  })
})

describe('the Settings entry point into Platform Control', () => {
  const settingsPath = fromRoot('src', 'app', '(pm)', 'settings', 'page.jsx')
  const source = readFileSync(settingsPath, 'utf8')

  it('links to /control/roadmap', () => {
    expect(source).toContain('/control/roadmap')
  })

  it('gates that link on the exact isInstallationOperator capability from Identity', () => {
    expect(source).toContain("import { isInstallationOperator } from '@/modules/identity/viewer-authority'")
    expect(source).toContain('isInstallationOperator(')
  })

  it('does not re-derive operator visibility from isPlatform or a role check', () => {
    // The predicate import above is the one and only gate; nothing here may
    // additionally (or instead) branch on a broader/looser signal.
    expect(source).not.toMatch(/viewer\.data\?\.isPlatform/)
    expect(source).not.toMatch(/viewer\.data\?\.role/)
  })
})

describe('PlatformControlShell provides a way back to Business Routing', () => {
  const shellPath = fromRoot('src', 'components', 'layouts', 'PlatformControlShell.jsx')
  const source = readFileSync(shellPath, 'utf8')

  it('links to /businesses, the safe target with no Business selection assumed', () => {
    expect(source).toContain("href=\"/businesses\"")
  })
})
