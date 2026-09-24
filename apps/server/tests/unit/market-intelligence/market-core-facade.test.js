import { describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'
import { handleMarketCoreRequest } from '@/modules/market-intelligence/application/market-core-facade'

// @req FR-092, FR-061 — core's market-core.v1 façade for the Market service (ADR-108 D4).
// @spec BR-001, SEC-001, SEC-017, ADR-108
//
// The façade must answer exactly what the legacy in-process Market code decides today,
// in the same order, and must never take identity from anything but the user's own
// session token re-resolved through the request-viewer path.

const TOKEN = 'k'.repeat(40)
const MARKET = ['market', 'projects', 'people', 'platform']
const BUSINESSES = { 'b-1': { id: 'b-1', tenantId: 't-1', name: 'B1' }, 'b-2': { id: 'b-2', tenantId: 't-1', name: 'B2' } }

const viewers = {
  owner: makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'], visibleDomains: MARKET }),
  member: makeViewer({ visibleBusinessIds: ['b-1'], visibleDomains: MARKET }),
  noMarket: makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'], visibleDomains: ['projects', 'people', 'platform'] }),
}

function deps(overrides = {}) {
  return {
    db: { business: { findUnique: vi.fn(async ({ where }) => BUSINESSES[where.id] ?? null) } },
    env: { MARKET_CORE_TOKEN: TOKEN, MARKET_EXECUTOR: 'legacy' },
    // The session token is the key; the viewer comes from the normal resolver.
    resolveRequestViewer: vi.fn(async (request) => {
      const cookie = request.headers.get('cookie') || ''
      const token = cookie.replace(/^zuri_session=/, '')
      return viewers[token] ?? makeViewer({ visibleBusinessIds: [] })
    }),
    listCandidates: vi.fn(async () => [{ id: 'r1', tenantId: 't-1', businessId: 'b-1', receivedAt: new Date('2026-09-01T00:00:00Z') }]),
    recordAudit: vi.fn(async () => ({})),
    ...overrides,
  }
}

const call = (d, { method = 'POST', operation, subject, body, auth = `Bearer ${TOKEN}` }) =>
  handleMarketCoreRequest({ method, operation, authorization: auth, subject, body }, d)

describe('market-core.v1 façade', () => {
  it('requires the service token and a known operation', async () => {
    const d = deps()
    expect((await call(d, { method: 'GET', operation: 'health', auth: 'Bearer wrong' })).status).toBe(401)
    expect((await call(d, { method: 'GET', operation: 'health', auth: null })).status).toBe(401)
    expect((await call(d, { method: 'GET', operation: 'authorize' })).status).toBe(404)
    expect((await call(d, { operation: 'drop-table' })).status).toBe(404)
    expect((await call(deps({ env: {} }), { method: 'GET', operation: 'health' })).status).toBe(401)
  })

  it('health says remote; execution ownership follows the one deployment flag', async () => {
    expect((await call(deps(), { method: 'GET', operation: 'health' })).body.data).toEqual({ ok: true, mode: 'remote' })
    expect((await call(deps(), { method: 'GET', operation: 'execution-ownership' })).body.data).toEqual({ ownsTranslation: false })
    const service = deps({ env: { MARKET_CORE_TOKEN: TOKEN, MARKET_EXECUTOR: 'service' } })
    expect((await call(service, { method: 'GET', operation: 'execution-ownership' })).body.data).toEqual({ ownsTranslation: true })
  })

  it('feed read: legacy statuses in legacy order', async () => {
    const d = deps()
    const read = (subject, businessId) => call(d, { operation: 'authorize', subject, body: { businessId, action: 'market.feed.read' } })
    expect((await read('member', 'b-1')).body.data).toEqual({ allowed: true, scope: { tenantId: 't-1', businessId: 'b-1', businessName: 'B1' } })
    expect((await read('member', 'b-2')).body.data).toEqual({ allowed: false, status: 403, message: 'Business access denied' })
    expect((await read('noMarket', 'b-1')).body.data).toEqual({ allowed: false, status: 404, message: 'Business not found' })
  })

  it('translation: unknown, hidden and not-owned are the identical 404', async () => {
    const d = deps()
    const run = (subject, businessId) => call(d, { operation: 'authorize', subject, body: { businessId, action: 'market.translation.run' } })
    expect((await run('owner', 'b-1')).body.data.allowed).toBe(true)
    const refusal = { allowed: false, status: 404, message: 'Business not found' }
    expect((await run('member', 'b-1')).body.data).toEqual(refusal)
    expect((await run('noMarket', 'b-1')).body.data).toEqual(refusal)
    expect((await run('owner', 'missing')).body.data).toEqual(refusal)
  })

  it('identity comes only from the session token; smuggled fields are refused', async () => {
    const d = deps()
    expect((await call(d, { operation: 'authorize', subject: undefined, body: { businessId: 'b-1', action: 'market.feed.read' } })).status).toBe(401)
    expect((await call(d, { operation: 'authorize', subject: 'owner; zuri_session=x', body: { businessId: 'b-1', action: 'market.feed.read' } })).status).toBe(401)
    expect((await call(d, { operation: 'authorize', subject: 'owner', body: { businessId: 'b-1', action: 'market.feed.read', viewer: { role: 'OWNER' } } })).status).toBe(400)
    // Nothing above reached the resolver: bad subjects and bad bodies stop first.
    expect(d.resolveRequestViewer).not.toHaveBeenCalled()
    await call(d, { operation: 'authorize', subject: 'owner', body: { businessId: 'b-1', action: 'market.feed.read' } })
    expect(d.resolveRequestViewer.mock.calls[0][0].headers.get('cookie')).toBe('zuri_session=owner')
  })

  it('raw candidates re-authorize the subject and refuse a mismatched tenant', async () => {
    const d = deps()
    const ok = await call(d, { operation: 'raw-candidates', subject: 'owner', body: { tenantId: 't-1', businessId: 'b-1', scanLimit: 10 } })
    expect(ok.status).toBe(200)
    expect(ok.body.data.records[0].receivedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(d.listCandidates).toHaveBeenCalledWith(d.db, { tenantId: 't-1', businessId: 'b-1', scanLimit: 10 })
    expect((await call(d, { operation: 'raw-candidates', subject: 'member', body: { tenantId: 't-1', businessId: 'b-1', scanLimit: 10 } })).status).toBe(403)
    expect((await call(d, { operation: 'raw-candidates', subject: 'owner', body: { tenantId: 't-evil', businessId: 'b-1', scanLimit: 10 } })).status).toBe(403)
    expect((await call(d, { operation: 'raw-candidates', subject: 'owner', body: { tenantId: 't-1', businessId: 'b-1', scanLimit: 5000 } })).status).toBe(400)
    expect(d.listCandidates).toHaveBeenCalledTimes(1)
  })

  it('audit accepts only the counts-only translation-run event', async () => {
    const d = deps()
    const event = {
      entityType: 'MARKET_OBSERVATION', entityId: 'b-1', action: 'MARKET_TRANSLATION_RUN',
      payload: { businessId: 'b-1', candidates: 2, eligible: 2, translated: 2, unchanged: 0, failed: 0 },
    }
    expect((await call(d, { operation: 'audit', body: event })).status).toBe(200)
    expect(d.recordAudit).toHaveBeenCalledWith(d.db, event)
    expect((await call(d, { operation: 'audit', body: { ...event, payload: { ...event.payload, candidate: 'raw text' } } })).status).toBe(400)
    expect((await call(d, { operation: 'audit', body: { ...event, action: 'PROJECT_DELETE' } })).status).toBe(400)
  })
})
