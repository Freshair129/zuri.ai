import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

// A fake core that speaks the market-core.v1 façade contract the Market service
// expects at /api/internal/market-intelligence/v1/*. It exists for tests and the local
// image-start rehearsal only, announces itself as mode "fake" so readiness can never
// mistake it for production, and records every request so tests can assert headers.
//
// Subjects are opaque strings mapped to actors: { sees, owns, marketHidden }.

const BUSINESSES = {
  'business-a': { tenantId: 'tenant-t', name: 'A' },
  'business-b': { tenantId: 'tenant-t', name: 'B' },
}

export function createFakeCore({
  token,
  subjects = {},
  rawRecords = [],
  ownsTranslation = true,
  businesses = BUSINESSES,
  failAudit = false,
} = {}) {
  const requests = []
  const audits = []
  const state = { ownsTranslation, down: false }

  function reply(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const ok = (response, data) => reply(response, 200, { contractVersion: 'market-core.v1', ok: true, data })

  function decide(actor, businessId, action) {
    const business = businesses[businessId]
    const sees = actor?.sees?.includes(businessId)
    const hidden = actor?.marketHidden?.includes(businessId)
    const refuse = (status, message) => ({ allowed: false, status, message })
    if (action === 'market.feed.read') {
      if (!sees) return refuse(403, 'Business access denied')
      if (hidden || !business) return refuse(404, 'Business not found')
    } else if (action === 'market.translation.run') {
      if (!business || hidden || !actor?.owns?.includes(businessId)) return refuse(404, 'Business not found')
    } else {
      return refuse(404, 'Business not found')
    }
    return { allowed: true, scope: { tenantId: business.tenantId, businessId, businessName: business.name } }
  }

  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    const path = new URL(request.url, 'http://core.invalid').pathname.replace('/api/internal/market-intelligence/v1', '')
    requests.push({ method: request.method, path, headers: request.headers, body })

    if (state.down) return reply(response, 503, { error: 'down' })
    if (request.headers.authorization !== `Bearer ${token}`) return reply(response, 401, { error: 'bad service token' })

    const subject = request.headers['x-zuri-subject']
    if (path === '/health') return ok(response, { ok: true, mode: 'fake' })
    if (path === '/execution-ownership') return ok(response, { ownsTranslation: state.ownsTranslation })
    // An unknown subject is not a live session: core answers 401, like legacy.
    if (path === '/authorize') {
      if (!subjects[subject]) return ok(response, { allowed: false, status: 401, message: 'AUTH_REQUIRED' })
      return ok(response, decide(subjects[subject], body.businessId, body.action))
    }
    if (path === '/raw-candidates') {
      const decision = decide(subjects[subject], body.businessId, 'market.translation.run')
      if (!decision.allowed || decision.scope.tenantId !== body.tenantId) return reply(response, 403, { error: 'scope' })
      const records = rawRecords
        .filter((row) => row.tenantId === body.tenantId && row.businessId === body.businessId)
        .slice(0, body.scanLimit)
      return ok(response, { records })
    }
    if (path === '/audit') {
      if (failAudit) return reply(response, 500, { error: 'audit unavailable' })
      audits.push(body)
      return ok(response, { recorded: true })
    }
    return reply(response, 404, { error: 'not found' })
  })

  return {
    server,
    requests,
    audits,
    state,
    async listen(port = 0) {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
      return `http://127.0.0.1:${server.address().port}`
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// `node test/support/fake-core.js` — used by compose.yml for the local image-start
// rehearsal. Configuration comes from the environment.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const core = createFakeCore({
    token: process.env.MARKET_CORE_TOKEN,
    subjects: { 'rehearsal-owner': { sees: ['business-a'], owns: ['business-a'] } },
    rawRecords: [{
      id: 'raw-rehearsal-1', tenantId: 'tenant-t', businessId: 'business-a', connectionId: 'conn-a',
      provider: 'MARKET_TEST', lane: 'MARKET_INTELLIGENCE', entityType: 'listing', externalId: 'listing-1',
      sourceUri: null, payloadJson: JSON.stringify({ title: 'Rehearsal item', price: 100 }),
      payloadHash: 'c'.repeat(64), receivedAt: '2026-09-24T00:00:00.000Z',
    }],
  })
  core.server.listen(Number(process.env.FAKE_CORE_PORT || 3999), '0.0.0.0')
}
