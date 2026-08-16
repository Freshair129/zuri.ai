import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DOMAINS, isDomainVisible, domainForPath } from '@/config/domains'
import { resolveBusinessShellDecision } from '@/lib/business-shell-guard'

// @req FR-060 — Business Home is the Business's landing surface, so it must be
// reachable by any viewer who can enter the Business at all.
// @spec SDD-033
// @tested tests/unit/fr060-business-home-visibility.test.js
//
// Why this file exists: moving `/overview` from the `projects` domain to the new
// `business-home` domain silently changed which Membership grants can reach it.
// A MEMBER whose domainKeysJson is ["projects"] would have been FORBIDDEN from
// the page they land on after choosing a Business — and nothing in the suite
// would have failed, because every guard fixture supplies visibleDomains by hand.

const memberViewer = { visibleBusinessIds: ['b-1'], visibleDomains: ['projects'] }
const readSource = (rel) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('the slot itself', () => {
  it('is the first Tier-2 domain and owns /overview', () => {
    expect(DOMAINS[0].key).toBe('business-home')
    expect(domainForPath('/overview').key).toBe('business-home')
  })

  it('is not a reserved slot', () => {
    expect(DOMAINS[0].soon).toBeFalsy()
  })
})

describe('isDomainVisible', () => {
  it('lets a MEMBER granted only projects still see Business Home', () => {
    expect(isDomainVisible('business-home', ['projects'])).toBe(true)
  })

  it('still withholds a domain the viewer was not granted', () => {
    expect(isDomainVisible('platform', ['projects'])).toBe(false)
    expect(isDomainVisible('people', ['projects'])).toBe(false)
  })

  it('grants a domain the viewer was granted', () => {
    expect(isDomainVisible('projects', ['projects'])).toBe(true)
  })

  it('treats a viewer with no visibleDomains array as unrestricted, as before', () => {
    expect(isDomainVisible('platform', undefined)).toBe(true)
  })

  it('withholds an unknown key rather than defaulting it open', () => {
    expect(isDomainVisible('not-a-domain', ['projects'])).toBe(false)
  })
})

describe('the route guard honours it', () => {
  it('does not FORBID /overview for a MEMBER granted only projects', () => {
    const decision = resolveBusinessShellDecision({
      pathname: '/overview',
      scopeLoaded: true,
      viewerLoading: false,
      viewer: memberViewer,
      selection: { businessId: 'b-1' },
      businesses: [{ id: 'b-1' }, { id: 'b-2' }],
      projects: [],
    })
    expect(decision.state).not.toBe('FORBIDDEN')
  })

  it('still FORBIDs a domain that viewer genuinely lacks', () => {
    const decision = resolveBusinessShellDecision({
      pathname: '/platform/users',
      scopeLoaded: true,
      viewerLoading: false,
      viewer: memberViewer,
      selection: { businessId: 'b-1' },
      businesses: [{ id: 'b-1' }, { id: 'b-2' }],
      projects: [],
    })
    expect(decision.state).toBe('FORBIDDEN')
  })
})

describe('both consumers use one predicate', () => {
  // The bar and the guard disagreeing is the failure mode this replaces: one
  // would show the tab and the other would refuse the route.
  it('DomainBar filters through isDomainVisible, not a local Set', () => {
    const source = readSource('src/components/layouts/DomainBar.jsx')
    expect(source).toContain('isDomainVisible(domain.key, viewer.data?.visibleDomains)')
    expect(source).not.toContain('visibleDomains.has(')
  })

  it('business-shell-guard delegates to the same predicate', () => {
    expect(readSource('src/lib/business-shell-guard.js')).toContain('isDomainVisible(domainKey, viewer?.visibleDomains)')
  })
})
