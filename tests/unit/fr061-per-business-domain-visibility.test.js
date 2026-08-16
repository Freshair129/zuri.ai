import { describe, expect, it } from 'vitest'
import { resolveViewer, VIEWER_DOMAINS } from '@/modules/identity/resolve-viewer'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'
import { resolveBusinessShellDecision } from '@/lib/business-shell-guard'

// @req FR-061 — domain visibility is resolved per Business, not per principal.
// @spec SDD-034, SDD-017, SEC-008,
//   docs/domains/identity/features/FR-061-per-business-domain-visibility.md
// @tested tests/unit/fr061-per-business-domain-visibility.test.js
//
// Instance 3 of the authorization incident
// (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md). Unlike
// instances 1 and 2 there was no correct answer to swap to: `visibleDomains` is
// a flat array on the principal, while the grant is per Membership. These tests
// pin the per-Business answer, and — deliberately — also pin what the flat field
// now means, so the two questions cannot be confused again.

const BUSINESSES = [
  { id: 'b-1', code: 'BUS-001', name: 'One', tenantId: 't-1' },
  { id: 'b-2', code: 'BUS-002', name: 'Two', tenantId: 't-1' },
  { id: 'b-3', code: 'BUS-003', name: 'Three', tenantId: 't-2' },
]

// Membership rows, not viewers: every fixture below is fed to the REAL resolver
// so the shapes under test are ones production can actually emit.
const owns = (personId, businessId, tenantId = 't-1') =>
  ({ personId, tenantId, businessId, role: 'OWNER', domainKeysJson: '["projects"]' })
const belongsTo = (personId, businessId, keys, tenantId = 't-1') =>
  ({ personId, tenantId, businessId, role: 'MEMBER', domainKeysJson: JSON.stringify(keys) })
const ownsTenantWide = (personId, tenantId = 't-1') =>
  ({ personId, tenantId, businessId: null, role: 'OWNER', domainKeysJson: '[]' })
const belongsToWithRawGrant = (personId, businessId, raw, tenantId = 't-1') =>
  ({ personId, tenantId, businessId, role: 'MEMBER', domainKeysJson: raw })

function fakeDb({ people = [], memberships = [] } = {}) {
  return {
    person: { findUnique: async ({ where }) => people.find((p) => p.id === where.id || p.code === where.code) || null },
    membership: { findMany: async ({ where }) => memberships.filter((m) => m.personId === where.personId) },
    business: { findMany: async () => BUSINESSES },
  }
}

const person = (id) => ({ id, code: `PER-${id}`, displayName: id })

/** OWNER of b-1, merely a MEMBER of b-2 with a one-domain allow-list. */
function mixedPrincipal() {
  return resolveViewer({
    principalId: 'p-mixed',
    db: fakeDb({
      people: [person('p-mixed')],
      memberships: [owns('p-mixed', 'b-1'), belongsTo('p-mixed', 'b-2', ['people'])],
    }),
  })
}

describe('the escalation this FR closes', () => {
  it('does not widen a Business where the principal is only a MEMBER', async () => {
    const viewer = await mixedPrincipal()

    // Before FR-061 this was all seven domains, purely because the principal
    // owned an unrelated Business. The control below is the same person holding
    // the same Membership on b-2 and nothing else.
    expect(domainsForBusiness(viewer, 'b-2')).toEqual(['people'])
  })

  it('matches the control: an identical Membership held by a principal who owns nothing', async () => {
    const control = await resolveViewer({
      principalId: 'p-plain',
      db: fakeDb({
        people: [person('p-plain')],
        memberships: [belongsTo('p-plain', 'b-2', ['people'])],
      }),
    })
    const attacker = await mixedPrincipal()

    expect(domainsForBusiness(attacker, 'b-2')).toEqual(domainsForBusiness(control, 'b-2'))
  })

  it('still grants every domain on the Business that is genuinely owned', async () => {
    const viewer = await mixedPrincipal()

    // An OWNER Membership derives all domains from the role (SDD-017), which is
    // why its own `domainKeysJson: ["projects"]` is ignored — per Membership now.
    expect(domainsForBusiness(viewer, 'b-1')).toEqual(VIEWER_DOMAINS)
  })

  it('keeps the flat field as the union, and says so', async () => {
    const viewer = await mixedPrincipal()

    // The union is not the leak — it is the honest answer to "anywhere?". The
    // leak was reading it as the answer to "here?". It stays on the viewer
    // because /api/entry publishes it under a strict contract (FR-046).
    expect(viewer.visibleDomains).toEqual(VIEWER_DOMAINS)
    expect(viewer.visibleDomains).not.toEqual(domainsForBusiness(viewer, 'b-2'))
  })
})

describe('the map is built from the same rows as the rest of the viewer', () => {
  it('expands a tenant-wide Membership across that tenant only', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-tenant',
      db: fakeDb({
        people: [person('p-tenant')],
        memberships: [ownsTenantWide('p-tenant')],
      }),
    })

    expect(domainsForBusiness(viewer, 'b-1')).toEqual(VIEWER_DOMAINS)
    expect(domainsForBusiness(viewer, 'b-2')).toEqual(VIEWER_DOMAINS)
    expect(domainsForBusiness(viewer, 'b-3')).toEqual([]) // t-2, outside the tenant
  })

  it('unions two Memberships on the same Business rather than letting one win', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-two',
      db: fakeDb({
        people: [person('p-two')],
        memberships: [belongsTo('p-two', 'b-1', ['projects']), belongsTo('p-two', 'b-1', ['people'])],
      }),
    })

    expect(domainsForBusiness(viewer, 'b-1')).toEqual(['people', 'projects'])
  })

  it('records an explicit empty grant rather than omitting the Business', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-none',
      db: fakeDb({ people: [person('p-none')], memberships: [belongsTo('p-none', 'b-1', [])] }),
    })

    expect(viewer.visibleBusinessIds).toEqual(['b-1'])
    expect(viewer.domainsByBusinessId['b-1']).toEqual([])
  })

  it('drops a granted key that is not a real domain', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-junk',
      db: fakeDb({ people: [person('p-junk')], memberships: [belongsTo('p-junk', 'b-1', ['projects', 'not-a-domain'])] }),
    })

    expect(domainsForBusiness(viewer, 'b-1')).toEqual(['projects'])
  })

  it('survives an unparseable allow-list by granting nothing', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-bad',
      db: fakeDb({
        people: [person('p-bad')],
        memberships: [belongsToWithRawGrant('p-bad', 'b-1', '{oops')],
      }),
    })

    expect(domainsForBusiness(viewer, 'b-1')).toEqual([])
  })
})

describe('every resolver branch fills the map — there is no shortcut to read instead', () => {
  it('platform DEV: all domains on every visible Business, still owning none', async () => {
    const viewer = await resolveViewer({
      principalId: 'p-dev',
      platformGrant: true,
      db: fakeDb({ people: [person('p-dev')] }),
    })

    expect(Object.keys(viewer.domainsByBusinessId).sort()).toEqual(['b-1', 'b-2', 'b-3'])
    expect(domainsForBusiness(viewer, 'b-3')).toEqual(VIEWER_DOMAINS)
    expect(viewer.ownedBusinessIds).toEqual([])
  })

  it('local development fallback: all domains on every Business', async () => {
    const viewer = await resolveViewer({
      allowDevelopmentFallback: true,
      db: fakeDb({ people: [{ id: 'p-local', code: 'PER-OWNER', displayName: 'Local Owner' }] }),
    })

    expect(domainsForBusiness(viewer, 'b-2')).toEqual(VIEWER_DOMAINS)
  })

  it('gives each Business its own array, so mutating one cannot corrupt another', async () => {
    const viewer = await resolveViewer({
      allowDevelopmentFallback: true,
      db: fakeDb({ people: [{ id: 'p-local', code: 'PER-OWNER', displayName: 'Local Owner' }] }),
    })

    expect(viewer.domainsByBusinessId['b-1']).not.toBe(viewer.domainsByBusinessId['b-2'])
    expect(viewer.domainsByBusinessId['b-1']).not.toBe(viewer.visibleDomains)
  })
})

describe('domainsForBusiness fails closed', () => {
  it('denies a Business absent from the map', async () => {
    const viewer = await mixedPrincipal()
    expect(domainsForBusiness(viewer, 'b-3')).toEqual([])
  })

  it('denies a missing or non-string Business id', async () => {
    const viewer = await mixedPrincipal()
    for (const bad of [null, undefined, '', 0, {}]) {
      expect(domainsForBusiness(viewer, bad)).toEqual([])
    }
  })

  it('denies when the map itself is not an object', () => {
    expect(domainsForBusiness({ domainsByBusinessId: ['b-1'] }, 'b-1')).toEqual([])
    expect(domainsForBusiness(null, 'b-1')).toEqual([])
  })

  it('falls back to the flat field ONLY for a viewer that predates the map', () => {
    // The old-fixture seam `isDomainVisible` already documents. It is
    // unreachable from a real viewer — every resolver branch emits the map —
    // and the fixture-realism gate is what keeps it from becoming normal again.
    expect(domainsForBusiness({ visibleDomains: ['projects'] }, 'b-1')).toEqual(['projects'])
    expect(domainsForBusiness({}, 'b-1')).toBeUndefined()
  })
})

describe('the route guard asks the per-Business question', () => {
  const decisionFor = (viewer, businessId, pathname) => resolveBusinessShellDecision({
    pathname,
    scopeLoaded: true,
    selection: { businessId },
    businesses: BUSINESSES,
    viewer,
  })

  it('forbids a domain granted elsewhere but not here', async () => {
    const viewer = await mixedPrincipal()
    const decision = decisionFor(viewer, 'b-2', '/projects')

    expect(decision.state).toBe('FORBIDDEN')
    expect(decision.reason).toBe('DOMAIN_ACCESS')
  })

  it('allows the same domain on the Business that grants it', async () => {
    const viewer = await mixedPrincipal()
    expect(decisionFor(viewer, 'b-1', '/projects').state).toBe('READY')
  })

  it('allows the domain the Business does grant', async () => {
    const viewer = await mixedPrincipal()
    expect(decisionFor(viewer, 'b-2', '/people').state).toBe('READY')
  })

  it('still lands a narrowly granted MEMBER on Business Home', async () => {
    // FR-060: `business-home` is alwaysVisible, so a MEMBER granted one domain
    // has somewhere to arrive after choosing a Business.
    const viewer = await mixedPrincipal()
    expect(decisionFor(viewer, 'b-2', '/overview').state).toBe('READY')
  })
})

describe('the domain bar asks the same question as the guard', () => {
  it('passes the per-Business allow-list, not the flat field', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/components/layouts/DomainBar.jsx', 'utf8')

    // A source assertion because the two consumers drifting apart IS the bug
    // class: one honouring the per-Business answer while the other reads the
    // union would put a domain in the bar that the guard then refuses.
    expect(source).toContain('domainsForBusiness(')
    expect(source).not.toContain('viewer.data?.visibleDomains')
  })

  it('does not ask before there is a viewer to ask — an unloaded viewer is not a denial', async () => {
    const { isDomainVisible } = await import('@/config/domains')
    const { readFileSync } = await import('node:fs')

    // Found live, not by reading: asking eagerly emptied the bar down to
    // Business Home for the seconds `/api/viewer` was in flight, and every
    // click had to wait it out — which is what turned an e2e navigation into a
    // 10s timeout. The helper is right to fail closed; the caller was wrong to
    // ask early.
    expect(domainsForBusiness(undefined, 'b-1')).toEqual([])
    expect(isDomainVisible('projects', undefined)).toBe(true)
    expect(readFileSync('src/components/layouts/DomainBar.jsx', 'utf8'))
      .toContain('viewer.data ? domainsForBusiness(')
  })
})
