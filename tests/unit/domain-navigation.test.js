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
  it('roots Development at Projects, not at the cross-domain Overview', () => {
    const development = DOMAINS.find((domain) => domain.key === 'projects')
    expect(development.label).toBe('Development')
    expect(development.basePath).toBe('/projects')
    expect(development.sub.map((item) => item.label)).not.toContain('Overview')
    expect(development.sub.map((item) => item.label)).toEqual([
      'Projects',
      'All Work',
      'Execution',
      'Timeline',
      'Dependencies',
      'Milestones & Gates',
      'Files',
      'Repositories',
    ])
    expect(development.sub[0].path).toBe('/projects')
    // `/overview` is now owned by the Business Home slot, not by Development.
    expect(domainForPath('/overview').key).toBe('business-home')
    expect(domainForPath('/projects').key).toBe('projects')
  })

  it('uses ERP-friendly display labels without changing RBAC route keys', () => {
    expect(DOMAINS.find((domain) => domain.key === 'customer').label).toBe('CRM')
    expect(DOMAINS.find((domain) => domain.key === 'growth').label).toBe('Marketing')
  })

  it('keeps Dashboard as the first sub-domain for non-Development domains', () => {
    expect(DOMAINS.filter((domain) => domain.key !== 'projects').every((domain) => domain.sub[0].label === 'Dashboard')).toBe(true)
  })

  it('registers HR / People as a peer domain, not a Development sub-domain', () => {
    const people = DOMAINS.find((domain) => domain.key === 'people')
    expect(people.label).toBe('HR / People')
    expect(people.sub.map((item) => item.path)).toEqual(['/people', '/people/directory'])
    expect(DOMAINS.find((domain) => domain.key === 'projects').sub.map((item) => item.path)).not.toContain('/people')
  })

  it('keeps Space out of the Development command palette registry', () => {
    expect(modules.projectManager.label).toBe('Development')
    expect(modules.projectManager.basePath).toBe('/projects')
    expect(modules.projectManager.nav.map((item) => item.label)).toEqual([
      'Projects',
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
