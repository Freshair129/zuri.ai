// @req FR-153 — Marketing routes use the existing Business-specific growth grant.
// @spec SDD-086, SEC-001
import { describe, expect, it } from 'vitest'
import { DOMAINS, domainForPath } from '@/config/domains'
import { resolveBusinessShellDecision } from '@/lib/business-shell-guard'
import { makeViewer } from '../factories/viewer'

describe('Marketing navigation and copied URLs', () => {
  it('activates real Strategy routes under the existing growth identity', () => {
    const marketing = DOMAINS.find(domain => domain.key === 'growth')
    expect(marketing.soon).toBe(false)
    expect(marketing.sub.map(entry => entry.path)).toEqual(['/growth', '/growth/strategy'])
    expect(domainForPath('/growth/strategy').key).toBe('growth')
  })

  it('does not carry the growth grant from Business A into a visible Business B', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['a', 'b'], ownedBusinessIds: ['a'], visibleDomains: ['growth', 'projects'], domainsByBusinessId: { a: ['growth', 'projects'], b: ['projects'] } })
    const input = { pathname: '/growth/strategy', scopeLoaded: true, businesses: [{ id: 'a' }, { id: 'b' }], projects: [], viewer }
    expect(resolveBusinessShellDecision({ ...input, selection: { businessId: 'a' } })).toMatchObject({ state: 'READY', businessId: 'a' })
    expect(resolveBusinessShellDecision({ ...input, selection: { businessId: 'b' } })).toMatchObject({ state: 'FORBIDDEN', reason: 'DOMAIN_ACCESS' })
    expect(resolveBusinessShellDecision({ ...input, selection: {} })).toMatchObject({ state: 'BUSINESS_REQUIRED' })
  })
})
