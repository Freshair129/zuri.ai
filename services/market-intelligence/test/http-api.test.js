import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createMarketHttpServer, MAX_BODY_BYTES } from '../src/http/server.js'
import { createCoreClient } from '../src/adapters/core-client.js'
import { createSqliteObservationStoreFactory } from '../src/adapters/sqlite-observation-store.js'
import { createFakeCore } from './support/fake-core.js'
import { rawRecord } from './fakes.js'

// M2 workflow proof: raw evidence held by (fake) core → authenticated translation in the
// Market service process API → durable observation in an owned store → scoped feed.
// Real HTTP on both hops, real SQLite; the fake is the core façade that M3 builds.

const API_TOKEN = 'a'.repeat(40)
const CORE_TOKEN = 'c'.repeat(40)
const OWNER = 'subject-owner-a'
const VIEWER = 'subject-viewer-a'
const vectors = JSON.parse(readFileSync(new URL('../contracts/v1/translation-vectors.json', import.meta.url), 'utf8'))

async function boot({ coreOptions = {}, config = {} } = {}) {
  const core = createFakeCore({
    token: CORE_TOKEN,
    subjects: {
      [OWNER]: { sees: ['business-a'], owns: ['business-a'] },
      [VIEWER]: { sees: ['business-a'], owns: [] },
    },
    ...coreOptions,
  })
  const coreUrl = await core.listen()
  const storeFactory = createSqliteObservationStoreFactory({ location: ':memory:' })
  const http = createMarketHttpServer({
    config: { apiToken: API_TOKEN, production: false, assumeExecutionOwner: false, ...config },
    storeFactory,
    core: createCoreClient({ baseUrl: coreUrl, token: CORE_TOKEN, retries: 1, backoffMs: 1, timeoutMs: 1000 }),
    now: () => new Date('2026-09-24T01:00:00.000Z'),
  })
  const address = await http.listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${address.port}`
  const call = (method, path, { subject = OWNER, token = API_TOKEN, body, raw } = {}) => fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(subject ? { 'x-zuri-subject': subject } : {}),
      ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  return {
    core,
    storeFactory,
    call,
    async close() {
      await http.close()
      await core.close()
      await storeFactory.close()
    },
  }
}

let app
before(async () => {
  app = await boot({
    coreOptions: {
      rawRecords: [
        rawRecord({ id: 'r1', receivedAt: '2026-09-01T00:00:00.000Z' }),
        rawRecord({ id: 'r2', receivedAt: '2026-09-02T00:00:00.000Z' }),
        rawRecord({ id: 'rb', businessId: 'business-b', receivedAt: '2026-09-02T00:00:00.000Z' }),
      ],
    },
  })
})
after(() => app.close())

test('raw evidence → translation in the service → durable observation → scoped feed', async () => {
  const run = await app.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })
  assert.equal(run.status, 200)
  assert.deepEqual(await run.json(), { translated: 2, unchanged: 0, failed: [] })

  const replay = await app.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })
  assert.deepEqual(await replay.json(), { translated: 0, unchanged: 0, failed: [] })

  const feed = await (await app.call('GET', '/v1/observations?businessId=business-a', { subject: VIEWER })).json()
  assert.equal(feed.version, '1.0')
  assert.deepEqual(feed.scope, { businessId: 'business-a', businessName: 'A', tenantId: 'tenant-t' })
  assert.deepEqual(feed.observations.map((row) => row.externalId), ['ext-r2', 'ext-r1'])
  assert.equal(feed.counts.byResolutionStatus.UNRESOLVED, 2)
  assert.equal(feed.truncated, false)
})

test('core sees the service token and the byte-identical user subject, never mixed up', async () => {
  const authorize = app.core.requests.filter((r) => r.path === '/authorize')
  assert.ok(authorize.length > 0)
  for (const request of authorize) {
    assert.equal(request.headers.authorization, `Bearer ${CORE_TOKEN}`)
    assert.ok([OWNER, VIEWER].includes(request.headers['x-zuri-subject']))
    assert.notEqual(request.headers.authorization, `Bearer ${API_TOKEN}`)
    assert.deepEqual(Object.keys(request.body).sort(), ['action', 'businessId'])
  }
  const audit = app.core.requests.find((r) => r.path === '/audit')
  assert.equal(audit.headers['x-zuri-subject'], undefined)
  assert.equal(app.core.audits[0].action, 'MARKET_TRANSLATION_RUN')
  assert.doesNotMatch(JSON.stringify(app.core.audits), /Item r1/)
})

test('the BFF token and the subject are both required', async () => {
  assert.equal((await app.call('GET', '/v1/observations?businessId=business-a', { token: null })).status, 401)
  assert.equal((await app.call('GET', '/v1/observations?businessId=business-a', { token: 'x'.repeat(40) })).status, 401)
  assert.equal((await app.call('GET', '/v1/observations?businessId=business-a', { subject: null })).status, 401)
})

test('refusals keep the legacy statuses and bodies', async () => {
  const unseen = await app.call('GET', '/v1/observations?businessId=business-b', { subject: VIEWER })
  assert.equal(unseen.status, 403)
  assert.deepEqual(await unseen.json(), { error: 'Business access denied' })
  const notOwner = await app.call('POST', '/v1/translations', { subject: VIEWER, body: { businessId: 'business-a' } })
  assert.equal(notOwner.status, 404)
  assert.deepEqual(await notOwner.json(), { error: 'Business not found' })
  const unknownSubject = await app.call('GET', '/v1/observations?businessId=business-a', { subject: 'nobody' })
  assert.equal(unknownSubject.status, 403)
})

test('strict input: unknown keys, bad JSON and oversized bodies are refused', async () => {
  const extra = await app.call('POST', '/v1/translations', { body: { businessId: 'business-a', tenantId: 'tenant-evil' } })
  assert.equal(extra.status, 400)
  assert.equal((await extra.json()).error, 'Validation failed')
  assert.equal((await app.call('POST', '/v1/translations', { raw: '{nope' })).status, 400)
  assert.equal((await app.call('POST', '/v1/translations', { raw: JSON.stringify({ businessId: 'x'.repeat(MAX_BODY_BYTES) }) })).status, 413)
  assert.equal((await app.call('GET', '/v1/observations?businessId=business-a&tenantId=t')).status, 400)
})

test('readiness reports a fake core as fake', async () => {
  const response = await app.call('GET', '/readyz', { token: null, subject: null })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ready: true, deps: { store: 'sqlite', core: 'fake' }, ownsTranslation: true })
  assert.equal((await app.call('GET', '/healthz', { token: null, subject: null })).status, 200)
})

test('a production config never becomes ready on a fake core', async () => {
  const prod = await boot({ config: { production: true } })
  try {
    const response = await prod.call('GET', '/readyz')
    assert.equal(response.status, 503)
    assert.equal((await response.json()).reason, 'CORE_NOT_PRODUCTION')
  } finally {
    await prod.close()
  }
})

test('core unreachable fails closed: 503 on reads and writes, not ready, no cached decision', async () => {
  const down = await boot()
  try {
    assert.equal((await down.call('GET', '/v1/observations?businessId=business-a')).status, 200)
    down.core.state.down = true
    const read = await down.call('GET', '/v1/observations?businessId=business-a')
    assert.equal(read.status, 503)
    assert.deepEqual(await read.json(), {
      error: 'Core authority is unavailable', code: 'CORE_UNAVAILABLE', phase: 'before-write', committed: false,
    })
    assert.equal((await down.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })).status, 503)
    assert.equal((await down.call('GET', '/readyz')).status, 503)
  } finally {
    await down.close()
  }
})

test('the service refuses translation writes unless core says it owns execution', async () => {
  const gated = await boot({ coreOptions: { ownsTranslation: false, rawRecords: [rawRecord({ id: 'g1' })] } })
  try {
    const response = await gated.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'MARKET_NOT_EXECUTION_OWNER')
    const store = await gated.storeFactory.open({ tenantId: 'tenant-t', businessId: 'business-a' })
    assert.deepEqual(await store.listRecent({ limit: 10 }), [])
    // Reads do not need execution ownership.
    assert.equal((await gated.call('GET', '/v1/observations?businessId=business-a')).status, 200)
  } finally {
    await gated.close()
  }
})

// Legacy answers 500 here; across the process boundary the audit owner being down is a
// dependency outage, so the service says 503 CORE_UNAVAILABLE. The semantics that matter
// are unchanged: the caller sees a failure and the observations stay committed.
test('an audit failure after the writes is surfaced and the observations stay committed', async () => {
  const noAudit = await boot({ coreOptions: { failAudit: true, rawRecords: [rawRecord({ id: 'a1' })] } })
  try {
    const response = await noAudit.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: 'Core authority is unavailable', code: 'CORE_UNAVAILABLE', phase: 'audit', committed: true,
    })
    const store = await noAudit.storeFactory.open({ tenantId: 'tenant-t', businessId: 'business-a' })
    assert.equal((await store.listRecent({ limit: 10 })).length, 1)
  } finally {
    await noAudit.close()
  }
})

test('HTTP-level parity: service-translated rows equal the v1 vectors', async () => {
  const cases = vectors.translations.filter((v) => v.expected && v.raw.businessId === 'business-a' && !v.resolution)
  const parity = await boot({
    coreOptions: {
      rawRecords: cases.map((v) => v.raw),
      businesses: { 'business-a': { tenantId: 'tenant-t', name: 'A' } },
    },
  })
  try {
    const run = await (await parity.call('POST', '/v1/translations', { body: { businessId: 'business-a' } })).json()
    assert.equal(run.translated, cases.length)
    const store = await parity.storeFactory.open({ tenantId: 'tenant-t', businessId: 'business-a' })
    const rows = await store.listRecent({ limit: 50 })
    for (const vector of cases) {
      const row = rows.find((r) => r.lineageKey === vector.expected.lineageKey)
      assert.ok(row, vector.name)
      const { id, createdAt, ...stored } = row
      assert.deepEqual(
        { ...stored, observedAt: stored.observedAt.toISOString(), translatedAt: stored.translatedAt.toISOString() },
        vector.expected,
        vector.name,
      )
    }
  } finally {
    await parity.close()
  }
})
