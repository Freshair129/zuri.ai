// Core mode end to end (contract scm-core.v1, SCM_AUTH_MODE=core): the REAL SCM
// process (src/main.js) behind a synthetic core on loopback. The BFF's static
// bearer proves only who is calling; the scope comes from core resolving the
// end user's subject, and Branch / Customer / Conversation facts come from the
// same façade. Proves: queries and a POS sale work with the resolved scope; a bad
// service token or a missing subject is refused before core is asked; core down →
// 503 retryable with no effect; a subject core rejects → 401; a Business with no
// grant → the same 404 as today; foreign facts are refused by SCM's own
// predicate; the subject and both tokens never reach the logs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { startFakeCore, API_TOKEN, CORE_TOKEN } from '../support/fake-core.js'
import { BIZ, LOCATIONS, PRODUCTS, ROLES, TENANT, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const S = {
  cashier: 'session-synthetic-cashier-7f3a9c',
  outsider: 'session-synthetic-outsider-2b8e41',
  unknown: 'session-synthetic-expired-9d0c55',
}
const subjects = {
  [S.cashier]: { actorId: 'person-core-cashier', tenantId: TENANT, grants: { [BIZ]: ROLES.cashier } },
  [S.outsider]: { actorId: 'person-core-outsider', tenantId: TENANT, grants: {} },
}
const db = tempDbPath('core-mode')
seedDatabase(db, { products: [PRODUCTS.plain], locations: [LOCATIONS.shop], stock: [{ productId: PRODUCTS.plain.id, quantity: 5 }] })
let core, scm
const coreEnv = (over = {}) => ({ SCM_AUTH_MODE: 'core', SCM_API_TOKEN: API_TOKEN, SCM_CORE_URL: core.url, SCM_CORE_TOKEN: CORE_TOKEN, SCM_CORE_TIMEOUT_MS: '1000', ...over })
before(async () => {
  core = await startFakeCore({ subjects })
  scm = await startScmProcess({ db, env: coreEnv() })
})
after(async () => { await scm?.kill(); await core?.close(); db.cleanup() })

const as = (subject, { bearer = API_TOKEN } = {}) => ({ ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(subject !== undefined ? { 'x-zuri-subject': subject } : {}) })
const get = (path, headers) => scm.request('GET', path, { headers })
const sale = (over = {}) => ({ businessId: BIZ, branchId: 'branch-main', warehouseLocationId: LOCATIONS.shop.id, lines: [{ productId: PRODUCTS.plain.id, qty: 1, unitPrice: 99 }], payment: { method: 'CASH', receivedAmount: 100 }, ...over })
const count = (table) => { const raw = openRaw(db); try { return raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n } finally { raw.close() } }
const coreCalls = () => core.state.calls.length

test('the process starts in core mode and says so, without secrets', () => {
  const listening = scm.logs.find((l) => l.message === 'listening')
  assert.deepEqual([listening.auth, listening.references], ['core', 'core'])
})

test('revenue and the POS terminal catalogue answer with the core-resolved scope', async () => {
  const revenue = await get(`/v1/commerce/revenue?businessId=${BIZ}`, as(S.cashier))
  assert.deepEqual([revenue.status, revenue.body.businessId], [200, BIZ])
  const catalogue = await get(`/v1/commerce/pos/catalogue?businessId=${BIZ}`, as(S.cashier))
  assert.equal(catalogue.status, 200)
  assert.deepEqual(catalogue.body.branches.map((b) => b.code), ['BR-MAIN'], 'core facts, then SCM\'s own ACTIVE filter')
  assert.deepEqual(catalogue.body.items.map((i) => [i.code, i.onHand]), [['SYN-PLAIN', 5]])
  const calls = core.state.calls.slice(-3)
  assert.deepEqual(calls.map((c) => c.op), ['resolve-scope', 'resolve-scope', 'branches'])
  assert.ok(calls.every((c) => c.subject === S.cashier && c.authorization === `Bearer ${CORE_TOKEN}`), 'core sees SCM\'s own token and the unchanged subject')
})

test('a missing or wrong service token is 401 before core is asked', async () => {
  const before = coreCalls()
  for (const headers of [as(S.cashier, { bearer: null }), as(S.cashier, { bearer: CORE_TOKEN }), as(S.cashier, { bearer: `${API_TOKEN}x` }), { authorization: `Delegation ${API_TOKEN}`, 'x-zuri-subject': S.cashier }]) {
    const res = await get(`/v1/commerce/revenue?businessId=${BIZ}`, headers)
    assert.deepEqual([res.status, res.body.error.code, res.body.error.retryable], [401, 'SCM_SERVICE_TOKEN_INVALID', false])
  }
  assert.equal(coreCalls(), before)
})

test('a missing, empty or oversized subject is 401 before core is asked', async () => {
  const before = coreCalls()
  for (const subject of [undefined, '', 's'.repeat(4097)]) {
    const res = await get(`/v1/commerce/revenue?businessId=${BIZ}`, as(subject))
    assert.deepEqual([res.status, res.body.error.code], [401, 'SCM_SUBJECT_REQUIRED'])
  }
  assert.equal(coreCalls(), before)
})

test('a subject core rejects is 401 SCM_SUBJECT_UNAUTHENTICATED', async () => {
  const res = await get(`/v1/commerce/revenue?businessId=${BIZ}`, as(S.unknown))
  assert.deepEqual([res.status, res.body.error.code, res.body.error.retryable], [401, 'SCM_SUBJECT_UNAUTHENTICATED', false])
})

test('a Business the subject holds no grant for is the same 404 as today', async () => {
  for (const path of [`/v1/commerce/revenue?businessId=${BIZ}`, `/v1/commerce/pos/catalogue?businessId=${BIZ}`, '/v1/commerce/revenue?businessId=biz-unknown']) {
    const res = await get(path, as(path.includes('unknown') ? S.cashier : S.outsider))
    assert.deepEqual([res.status, res.body.error.code], [404, 'SCM_SCOPE_NOT_FOUND'], path)
  }
  const write = await scm.request('POST', '/v1/commerce/pos/checkout', { headers: as(S.outsider), key: idem('pos'), body: sale() })
  assert.deepEqual([write.status, write.body.error.code], [404, 'SCM_SCOPE_NOT_FOUND'])
})

test('core down → 503 retryable with no effect; back up → the same sale commits', async () => {
  const orders = count('SalesOrder')
  const receipts = count('ScmOperationReceipt')
  const key = idem('pos')
  try {
    core.state.down = true
    const down = await scm.request('POST', '/v1/commerce/pos/checkout', { headers: as(S.cashier), key, body: sale() })
    assert.deepEqual([down.status, down.body.error.code, down.body.error.retryable], [503, 'SCM_CORE_UNAVAILABLE', true])
    core.state.down = false
    core.state.downOps.add('branch')
    const factDown = await scm.request('POST', '/v1/commerce/pos/checkout', { headers: as(S.cashier), key, body: sale() })
    assert.deepEqual([factDown.status, factDown.body.error.code, factDown.body.error.retryable, factDown.body.error.details], [503, 'SCM_CORE_UNAVAILABLE', true, { reference: 'branch' }])
    assert.equal(count('SalesOrder'), orders, 'no effect')
    assert.equal(count('ScmOperationReceipt'), receipts)
  } finally { core.state.down = false; core.state.downOps.clear() }
  const up = await scm.request('POST', '/v1/commerce/pos/checkout', { headers: as(S.cashier), key, body: sale() })
  assert.deepEqual([up.status, up.body.branch.code, up.body.paymentStatus], [201, 'BR-MAIN', 'PENDING'])
  assert.equal(count('SalesOrder'), orders + 1)
})

test('facts of another Business or Tenant are refused by SCM exactly like the fixture tests', async () => {
  const orders = count('SalesOrder')
  const foreignBranch = await scm.request('POST', '/v1/commerce/pos/checkout', { headers: as(S.cashier), key: idem('pos'), body: sale({ branchId: 'branch-foreign' }) })
  assert.deepEqual([foreignBranch.status, foreignBranch.body.error.code], [422, 'POS_BRANCH_NOT_CONFIGURED'])
  const order = (over) => scm.request('POST', '/v1/commerce/orders', { headers: as(S.cashier), key: idem('so'), body: { businessId: BIZ, lines: [{ description: 'บริการ', qty: 1, unitPrice: 10 }], ...over } })
  for (const [over, code] of [[{ customerId: 'cust-other-tenant' }, 'CUSTOMER_NOT_FOUND'], [{ customerId: 'cust-hidden' }, 'CUSTOMER_NOT_FOUND'], [{ customerId: 'cust-deleted' }, 'CUSTOMER_NOT_FOUND'], [{ conversationId: 'conv-hidden' }, 'CONVERSATION_NOT_FOUND'], [{ customerId: 'no-such' }, 'CUSTOMER_NOT_FOUND']]) {
    const res = await order(over)
    assert.deepEqual([res.status, res.body.error.code], [422, code], JSON.stringify(over))
  }
  assert.equal(count('SalesOrder'), orders)
  const chat = await order({ conversationId: 'conv-own' })
  assert.deepEqual([chat.status, chat.body.order.customerId, chat.body.references.authority], [201, 'cust-own', 'core'])
})

test('a process whose own core token core refuses answers 502 SCM_CORE_REJECTED, never a 500', async () => {
  const wrong = await startScmProcess({ db, env: coreEnv({ SCM_CORE_TOKEN: 'scm-core-token-synthetic-WRONG-00000000000' }) })
  try {
    const res = await wrong.request('GET', `/v1/commerce/revenue?businessId=${BIZ}`, { headers: as(S.cashier) })
    assert.deepEqual([res.status, res.body.error.code, res.body.error.retryable], [502, 'SCM_CORE_REJECTED', false])
  } finally { await wrong.kill() }
})

test('the subject and both tokens never reach the logs', () => {
  const text = JSON.stringify(scm.logs)
  assert.ok(scm.logs.some((l) => l.message === 'request'), 'requests were logged')
  for (const secret of [...Object.values(S), API_TOKEN, CORE_TOKEN, 'Bearer']) assert.ok(!text.includes(secret), 'a secret reached the log')
})
