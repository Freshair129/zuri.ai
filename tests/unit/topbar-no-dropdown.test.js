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
    expect(topbar).toContain('ViewToggle')
  })

  // @req FR-086 — ADR-036 D1 removed the creation button from the shell on
  // 2026-08-19: a global control implies Project creation is context-free, when
  // it is scoped to the Business or Space the shell has selected. `/projects`
  // renders the single copy. Asserted against the route and the icon rather
  // than the phrase, because the source still explains the removal in prose and
  // a text match on the label would pass on the comment alone.
  //
  // `useRouter` returned to this file on 2026-09-04 for an unrelated reason —
  // the FR-046/FR-095 sign-out control's redirect to /login (tests/unit/sign-out.test.js)
  // — so this test no longer asserts its absence; it still asserts the
  // Project-creation route and icon never come back.
  it('does not offer Project creation from the shell chrome', () => {
    expect(topbar).not.toContain('/projects/new')
    expect(topbar).not.toContain('<Plus')
    expect(topbar).not.toContain('Plus,')
  })

  it('offers a sign-out control that redirects through the shared sign-out module', () => {
    expect(topbar).toContain("from '@/modules/identity/sign-out'")
    expect(topbar).toContain('performSignOut(')
    expect(topbar).toContain("router.replace(path)")
    expect(topbar).toContain('ออกจากระบบ')
  })

  it('opens Business Routing from Organization while keeping Business read-only', () => {
    expect(topbar).toContain('Select Business from Organization')
    expect(topbar).toContain('href="/businesses"')
    expect(topbar).toContain("level.schema === 'tenant'")
    expect(topbar).not.toContain('Change Business')
    expect(topbar).not.toContain("level.schema === 'business' ?")
    expect(topbar).not.toContain('ArrowLeftRight')
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
