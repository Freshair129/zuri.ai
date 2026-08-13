// @req FR-039 — Development is the display label for the existing projects domain key.
// @spec SDD-018, ADR-011
// @tested tests/unit/domain-navigation.test.js
import { describe, expect, it } from 'vitest'
import { DOMAINS, domainForPath } from '@/config/domains'
import { modules } from '@/config/modules'

describe('Business domain navigation', () => {
  it('keeps Business Overview as the Development root, outside its sidebar', () => {
    const development = DOMAINS.find((domain) => domain.key === 'projects')
    expect(development.label).toBe('Development')
    expect(development.basePath).toBe('/overview')
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
    expect(development.sub.map((item) => item.path)).not.toContain('/overview')
    expect(domainForPath('/overview').key).toBe('projects')
  })

  it('uses ERP-friendly display labels without changing RBAC route keys', () => {
    expect(DOMAINS.find((domain) => domain.key === 'customer').label).toBe('CRM')
    expect(DOMAINS.find((domain) => domain.key === 'growth').label).toBe('Marketing')
  })

  it('registers HR / People as a peer domain, not a Development sub-domain', () => {
    const people = DOMAINS.find((domain) => domain.key === 'people')
    expect(people.label).toBe('HR / People')
    expect(people.sub.map((item) => item.path)).toEqual(['/people', '/people/directory'])
    expect(DOMAINS.find((domain) => domain.key === 'projects').sub.map((item) => item.path)).not.toContain('/people')
  })

  it('keeps Space out of the Development command palette registry', () => {
    expect(modules.projectManager.label).toBe('Development')
    expect(modules.projectManager.basePath).toBe('/overview')
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
