// @req FR-039, FR-247 — Projects & Work is the display label for the existing
// projects domain key; the six logical modules remain presentation metadata.
// @spec SDD-018, ADR-011, ADR-095
// @tested tests/unit/domain-navigation.test.js
import { describe, expect, it } from 'vitest'
import { DOMAINS, domainForPath } from '@/config/domains'
import { modules } from '@/config/modules'
import { PM_MODULES } from '@/modules/project-manager/navigation'

describe('Business domain navigation', () => {
  // @req FR-247 — Projects & Work keeps the existing route key and `/projects`
  // root. The route registry retains its eight destinations; the presentation
  // sidebar's six logical modules are pinned in the PM navigation registry.
  it('uses Projects & Work for the existing projects domain and preserves route entries', () => {
    const projects = DOMAINS.find((domain) => domain.key === 'projects')
    expect(projects.label).toBe('Projects & Work')
    expect(projects.basePath).toBe('/projects')
    expect(projects.sub.map((item) => item.label)).toEqual([
      'Dashboard',
      'All Work',
      'Execution',
      'Timeline',
      'Dependencies',
      'Milestones & Gates',
      'Files',
      'Repositories',
    ])
    expect(projects.sub).toHaveLength(8)
    expect(projects.sub[0].path).toBe('/projects')
    expect(projects.sub.map((item) => item.path)).toEqual([
      '/projects', '/work', '/execution', '/timeline', '/dependencies',
      '/milestones', '/files', '/repositories',
    ])
    expect(PM_MODULES).toHaveLength(6)
  })

  // @req FR-060 — Projects & Work no longer roots at `/overview`. That page is
  // cross-domain (strategy, per-domain health, attention queue) and moved to the
  // Business Home slot; Projects & Work roots at its Project Management surface.
  it('keeps Business Home at /overview and Projects & Work at /projects', () => {
    const projects = DOMAINS.find((domain) => domain.key === 'projects')
    // `/overview` is now owned by the Business Home slot, not by Development.
    expect(domainForPath('/overview').key).toBe('business-home')
    expect(domainForPath('/projects').key).toBe('projects')
    expect(projects.sub.map((item) => item.path)).not.toContain('/overview')
  })

  it('uses ERP-friendly display labels without changing RBAC route keys', () => {
    // @req FR-172 — relabelled from "CRM" to "Customer": ADR-071 groups this
    // domain with Market Intelligence under a new CRM slot, and the group and
    // the leaf cannot both read "CRM" in the same bar.
    expect(DOMAINS.find((domain) => domain.key === 'customer').label).toBe('Customer')
    expect(DOMAINS.find((domain) => domain.key === 'growth').label).toBe('Marketing')
  })

  // @req FR-086 — other domains retain the Dashboard-first rule. Projects &
  // Work is the approved narrow amendment: its first logical module is
  // Project Management, which opens the same `/projects` surface.
  it('keeps Dashboard first for other domains while Project Management opens /projects', () => {
    expect(DOMAINS.filter((domain) => domain.key !== 'projects').every((domain) => domain.sub[0].label === 'Dashboard')).toBe(true)
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

  it('keeps Space out of the Projects & Work command palette registry', () => {
    expect(modules.projectManager.label).toBe('Projects & Work')
    expect(modules.projectManager.basePath).toBe('/projects')
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
    expect(modules.projectManager.nav.map((item) => item.path)).toEqual([
      '/projects', '/work', '/execution', '/timeline', '/dependencies',
      '/milestones', '/files', '/repositories',
    ])
  })
})
