// @req FR-133 — Asset Management is one Business product domain and `/assets`
// resolves through the same registry used by navigation and route protection.
// @spec ADR-055, SDD-078, SEC-023
// @tested tests/unit/asset-management-navigation.test.js
import { describe, expect, it } from 'vitest'
import { DOMAINS, domainForPath, isDomainVisible } from '@/config/domains'

describe('Asset Management domain registry', () => {
  it('registers one live assets domain with Dashboard first', () => {
    const domains = DOMAINS.filter((domain) => domain.key === 'assets')
    expect(domains).toHaveLength(1)
    expect(domains[0]).toMatchObject({ label: 'Asset Management', basePath: '/assets' })
    expect(domains[0].soon).not.toBe(true)
    expect(domains[0].sub[0]).toMatchObject({ label: 'Dashboard', path: '/assets' })
  })

  it('maps every assets deep link to the Asset domain', () => {
    expect(domainForPath('/assets').key).toBe('assets')
    expect(domainForPath('/assets/receiving/draft-1').key).toBe('assets')
  })

  it('uses Business domain visibility instead of always exposing the route', () => {
    expect(isDomainVisible('assets', ['projects'])).toBe(false)
    expect(isDomainVisible('assets', ['projects', 'assets'])).toBe(true)
  })
})
