// Provider-side conformance to contracts/v1/scm-api.v1.json (the consumer half —
// the Next.js BFF — does not exist yet: CONSUMER_INTEGRATION NOT_RUN). Checks that
// every declared route is served, undeclared ones are not, auth and key rules hold
// at the HTTP boundary, and every error body has the declared shape.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDelegationVerifier } from '../../src/infrastructure/delegation.js'
import { createCommandBus } from '../../src/application/commands.js'
import { createScmHttpServer } from '../../src/http/server.js'
import { BIZ, PRODUCTS, ROLES, TEST_KEY, delegation, idem, openTestStore, seedDatabase, tempDbPath } from '../support/fixtures.js'
import { defaultPricingRules } from '../../src/modules/commerce/pricing/index.js'

const contract = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1', 'scm-api.v1.json'), 'utf8'))
const db = tempDbPath('contract')
let http, store, base
before(async () => {
  seedDatabase(db, { products: Object.values(PRODUCTS) })
  store = openTestStore(db)
  const config = { maxBodyBytes: 16384, requestTimeoutMs: 5000, port: 0, host: '127.0.0.1' }
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
    const res = await call(route.method, path, { token: token(), key: idem('c'), ...(['POST', 'PATCH'].includes(route.method) ? { body: {} } : {}) })
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
  const big = await call('POST', '/v1/procurement/suppliers', { token: token(), key: idem('c'), raw: JSON.stringify({ pad: 'x'.repeat(20000) }) })
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

test('pricing rules over HTTP: draft → PATCH → approve → active → calculate → replay; preview is a keyless query', async () => {
  const owner = () => delegation({ sub: 'per-pricing-owner', grants: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } } })
  const member = () => delegation({ sub: 'per-pricing-member', grants: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write'] } } })
  const input = { costBasis: 'landed', landedUnitCostThb: '123.45', quantity: 100, kind: 'set', profile: 'corporate', orderCostThb: '0', sourceRefs: [] }
  const created = await call('POST', '/v1/commerce/pricing-rules', { token: owner(), key: idem('pr'), body: { businessId: BIZ, name: 'HTTP policy', rules: defaultPricingRules() } })
  assert.equal(created.status, 201)
  const rule = created.body.ruleSet
  assert.equal((await call('POST', '/v1/commerce/pricing-rules', { token: owner(), body: { businessId: BIZ, name: 'x', rules: {} } })).body.error.code, 'SCM_IDEMPOTENCY_KEY_REQUIRED')
  const patched = await call('PATCH', `/v1/commerce/pricing-rules/${rule.id}`, { token: owner(), key: idem('pr'), body: { businessId: BIZ, version: 1, name: 'HTTP policy v2', rules: rule.rules, reason: 'rename' } })
  assert.deepEqual([patched.status, patched.body.ruleSet.version, patched.body.ruleSet.name], [201, 2, 'HTTP policy v2'])
  const invalid = await call('PATCH', `/v1/commerce/pricing-rules/${rule.id}`, { token: owner(), key: idem('pr'), body: { businessId: BIZ, version: 2, name: 'bad', rules: { invalid: true }, reason: 'break' } })
  assert.equal(invalid.status, 422)
  assertErrorShape(invalid.body)
  assert.ok(Array.isArray(invalid.body.error.details))
  const inactive = await call('GET', `/v1/commerce/pricing-rules/active?businessId=${BIZ}`, { token: owner() })
  assert.deepEqual([inactive.status, inactive.body.error.code], [409, 'PRICING_RULE_NOT_ACTIVE'])
  const approved = await call('POST', `/v1/commerce/pricing-rules/${rule.id}/actions`, { token: owner(), key: idem('pr'), body: { businessId: BIZ, version: 2, action: 'APPROVE', reason: 'review' } })
  assert.deepEqual([approved.status, approved.body.ruleSet.status], [201, 'APPROVED'])
  const current = await call('GET', `/v1/commerce/pricing-rules/active?businessId=${BIZ}`, { token: owner() })
  assert.deepEqual([current.status, current.body.ruleSet.id], [200, rule.id])
  const listed = await call('GET', `/v1/commerce/pricing-rules?businessId=${BIZ}`, { token: owner() })
  assert.deepEqual(listed.body.rules.map((r) => [r.id, r.isActive]), [[rule.id, true]])
  const preview = await call('POST', '/v1/commerce/pricing-rules/preview', { token: owner(), body: { businessId: BIZ, rules: rule.rules, input, compareRuleSetId: rule.id } })
  assert.deepEqual([preview.status, preview.body.comparison.deltaTotalPriceSatang], [200, 0])
  const key = idem('calc')
  const calc = await call('POST', '/v1/commerce/pricing-rules/calculate', { token: owner(), key, body: { businessId: BIZ, input } })
  assert.equal(calc.status, 201)
  assert.equal(calc.body.calculation.publishable, false)
  assert.deepEqual(calc.body.calculation.result, preview.body.result)
  const replay = await call('POST', '/v1/commerce/pricing-rules/calculate', { token: owner(), key, body: { businessId: BIZ, input } })
  assert.deepEqual([replay.status, replay.body.replayed, replay.body.calculation.id], [200, true, calc.body.calculation.id])
  const found = await call('GET', `/v1/operations/commerce.pricing.calculate/${key}?businessId=${BIZ}`, { token: owner() })
  assert.equal(found.body.response.calculation.id, calc.body.calculation.id)
  for (const [method, path, body] of [['GET', `/v1/commerce/pricing-rules?businessId=${BIZ}`], ['POST', '/v1/commerce/pricing-rules/preview', { businessId: BIZ, rules: rule.rules, input }], ['POST', '/v1/commerce/pricing-rules/calculate', { businessId: BIZ, input }]]) {
    const denied = await call(method, path, { token: member(), key: idem('m'), body })
    assert.equal(denied.status, 404, `${method} ${path}`)
  }
})

test('inventory catalogue over HTTP: create category → master → product, list, page, UPDATE; ARCHIVE not migrated', async () => {
  const manager = () => delegation({ sub: 'per-http-catalog', grants: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } } })
  const post = (path, body) => call('POST', path, { token: manager(), key: idem('cat'), body })
  const category = await post('/v1/inventory/categories', { businessId: BIZ, code: 'http-cat', nameTh: 'หมวด', nameEn: 'Category' })
  assert.equal(category.status, 201)
  const master = await post('/v1/inventory/product-masters', { businessId: BIZ, code: 'PM-HTTP', categoryId: category.body.category.id, nameTh: 'ของ', nameEn: 'Thing', variantAxes: ['size'] })
  assert.deepEqual([master.status, master.body.master.variantAxes], [201, ['size']])
  const product = await post('/v1/inventory/products', { businessId: BIZ, code: 'SKU-HTTP-M', productMasterId: master.body.master.id, name: 'Thing M', variant: { size: 'M' } })
  assert.deepEqual([product.status, product.body.product.variantKey], [201, 'size=m'])
  const listed = await call('GET', `/v1/inventory/products?businessId=${BIZ}&productMasterId=${master.body.master.id}`, { token: manager() })
  assert.deepEqual(listed.body.products.map((p) => p.code), ['SKU-HTTP-M'])
  const page = await call('GET', `/v1/inventory/products/${product.body.product.id}`, { token: manager() })
  assert.deepEqual([page.status, page.body.product.onHand, page.body.product.supplierCostPriceBreaks], [200, 0, []])
  const updated = await post(`/v1/inventory/products/${product.body.product.id}/actions`, { action: 'UPDATE', version: 1, fields: { name: 'Thing medium' } })
  assert.deepEqual([updated.status, updated.body.product.name, updated.body.product.version], [201, 'Thing medium', 2])
  const archive = await post(`/v1/inventory/products/${product.body.product.id}/actions`, { action: 'ARCHIVE', version: 2 })
  assert.deepEqual([archive.status, archive.body.error.code], [409, 'SCM_PRODUCT_ACTION_NOT_MIGRATED'])
  const invalid = await post('/v1/inventory/products', { businessId: BIZ, code: 'SKU-HTTP-X', productMasterId: master.body.master.id })
  assert.deepEqual([invalid.status, invalid.body.error.code], [422, 'INVENTORY_VARIANT_AXES_INCOMPLETE'])
  assert.ok(invalid.body.error.details)
})
