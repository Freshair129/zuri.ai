// Provider-side conformance to contracts/v1/scm-api.v1.json (the consumer half —
// the Next.js BFF — does not exist yet: CONSUMER_INTEGRATION NOT_RUN). Checks that
// every declared route is served, undeclared ones are not, auth and key rules hold
// at the HTTP boundary, and every error body has the declared shape.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSqliteStore } from '../../src/infrastructure/sqlite-store.js'
import { createDelegationVerifier } from '../../src/infrastructure/delegation.js'
import { createCommandBus } from '../../src/application/commands.js'
import { createScmHttpServer } from '../../src/http/server.js'
import { BIZ, PRODUCTS, ROLES, TEST_KEY, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const contract = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1', 'scm-api.v1.json'), 'utf8'))
const db = tempDbPath('contract')
let http, store, base
before(async () => {
  seedDatabase(db.path, { products: Object.values(PRODUCTS) })
  store = openSqliteStore({ location: db.path })
  const config = { maxBodyBytes: 4096, requestTimeoutMs: 5000, port: 0, host: '127.0.0.1' }
  http = createScmHttpServer({ config, store, bus: createCommandBus({ store }), verify: createDelegationVerifier({ key: TEST_KEY }) })
  base = `http://127.0.0.1:${(await http.listen(0)).port}`
})
after(async () => { await http.close(); await store.close(); db.cleanup() })

const call = async (method, path, { token, key, body, raw, type = 'application/json' } = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Delegation ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined || raw ? { 'content-type': type } : {}) }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) })
  return { status: res.status, body: await res.json() }
}
const assertErrorShape = (body) => {
  assert.equal(typeof body.error.code, 'string')
  assert.equal(typeof body.error.message, 'string')
  assert.equal(typeof body.error.retryable, 'boolean')
}
const token = () => delegation({ grants: { [BIZ]: ROLES.receiverFull } })

test('every declared route is served; an undeclared one is 404 SCM_ROUTE_NOT_FOUND', async () => {
  for (const route of contract.routes) {
    const path = route.path.replace('{id}', 'no-such-order').replace('{action}', 'procurement.goods-receipt.post').replace('{key}', 'k-00000000').replace(/\?.*$/, `?businessId=${BIZ}`)
    const res = await call(route.method, path, { token: token(), key: idem('c'), ...(route.method === 'POST' ? { body: {} } : {}) })
    assert.notEqual(res.body.error?.code, 'SCM_ROUTE_NOT_FOUND', `${route.method} ${route.path}`)
    if (res.body.error) assertErrorShape(res.body)
  }
  const unknown = await call('DELETE', '/v1/procurement/purchase-orders/x', { token: token() })
  assert.deepEqual([unknown.status, unknown.body.error.code], [404, 'SCM_ROUTE_NOT_FOUND'])
  const sqlish = await call('POST', '/v1/sql', { token: token(), key: idem('c'), body: { q: 'select 1' } })
  assert.equal(sqlish.status, 404)
})

test('boundary refusals: auth, key, media type, size, malformed JSON', async () => {
  const noAuth = await call('GET', `/v1/inventory/stock?businessId=${BIZ}`)
  assert.deepEqual([noAuth.status, noAuth.body.error.code], [401, 'SCM_DELEGATION_REQUIRED'])
  const forged = await call('GET', `/v1/inventory/stock?businessId=${BIZ}`, { token: delegation({ key: 'f'.repeat(48) }) })
  assert.deepEqual([forged.status, forged.body.error.code], [401, 'SCM_DELEGATION_INVALID'])
  const noKey = await call('POST', '/v1/procurement/suppliers', { token: token(), body: { businessId: BIZ, code: 'S1', name: 'n' } })
  assert.deepEqual([noKey.status, noKey.body.error.code], [400, 'SCM_IDEMPOTENCY_KEY_REQUIRED'])
  const text = await call('POST', '/v1/procurement/suppliers', { token: token(), key: idem('c'), raw: 'a=b', type: 'text/plain' })
  assert.equal(text.status, 415)
  const big = await call('POST', '/v1/procurement/suppliers', { token: token(), key: idem('c'), raw: JSON.stringify({ pad: 'x'.repeat(8000) }) })
  assert.equal(big.status, 413)
  const bad = await call('POST', '/v1/procurement/suppliers', { token: token(), key: idem('c'), raw: '{"a":' })
  assert.deepEqual([bad.status, bad.body.error.code], [400, 'SCM_MALFORMED_JSON'])
  for (const r of [noAuth, forged, noKey, text, big, bad]) assertErrorShape(r.body)
})

test('body-supplied authority is ignored: role/owner flags in the payload change nothing', async () => {
  const buyerOnly = delegation({ grants: { [BIZ]: ROLES.inventoryOnly } })
  const res = await call('POST', '/v1/procurement/suppliers', { token: buyerOnly, key: idem('c'), body: { businessId: BIZ, code: 'S-OWN', name: 'n', owner: true, role: 'OWNER' } })
  assert.equal(res.status, 404, 'no procurement grant → not found, whatever the body claims')
})

test('created vs replayed status codes match the contract', async () => {
  const key = idem('c')
  const body = { businessId: BIZ, code: 'S-REPLAY', name: 'Replay Co' }
  assert.equal((await call('POST', '/v1/procurement/suppliers', { token: token(), key, body })).status, contract.mutations.created)
  const again = await call('POST', '/v1/procurement/suppliers', { token: token(), key, body })
  assert.deepEqual([again.status, again.body.replayed], [contract.mutations.replayed, true])
})
