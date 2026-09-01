// @req FR-039 — Development is the display label for the existing projects domain key.
// @spec SDD-018, ADR-011
// @tested tests/unit/domain-navigation.test.js
import { describe, expect, it } from 'vitest'
import { DOMAINS, domainForPath } from '@/config/domains'
import { modules } from '@/config/modules'

describe('Business domain navigation', () => {
  // @req FR-060 — Development no longer roots at `/overview`. That page is
  // cross-domain (strategy, per-domain health, attention queue) and moved to the
  // Business Home slot; Development roots at its own resource list instead.
  it('roots Development at its own Dashboard, not at the cross-domain Overview', () => {
    const development = DOMAINS.find((domain) => domain.key === 'projects')
    expect(development.label).toBe('Development')
    expect(development.basePath).toBe('/projects')
    // @req FR-086 — what this pins is the FR-060 separation, not a string: the
    // word "Overview" belongs to `/overview` alone, so no Development entry may
    // claim it. The first entry's *label* moved from `Projects` to `Dashboard`
    // deliberately on 2026-08-19 (ADR-036 D1) — reversing that is a product
    // decision, but reintroducing "Overview" here would be the FR-060 drift.
    expect(development.sub.map((item) => item.label)).not.toContain('Overview')
    // `/timeline` keeps the label Timeline while the project Work tab calls its
    // half Schedule. Both bars render at once, so identical labels are ambiguous
    // to a screen reader and to Playwright alike — the shared word lives in the page heading.
    expect(development.sub.map((item) => item.label)).toEqual([
      'Dashboard',
      'All Work',
      'Execution',
      'Timeline',
      'Dependencies',
      'Milestones & Gates',
      'Files',
      'Repositories',
    ])
    expect(development.sub.find((item) => item.label === 'Timeline').path).toBe('/timeline')
    expect(development.sub[0].path).toBe('/projects')
    // `/overview` is now owned by the Business Home slot, not by Development.
    expect(domainForPath('/overview').key).toBe('business-home')
    expect(domainForPath('/projects').key).toBe('projects')
  })

  it('uses ERP-friendly display labels without changing RBAC route keys', () => {
    expect(DOMAINS.find((domain) => domain.key === 'customer').label).toBe('CRM')
    expect(DOMAINS.find((domain) => domain.key === 'growth').label).toBe('Marketing')
  })

  // @req FR-086 — the carve-out for Development is gone: ADR-036 D1 gave it a
  // Dashboard too on 2026-08-19, so the rule is now universal and is asserted
  // as such. The two Dashboards remain distinct surfaces at distinct routes,
  // which is the FR-060 decision this pins — `/overview` is Business Home's,
  // `/projects` is Development's, and no domain may point its Dashboard at
  // another domain's route.
  it('gives every domain a Dashboard first, each at its own route', () => {
    expect(DOMAINS.every((domain) => domain.sub[0].label === 'Dashboard')).toBe(true)
    expect(DOMAINS.find((domain) => domain.key === 'business-home').sub[0].path).toBe('/overview')
    expect(DOMAINS.find((domain) => domain.key === 'projects').sub[0].path).toBe('/projects')
    const dashboardPaths = DOMAINS.map((domain) => domain.sub[0].path)
    expect(dashboardPaths.filter((path) => path === '/overview')).toHaveLength(1)
  })

  it('registers HR / People as a peer domain, not a Development sub-domain', () => {
    const people = DOMAINS.find((domain) => domain.key === 'people')
    expect(people.label).toBe('HR / People')
    expect(people.sub.map((item) => item.path)).toEqual(['/people', '/people/directory'])
    expect(DOMAINS.find((domain) => domain.key === 'projects').sub.map((item) => item.path)).not.toContain('/people')
  })

  it('registers Market Intelligence as a peer operational domain with route key market', () => {
    const market = DOMAINS.find((domain) => domain.key === 'market')
    expect(market.label).toBe('Market Intelligence')
    expect(market.soon).toBe(false)
    expect(market.sub[0]).toMatchObject({ label: 'Dashboard', path: '/market' })
    expect(domainForPath('/market').key).toBe('market')
  })

  it('keeps Space out of the Development command palette registry', () => {
    expect(modules.projectManager.label).toBe('Development')
    expect(modules.projectManager.basePath).toBe('/projects')
    // Mirrors `DOMAINS`: the first label moved to `Dashboard` on 2026-08-19
    // (ADR-036 D1, FR-086). Nothing reads this list at runtime, so the point of
    // pinning it is that it stays a truthful copy rather than a stale one.
    expect(modules.projectManager.nav.map((item) => item.label)).toEqual([
      'Dashboard',
      'All Work',
      'Execution',
      'Timeline',
      'Dependencies',
      'Milestones & Gates',
      'Files',
      'Repositories',
    ])
    expect(modules.projectManager.nav.map((item) => item.path)).not.toContain('/overview')
  })
})
