import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer, makeDevViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

// The one seam swapped: the route resolves its viewer from the session port, which
// reads a cookie and is not what this suite is about. Everything past it — Prisma, the
// read models, the domain gate — is the real request path. Same trick, same reason, as
// tests/integration/market-intelligence-observation-feed.test.js.
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

const { GET: getConversations } = await import('@/app/api/crm/conversations/route')
const { GET: getObservations } = await import('@/app/api/market/observations/route')
const { GET: getPeople } = await import('@/app/api/people/route')
const { POST: postConsent } = await import('@/app/api/crm/customers/[customerId]/consent/route')

// @req FR-061 — per-Business domain visibility is enforced by the server, not only by
//   the client route guard, on the three API families whose domain key is unambiguous:
//   crm → `customer`, market → `market`, people → `people` (D2-domain-identity-23).
// @spec SDD-034, SEC-001, SEC-008, BR-001
//
// The hole this closes: `domainsForBusiness` had two consumers and both ran in the
// browser. A MEMBER whose `Membership.domainKeysJson` lists only `projects` saw no CRM
// tab and could not route to `/customer` — and `GET /api/crm/conversations?businessId=…`
// answered them anyway. The guard was a rendering rule wearing an authorization rule's
// clothes.
//
// Every case below runs through the route function the browser calls, against a real
// database, so what is asserted is the status and body a caller actually observes —
// which is the only level at which the FR-072(a) claim (a refusal discloses nothing)
// can be stated at all.

const suffix = () => randomUUID().slice(0, 8).toUpperCase()

let business, absentBusinessId

// The three GETs under test, named by the surface a reader would recognise.
const SURFACES = [
  {
    name: 'GET /api/crm/conversations',
    domainKey: 'customer',
    call: (viewer, businessId) => withViewer(getConversations, viewer, `http://local/api/crm/conversations?businessId=${businessId}`),
  },
  {
    name: 'GET /api/market/observations',
    domainKey: 'market',
    call: (viewer, businessId) => withViewer(getObservations, viewer, `http://local/api/market/observations?businessId=${businessId}`),
  },
  {
    name: 'GET /api/people',
    domainKey: 'people',
    call: (viewer, businessId) => withViewer(getPeople, viewer, `http://local/api/people?businessId=${businessId}`),
  },
]

function withViewer(handler, viewer, url) {
  const request = new Request(url)
  request.__viewer = viewer
  return handler(request)
}

/** What a caller observes: the status and the body, nothing about how it was reached. */
async function observed(response) {
  return { status: response.status, body: await response.json() }
}

describe('server-side per-Business domain visibility (FR-061)', () => {
  beforeAll(async () => {
    const token = suffix()
    const portfolio = await createPortfolio({ name: `Domain Guard ${token}`, code: `PF-DOMV-${token}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Domain Tenant ${token}`, code: `TNT-DOMV-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: `ธุรกิจทดสอบสิทธิ์ ${token}`, code: `BUS-DOMV-${token}` })
    // A Business id this viewer's Membership names but the database does not hold. It is
    // the control for the disclosure claim below, and it has to be *visible* to the
    // viewer — an invisible id is refused one step earlier, by a different rule.
    absentBusinessId = `no-such-business-${token}`
  })

  // The MEMBER at the centre of the finding: granted Development and nothing else.
  const projectsOnly = () => makeViewer({
    visibleBusinessIds: [business.id],
    visibleDomains: ['projects'],
  })

  const granted = (...domainKeys) => makeViewer({
    visibleBusinessIds: [business.id],
    visibleDomains: ['projects', ...domainKeys],
  })

  const owner = () => makeViewer({
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    visibleDomains: [...VIEWER_DOMAINS],
  })

  const dev = () => makeDevViewer({
    visibleBusinessIds: [business.id],
    visibleDomains: [...VIEWER_DOMAINS],
  })

  for (const surface of SURFACES) {
    describe(surface.name, () => {
      it(`refuses a MEMBER whose Membership omits \`${surface.domainKey}\``, async () => {
        const result = await observed(await surface.call(projectsOnly(), business.id))

        expect(result.status).toBe(404)
        expect(result.body.error).toBe('Business not found')
        // Nothing about the Business leaks alongside the refusal.
        expect(JSON.stringify(result.body)).not.toContain(business.name)
      })

      it('answers a MEMBER who holds the key', async () => {
        const result = await observed(await surface.call(granted(surface.domainKey), business.id))

        expect(result.status).toBe(200)
      })

      it('answers an OWNER, whose Membership derives every domain from its role', async () => {
        const result = await observed(await surface.call(owner(), business.id))

        expect(result.status).toBe(200)
      })

      it('leaves the platform DEV branch exactly as it was', async () => {
        // `resolveViewer` fills a DEV's map from its own visible-Business set rather
        // than raising a flag (SDD-034), so the new gate must be a no-op for it. If
        // this goes red the predicate has started re-deriving the rule instead of
        // asking `domainsForBusiness`.
        const result = await observed(await surface.call(dev(), business.id))

        expect(result.status).toBe(200)
      })

      it('refuses identically whether the domain is missing or the Business is', async () => {
        // @req FR-072 clause (a). Two different reasons, one answer: otherwise the
        // status code tells an attacker which of the tenant's Business ids are real.
        const missingDomain = await observed(await surface.call(projectsOnly(), business.id))
        const missingBusiness = await observed(await surface.call(
          makeViewer({
            visibleBusinessIds: [business.id, absentBusinessId],
            visibleDomains: ['projects', surface.domainKey],
          }),
          absentBusinessId,
        ))

        expect(missingDomain).toEqual(missingBusiness)
        expect(missingDomain.status).toBe(404)
      })
    })
  }

  describe('POST /api/crm/customers/{customerId}/consent', () => {
    const consent = (viewer, businessId) => {
      const request = new Request('http://local/api/crm/customers/cust-does-not-exist/consent', {
        method: 'POST',
        body: JSON.stringify({ businessId, status: 'GRANTED' }),
      })
      request.__viewer = viewer
      return postConsent(request, { params: { customerId: 'cust-does-not-exist' } })
    }

    it('refuses a MEMBER without the CRM domain before it mentions ownership', async () => {
      // Order matters here, which is why it is asserted rather than left to the code's
      // line ordering: a caller who was never granted the CRM must not learn from a 403
      // that the Business is real and merely unowned by them.
      const result = await observed(await consent(projectsOnly(), business.id))

      expect(result.status).toBe(404)
      expect(result.body.error).toBe('Business not found')
      expect(result.body.error).not.toMatch(/owner/i)
    })

    it('still gives the honest 403 to a MEMBER who holds the CRM but not ownership', async () => {
      const result = await observed(await consent(granted('customer'), business.id))

      expect(result.status).toBe(403)
      expect(result.body.error).toMatch(/owner authority/i)
    })
  })
})
