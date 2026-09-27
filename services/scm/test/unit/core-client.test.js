// The SCM consumer half of contracts/v1/scm-core.v1.json against an injected fake
// fetch (and one real loopback server for the redirect refusal): envelopes and
// fact shapes are validated strictly, every failure of core is closed (503
// SCM_CORE_UNAVAILABLE, retried once), core's refusals are told apart (401
// SUBJECT_UNAUTHENTICATED vs 502 SCM_CORE_REJECTED) and never retried, and the
// service token and the subject go exactly where they belong. The Business
// selector is validated before core is asked, core's two resolve-scope 404s are
// the legacy "Business not found", and the success-only scope cache never answers
// a refusal, never outlives its TTL and never crosses subjects or Businesses.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createScmCoreClient, CORE_CONTRACT_VERSION, SUBJECT_HEADER, MAX_GRANTS } from '../../src/infrastructure/core-client.js'
import { createCoreReferenceAuthority, createCoreScopeResolver } from '../../src/infrastructure/core-reference-authority.js'
import { createScopeCache, scopeCacheKey } from '../../src/infrastructure/scope-cache.js'
import { commerceAuthority, denied } from '../../src/infrastructure/delegation.js'

const TOKEN = 'scm-core-token-synthetic-0000000000000000'
const SUBJECT = 'session-synthetic-subject-abc123'
const BASE = 'http://core.test:3000'
const ok = (data) => ({ contractVersion: CORE_CONTRACT_VERSION, ok: true, data })
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const SCOPE = { actorId: 'person-a', tenantId: 'tenant-a', grants: { 'biz-a': { owner: false, domains: ['commerce', 'inventory'], permissions: ['commerce.order.write'] } } }
const BRANCH = { id: 'br-1', code: 'BR-1', name: 'Main', tenantId: 'tenant-a', businessId: 'biz-a', status: 'ACTIVE' }
const BRANCH_ROW = { id: 'br-1', code: 'BR-1', name: 'Main', address: null, kind: 'SITE', status: 'ACTIVE', tenantId: 'tenant-a', businessId: 'biz-a' }
const CUSTOMER = { id: 'cu-1', code: 'CUS-1', tenantId: 'tenant-a', businessId: null, deletedAt: null }
const CONVERSATION = { id: 'cv-1', tenantId: 'tenant-a', businessId: 'biz-a', customerId: 'cu-1' }

/** A fake fetch: `answer(op, init, n)` returns a Response (or throws); every call is recorded. */
function fakeCore(answer) {
  const calls = []
  const fetchFn = async (url, init) => {
    const op = new URL(url).pathname.replace('/api/internal/scm/v1/', '')
    calls.push({ url: String(url), op, init })
    return answer(op, init, calls.length)
  }
  return { calls, fetchFn }
}
const client = (fetchFn, over = {}) => createScmCoreClient({ baseUrl: BASE, token: TOKEN, fetchFn, sleep: async () => {}, random: () => 0.5, ...over })
const rejectsWith = (promise, expected) => assert.rejects(promise, (e) => Object.entries(expected).every(([k, v]) => e[k] === v) || assert.fail(`got ${e.status} ${e.code} ${e.reason}`))

describe('scm-core.v1 client — happy paths', () => {
  test('every operation: POST, JSON body, bearer + subject header, redirect refused, strict data', async () => {
    const data = { 'resolve-scope': SCOPE, branch: { fact: BRANCH }, branches: { branches: [BRANCH_ROW] }, customer: { fact: CUSTOMER }, conversation: { fact: null } }
    const core = fakeCore((op) => json(200, ok(data[op])))
    const c = client(core.fetchFn)
    assert.deepEqual(await c.resolveScope(SUBJECT, 'biz-a'), SCOPE)
    assert.deepEqual(await c.branch(SUBJECT, { businessId: 'biz-a', branchId: 'br-1' }), BRANCH)
    assert.deepEqual(await c.branches(SUBJECT, { businessId: 'biz-a' }), [BRANCH_ROW])
    assert.deepEqual(await c.customer(SUBJECT, { businessId: 'biz-a', customerId: 'cu-1' }), CUSTOMER)
    assert.equal(await c.conversation(SUBJECT, { businessId: 'biz-a', conversationId: 'cv-9' }), null)
    assert.deepEqual(core.calls.map((x) => x.op), ['resolve-scope', 'branch', 'branches', 'customer', 'conversation'])
    for (const { url, init } of core.calls) {
      assert.match(url, /^http:\/\/core\.test:3000\/api\/internal\/scm\/v1\//)
      assert.equal(init.method, 'POST')
      assert.equal(init.redirect, 'error')
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`)
      assert.equal(init.headers[SUBJECT_HEADER], SUBJECT)
      assert.equal(init.headers['content-type'], 'application/json')
      assert.ok(init.signal instanceof AbortSignal)
    }
    assert.deepEqual(core.calls.map((x) => JSON.parse(x.init.body)), [{ businessId: 'biz-a' }, { businessId: 'biz-a', branchId: 'br-1' }, { businessId: 'biz-a' }, { businessId: 'biz-a', customerId: 'cu-1' }, { businessId: 'biz-a', conversationId: 'cv-9' }])
  })

  test('a base URL with a path keeps it; a configured URL with credentials, query or hash is refused', async () => {
    const core = fakeCore(() => json(200, ok(SCOPE)))
    await createScmCoreClient({ baseUrl: 'https://core.test/core-prefix/', token: TOKEN, fetchFn: core.fetchFn }).resolveScope(SUBJECT, 'biz-a')
    assert.equal(core.calls[0].url, 'https://core.test/core-prefix/api/internal/scm/v1/resolve-scope')
    for (const baseUrl of ['http://u:p@core.test', 'http://core.test/?a=1', 'http://core.test/#x', 'ftp://core.test', 'not a url']) {
      assert.throws(() => createScmCoreClient({ baseUrl, token: TOKEN }), (e) => e.code === 'SCM_CONFIG_INVALID' && !e.message.includes('core.test'))
    }
    assert.throws(() => createScmCoreClient({ baseUrl: BASE, token: 'short' }), (e) => e.code === 'SCM_CONFIG_INVALID' && !e.message.includes('short'))
  })

  test('the subject is required and bounded before core is ever called', async () => {
    const core = fakeCore(() => json(200, ok(SCOPE)))
    for (const subject of [undefined, '', 'x'.repeat(4097), 42]) await rejectsWith(client(core.fetchFn).resolveScope(subject, 'biz-a'), { status: 401, code: 'SCM_SUBJECT_REQUIRED' })
    assert.equal(core.calls.length, 0)
  })
})

describe('scm-core.v1 client — failure is closed', () => {
  test('a timeout is 503 SCM_CORE_UNAVAILABLE (TIMEOUT), retried once', async () => {
    const core = fakeCore((op, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    await rejectsWith(client(core.fetchFn, { timeoutMs: 20 }).resolveScope(SUBJECT, 'biz-a'), { status: 503, code: 'SCM_CORE_UNAVAILABLE', retryable: true, reason: 'TIMEOUT' })
    assert.equal(core.calls.length, 2)
  })

  test('a 5xx is 503 and the retry that succeeds is used; the backoff is jittered', async () => {
    const waits = []
    const core = fakeCore((op, init, n) => (n === 1 ? json(502, { error: 'bad gateway' }) : json(200, ok(SCOPE))))
    assert.deepEqual(await client(core.fetchFn, { sleep: async (ms) => { waits.push(ms) }, random: () => 0.9, backoffMs: 100 }).resolveScope(SUBJECT, 'biz-a'), SCOPE)
    assert.equal(core.calls.length, 2)
    assert.deepEqual(waits, [140])
    const always = fakeCore(() => json(500, {}))
    await rejectsWith(client(always.fetchFn).branch(SUBJECT, { businessId: 'biz-a', branchId: 'br-1' }), { status: 503, code: 'SCM_CORE_UNAVAILABLE', reason: 'HTTP_500' })
    assert.equal(always.calls.length, 2)
  })

  test('a network error is 503 NETWORK', async () => {
    const core = fakeCore(() => { throw new TypeError('fetch failed') })
    await rejectsWith(client(core.fetchFn).customer(SUBJECT, { businessId: 'biz-a', customerId: 'cu-1' }), { status: 503, code: 'SCM_CORE_UNAVAILABLE', reason: 'NETWORK' })
  })

  test('a bad envelope, a wrong contractVersion, non-JSON, an unknown extra field or a broken bound is RESPONSE_INVALID', async () => {
    const bad = [
      { contractVersion: 'scm-core.v0', ok: true, data: SCOPE },
      { contractVersion: CORE_CONTRACT_VERSION, ok: false, data: SCOPE },
      { contractVersion: CORE_CONTRACT_VERSION, ok: true },
      ok({ ...SCOPE, viewerRole: 'OWNER' }),
      ok({ ...SCOPE, grants: { 'biz-a': { ...SCOPE.grants['biz-a'], admin: true } } }),
      ok({ ...SCOPE, actorId: '' }),
      ok({ ...SCOPE, grants: Object.fromEntries(Array.from({ length: MAX_GRANTS + 1 }, (_, i) => [`biz-${i}`, { owner: false, domains: [], permissions: [] }])) }),
      null,
    ]
    for (const body of bad) {
      const core = fakeCore(() => json(200, body))
      await rejectsWith(client(core.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 503, code: 'SCM_CORE_UNAVAILABLE', reason: 'RESPONSE_INVALID' })
    }
    const text = fakeCore(() => new Response('<html>', { status: 200 }))
    await rejectsWith(client(text.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 503, reason: 'RESPONSE_INVALID' })
    const extraFact = fakeCore(() => json(200, ok({ fact: { ...CUSTOMER, displayName: 'Someone' } })))
    await rejectsWith(client(extraFact.fetchFn).customer(SUBJECT, { businessId: 'biz-a', customerId: 'cu-1' }), { status: 503, reason: 'RESPONSE_INVALID' })
    const extraData = fakeCore(() => json(200, ok({ fact: BRANCH, hint: 'x' })))
    await rejectsWith(client(extraData.fetchFn).branch(SUBJECT, { businessId: 'biz-a', branchId: 'br-1' }), { status: 503, reason: 'RESPONSE_INVALID' })
    const tooMany = fakeCore(() => json(200, ok({ branches: Array.from({ length: 1001 }, (_, i) => ({ ...BRANCH_ROW, id: `br-${i}` })) })))
    await rejectsWith(client(tooMany.fetchFn).branches(SUBJECT, { businessId: 'biz-a' }), { status: 503, reason: 'RESPONSE_INVALID' })
  })

  test('an oversized answer is 503 RESPONSE_TOO_LARGE and is not fetched again', async () => {
    const streamed = fakeCore(() => new Response(JSON.stringify(ok({ fact: { ...BRANCH, name: 'x'.repeat(20 * 1024) } })), { status: 200 }))
    await rejectsWith(client(streamed.fetchFn).branch(SUBJECT, { businessId: 'biz-a', branchId: 'br-1' }), { status: 503, reason: 'RESPONSE_TOO_LARGE' })
    assert.equal(streamed.calls.length, 1)
    const declared = fakeCore(() => json(200, ok(SCOPE), { 'content-length': String(2 * 1024 * 1024) }))
    await rejectsWith(client(declared.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 503, reason: 'RESPONSE_TOO_LARGE' })
    assert.equal(declared.calls.length, 1)
  })
})

describe('scm-core.v1 client — core refusals are told apart and never retried', () => {
  test('401 SUBJECT_UNAUTHENTICATED → 401 SCM_SUBJECT_UNAUTHENTICATED', async () => {
    const core = fakeCore(() => json(401, { error: { code: 'SUBJECT_UNAUTHENTICATED' } }))
    const error = await client(core.fetchFn).resolveScope(SUBJECT, 'biz-a').catch((e) => e)
    assert.deepEqual([error.status, error.code, error.retryable], [401, 'SCM_SUBJECT_UNAUTHENTICATED', false])
    assert.ok(!JSON.stringify({ message: error.message, ...error }).includes(SUBJECT), 'the subject is never carried by an error')
    assert.equal(core.calls.length, 1)
  })

  test('401 SERVICE_TOKEN_INVALID, a code-less 401, 403 and other 4xx → 502 SCM_CORE_REJECTED', async () => {
    for (const response of [() => json(401, { error: { code: 'SERVICE_TOKEN_INVALID' } }), () => new Response('nope', { status: 401 }), () => json(403, { error: { code: 'SUBJECT_UNAUTHENTICATED' } }), () => json(400, {}), () => json(404, {}), () => json(404, { error: { code: 'OPERATION_NOT_FOUND' } }), () => json(409, { error: { code: 'SCOPE_TOO_LARGE' } }), () => json(409, { error: { code: 'SCOPE_NOT_SINGLE_TENANT' } })]) {
      const core = fakeCore(response)
      await rejectsWith(client(core.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 502, code: 'SCM_CORE_REJECTED', retryable: false })
      assert.equal(core.calls.length, 1, 'a refusal is not retried')
    }
  })

  test('a redirect from core is refused, never followed (real fetch, loopback)', async () => {
    let followed = 0
    const server = createServer((req, res) => {
      if (req.url.startsWith('/elsewhere')) { followed += 1; res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(ok(SCOPE))) }
      res.writeHead(307, { location: '/elsewhere' }); res.end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const c = createScmCoreClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: TOKEN, sleep: async () => {} })
      await rejectsWith(c.resolveScope(SUBJECT, 'biz-a'), { status: 503, code: 'SCM_CORE_UNAVAILABLE', reason: 'NETWORK' })
      assert.equal(followed, 0)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })
})

describe('core-resolved scope and core ReferenceAuthority', () => {
  test('the scope is the ladder shape; the subject rides along unenumerable and unserialized', async () => {
    const core = fakeCore((op) => json(200, ok(op === 'resolve-scope' ? SCOPE : { fact: CUSTOMER })))
    const c = client(core.fetchFn)
    const scope = await createCoreScopeResolver(c)(SUBJECT, 'biz-a')
    assert.ok(Object.isFrozen(scope))
    assert.deepEqual([scope.actorId, scope.tenantId], ['person-a', 'tenant-a'])
    assert.match(scope.delegationId, /^core-[0-9a-f-]{36}$/)
    assert.deepEqual([scope.visible('biz-a'), scope.sees('biz-a', 'commerce'), scope.has('biz-a', 'commerce.order.write'), scope.owns('biz-a'), scope.visible('biz-b')], [true, true, true, false, false])
    assert.deepEqual(commerceAuthority.require(scope, 'biz-a', 'order'), { id: 'biz-a', tenantId: 'tenant-a' })
    assert.throws(() => commerceAuthority.require(scope, 'biz-b'), (e) => e.status === 404)
    assert.ok(!JSON.stringify(scope).includes(SUBJECT) && !Object.getOwnPropertyNames(scope).some((k) => String(scope[k]).includes(SUBJECT)))
    const refs = createCoreReferenceAuthority(c)
    assert.equal(refs.kind, 'core')
    assert.deepEqual(await refs.customer(scope, { businessId: 'biz-a', customerId: 'cu-1' }), CUSTOMER)
    assert.equal(core.calls.at(-1).init.headers[SUBJECT_HEADER], SUBJECT, 'facts are asked with the same subject')
    await rejectsWith(refs.fileAsset(scope, { businessId: 'biz-a', fileAssetId: 'f' }), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE' })
    assert.equal(core.calls.filter((x) => x.op === 'fileAsset').length, 0, 'SCM-FILES is not asked of core')
  })

  test('a fact outage names its reference; a scope without a core subject is refused retryably', async () => {
    const core = fakeCore((op) => (op === 'resolve-scope' ? json(200, ok(SCOPE)) : json(503, {})))
    const c = client(core.fetchFn)
    const scope = await createCoreScopeResolver(c)(SUBJECT, 'biz-a')
    const error = await createCoreReferenceAuthority(c).branches(scope, { businessId: 'biz-a' }).catch((e) => e)
    assert.deepEqual([error.status, error.code, error.details], [503, 'SCM_CORE_UNAVAILABLE', { reference: 'branches' }])
    const foreignScope = Object.freeze({ tenantId: 'tenant-a' })
    await rejectsWith(createCoreReferenceAuthority(c).branch(foreignScope, { businessId: 'biz-a', branchId: 'br-1' }), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE' })
  })
})

describe('scm-core.v1 client — the Business selector', () => {
  test('a missing, blank, control-character or oversized selector is 400 before core is called; the subject is checked first', async () => {
    const core = fakeCore(() => json(200, ok(SCOPE)))
    for (const businessId of [undefined, null, 42, '', ' ', '\t\n', 'biz\u0000a', 'biz\na', 'biz\u007f', 'biz\u0085', 'x'.repeat(201)]) {
      await rejectsWith(client(core.fetchFn).resolveScope(SUBJECT, businessId), { status: 400, code: 'SCM_BUSINESS_SELECTOR_REQUIRED', retryable: false })
    }
    await rejectsWith(client(core.fetchFn).resolveScope(undefined, undefined), { status: 401, code: 'SCM_SUBJECT_REQUIRED' })
    assert.equal(core.calls.length, 0)
    const edge = fakeCore(() => json(200, ok({ ...SCOPE, grants: { ' b ': SCOPE.grants['biz-a'], ['y'.repeat(200)]: SCOPE.grants['biz-a'] } })))
    await client(edge.fetchFn).resolveScope(SUBJECT, ' b ')
    await client(edge.fetchFn).resolveScope(SUBJECT, 'y'.repeat(200))
    assert.deepEqual(edge.calls.map((x) => JSON.parse(x.init.body).businessId), [' b ', 'y'.repeat(200)], 'forwarded unchanged, never trimmed')
  })

  test('404 BUSINESS_NOT_FOUND and NO_VISIBLE_BUSINESS → 404 SCM_SCOPE_NOT_FOUND with the legacy body, not retried', async () => {
    const legacy = denied()
    for (const code of ['BUSINESS_NOT_FOUND', 'NO_VISIBLE_BUSINESS']) {
      const core = fakeCore(() => json(404, { error: { code } }))
      const error = await client(core.fetchFn).resolveScope(SUBJECT, 'biz-a').catch((e) => e)
      assert.deepEqual([error.status, error.code, error.message, error.retryable], [legacy.status, legacy.code, legacy.message, legacy.retryable])
      assert.deepEqual([error.status, error.code, error.message, error.retryable], [404, 'SCM_SCOPE_NOT_FOUND', 'Business not found', false])
      assert.equal(core.calls.length, 1)
    }
  })

  test('those codes mean nothing on a fact operation, and any other 404 stays 502', async () => {
    const fact = fakeCore(() => json(404, { error: { code: 'BUSINESS_NOT_FOUND' } }))
    await rejectsWith(client(fact.fetchFn).branch(SUBJECT, { businessId: 'biz-a', branchId: 'br-1' }), { status: 502, code: 'SCM_CORE_REJECTED' })
    for (const body of [{ error: { code: 'OPERATION_NOT_FOUND' } }, { error: {} }, 'not json']) {
      const core = fakeCore(() => (typeof body === 'string' ? new Response(body, { status: 404 }) : json(404, body)))
      await rejectsWith(client(core.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 502, code: 'SCM_CORE_REJECTED', reason: 'HTTP_404' })
    }
  })

  test('a scope that holds no grant for the selected Business is RESPONSE_INVALID', async () => {
    const core = fakeCore(() => json(200, ok(SCOPE)))
    await rejectsWith(client(core.fetchFn).resolveScope(SUBJECT, 'biz-b'), { status: 503, code: 'SCM_CORE_UNAVAILABLE', reason: 'RESPONSE_INVALID' })
    const empty = fakeCore(() => json(200, ok({ ...SCOPE, grants: {} })))
    await rejectsWith(client(empty.fetchFn).resolveScope(SUBJECT, 'biz-a'), { status: 503, reason: 'RESPONSE_INVALID' })
  })

  test('a viewer spanning two Tenants gets the selected Business\'s Tenant and only its Businesses', async () => {
    const G = SCOPE.grants['biz-a']
    const byTenant = { 'biz-a': 'tenant-a', 'biz-a2': 'tenant-a', 'biz-b': 'tenant-b' }
    const core = fakeCore((op, init) => {
      const tenantId = byTenant[JSON.parse(init.body).businessId]
      return json(200, ok({ actorId: 'person-a', tenantId, grants: Object.fromEntries(Object.keys(byTenant).filter((b) => byTenant[b] === tenantId).map((b) => [b, G])) }))
    })
    const resolve = createCoreScopeResolver(client(core.fetchFn))
    const a = await resolve(SUBJECT, 'biz-a')
    const b = await resolve(SUBJECT, 'biz-b')
    assert.deepEqual([a.tenantId, a.visible('biz-a'), a.visible('biz-a2'), a.visible('biz-b')], ['tenant-a', true, true, false])
    assert.deepEqual([b.tenantId, b.visible('biz-a'), b.visible('biz-a2'), b.visible('biz-b')], ['tenant-b', false, false, true])
    assert.throws(() => commerceAuthority.require(a, 'biz-b'), (e) => e.status === 404 && e.code === 'SCM_SCOPE_NOT_FOUND')
    assert.deepEqual(commerceAuthority.require(b, 'biz-b', 'order'), { id: 'biz-b', tenantId: 'tenant-b' })
  })
})

describe('core scope cache — successful resolutions only, bounded in time and size', () => {
  const clock = () => { const c = { t: 1_000_000, now: () => c.t }; return c }
  /** A resolver over a fake core whose resolve-scope answers come from `answer(body, n, init)`. */
  const cachedResolver = (answer, { ttl = 15000, max = 1000 } = {}) => {
    const c = clock()
    const core = fakeCore((op, init, n) => (op === 'resolve-scope' ? answer(JSON.parse(init.body), n, init) : json(200, ok({ fact: CUSTOMER }))))
    const coreClient = client(core.fetchFn, { retries: 0 })
    return { c, core, coreClient, resolve: createCoreScopeResolver(coreClient, { cacheTtlMs: ttl, cacheMaxEntries: max, now: c.now }) }
  }
  const scopeFor = (businessId, actorId = 'person-a') => json(200, ok({ actorId, tenantId: 'tenant-a', grants: { [businessId]: SCOPE.grants['biz-a'] } }))
  const resolves = (core) => core.calls.filter((x) => x.op === 'resolve-scope').length

  test('a hit asks core once for two requests, yet every request gets its own fresh frozen scope bound to the subject', async () => {
    const { core, coreClient, resolve } = cachedResolver((body) => scopeFor(body.businessId))
    const first = await resolve(SUBJECT, 'biz-a')
    const second = await resolve(SUBJECT, 'biz-a')
    assert.equal(resolves(core), 1)
    assert.notEqual(first, second)
    assert.ok(Object.isFrozen(first) && Object.isFrozen(second))
    assert.notEqual(first.delegationId, second.delegationId)
    assert.match(second.delegationId, /^core-[0-9a-f-]{36}$/)
    assert.deepEqual([second.actorId, second.tenantId, second.visible('biz-a'), second.has('biz-a', 'commerce.order.write')], ['person-a', 'tenant-a', true, true])
    const refs = createCoreReferenceAuthority(coreClient)
    await refs.customer(second, { businessId: 'biz-a', customerId: 'cu-1' })
    await refs.customer(second, { businessId: 'biz-a', customerId: 'cu-1' })
    const facts = core.calls.filter((x) => x.op === 'customer')
    assert.equal(facts.length, 2, 'facts are never cached')
    assert.ok(facts.every((x) => x.init.headers[SUBJECT_HEADER] === SUBJECT), 'a cache hit still carries its subject to fact calls')
    assert.ok(!JSON.stringify(second).includes(SUBJECT))
  })

  test('an entry expires at its TTL and core is asked again', async () => {
    const { c, core, resolve } = cachedResolver((body) => scopeFor(body.businessId), { ttl: 15000 })
    await resolve(SUBJECT, 'biz-a')
    c.t += 14999
    await resolve(SUBJECT, 'biz-a')
    assert.equal(resolves(core), 1)
    c.t += 1
    await resolve(SUBJECT, 'biz-a')
    assert.equal(resolves(core), 2)
    await resolve(SUBJECT, 'biz-a')
    assert.equal(resolves(core), 2, 'the fresh answer is cached again')
  })

  test('no negative caching: 404, 401, 409, 503 and an invalid answer each reach core again; then success is cached', async () => {
    const script = [
      () => json(404, { error: { code: 'BUSINESS_NOT_FOUND' } }),
      () => json(404, { error: { code: 'NO_VISIBLE_BUSINESS' } }),
      () => json(401, { error: { code: 'SUBJECT_UNAUTHENTICATED' } }),
      () => json(401, { error: { code: 'SUBJECT_UNAUTHENTICATED' } }),
      () => json(409, { error: { code: 'SCOPE_TOO_LARGE' } }),
      () => json(503, {}),
      () => json(200, ok({ ...SCOPE, grants: {} })),
      () => scopeFor('biz-a'),
    ]
    const { core, resolve } = cachedResolver((body, n) => script[n - 1]())
    const outcomes = []
    for (let i = 0; i < script.length + 2; i += 1) outcomes.push(await resolve(SUBJECT, 'biz-a').then((s) => `ok:${s.tenantId}`, (e) => `${e.status}:${e.code}`))
    assert.deepEqual(outcomes, [
      '404:SCM_SCOPE_NOT_FOUND', '404:SCM_SCOPE_NOT_FOUND', '401:SCM_SUBJECT_UNAUTHENTICATED', '401:SCM_SUBJECT_UNAUTHENTICATED',
      '502:SCM_CORE_REJECTED', '503:SCM_CORE_UNAVAILABLE', '503:SCM_CORE_UNAVAILABLE', 'ok:tenant-a', 'ok:tenant-a', 'ok:tenant-a',
    ])
    assert.equal(resolves(core), script.length, 'every failure reached core; only the success was served from cache')
  })

  test('a network outage is not cached either', async () => {
    let down = true
    const c = clock()
    const core = fakeCore((op, init) => { if (down) throw new TypeError('fetch failed'); return scopeFor(JSON.parse(init.body).businessId) })
    const resolve = createCoreScopeResolver(client(core.fetchFn, { retries: 0 }), { cacheTtlMs: 15000, now: c.now })
    await rejectsWith(resolve(SUBJECT, 'biz-a'), { status: 503, reason: 'NETWORK' })
    await rejectsWith(resolve(SUBJECT, 'biz-a'), { status: 503, reason: 'NETWORK' })
    down = false
    assert.equal((await resolve(SUBJECT, 'biz-a')).tenantId, 'tenant-a')
    await resolve(SUBJECT, 'biz-a')
    assert.equal(core.calls.length, 3)
  })

  test('entries are isolated per subject and per selected Business', async () => {
    const OTHER = 'session-synthetic-subject-zzz999'
    const { core, resolve } = cachedResolver((body, n, init) => scopeFor(body.businessId, init.headers[SUBJECT_HEADER] === SUBJECT ? 'person-a' : 'person-z'))
    const a = await resolve(SUBJECT, 'biz-a')
    const z = await resolve(OTHER, 'biz-a')
    const b = await resolve(SUBJECT, 'biz-b')
    assert.equal(resolves(core), 3)
    assert.deepEqual([a.actorId, z.actorId, b.actorId], ['person-a', 'person-z', 'person-a'])
    assert.deepEqual([a.visible('biz-b'), b.visible('biz-a'), b.visible('biz-b')], [false, false, true])
    assert.equal((await resolve(OTHER, 'biz-a')).actorId, 'person-z')
    assert.equal((await resolve(SUBJECT, 'biz-a')).actorId, 'person-a')
    assert.equal(resolves(core), 3)
  })

  test('the size bound evicts the least recently used entry', async () => {
    const { core, resolve } = cachedResolver((body) => scopeFor(body.businessId), { max: 2 })
    await resolve(SUBJECT, 'biz-1')
    await resolve(SUBJECT, 'biz-2')
    await resolve(SUBJECT, 'biz-1') // hit: biz-1 is now the most recent
    await resolve(SUBJECT, 'biz-3') // evicts biz-2
    assert.equal(resolves(core), 3)
    await resolve(SUBJECT, 'biz-1')
    await resolve(SUBJECT, 'biz-3')
    assert.equal(resolves(core), 3, 'biz-1 and biz-3 are still cached')
    await resolve(SUBJECT, 'biz-2')
    assert.equal(resolves(core), 4, 'biz-2 was evicted')
  })

  test('TTL 0 disables the cache entirely', async () => {
    const { core, resolve } = cachedResolver((body) => scopeFor(body.businessId), { ttl: 0 })
    for (let i = 0; i < 3; i += 1) await resolve(SUBJECT, 'biz-a')
    assert.equal(resolves(core), 3)
    const plain = createCoreScopeResolver({ resolveScope: async () => ({ actorId: 'p', tenantId: 't', grants: {} }) })
    assert.equal((await plain(SUBJECT, 'biz-a')).tenantId, 't', 'the default resolver is uncached and needs no credential id')
  })

  test('the key is a digest framed per field, bound to the core credential; the stored value holds no subject', () => {
    const key = scopeCacheKey({ subject: SUBJECT, businessId: 'biz-a', credentialId: 'cred-1' })
    assert.match(key, /^[0-9a-f]{64}$/)
    assert.notEqual(key, scopeCacheKey({ subject: SUBJECT, businessId: 'biz-a', credentialId: 'cred-2' }))
    assert.notEqual(scopeCacheKey({ subject: 'ab', businessId: 'c', credentialId: 'x' }), scopeCacheKey({ subject: 'a', businessId: 'bc', credentialId: 'x' }))
    const cache = createScopeCache({ ttlMs: 1000, maxEntries: 10, now: () => 0 })
    const grants = { 'biz-a': { owner: false, domains: ['commerce'], permissions: [] } }
    cache.set(key, { actorId: 'p', tenantId: 't', grants, subject: SUBJECT })
    grants['biz-a'].domains.push('inventory')
    const value = cache.get(key)
    assert.deepEqual(Object.keys(value).sort(), ['actorId', 'grants', 'tenantId'])
    assert.ok(!JSON.stringify(value).includes(SUBJECT))
    assert.deepEqual(value.grants['biz-a'].domains, ['commerce'], 'a copy, not the caller\'s object')
    assert.ok(Object.isFrozen(value.grants['biz-a'].domains))
    const a = createScmCoreClient({ baseUrl: BASE, token: TOKEN })
    const b = createScmCoreClient({ baseUrl: BASE, token: `${TOKEN}-other` })
    assert.match(a.credentialId, /^[0-9a-f]{64}$/)
    assert.notEqual(a.credentialId, b.credentialId)
    assert.throws(() => createCoreScopeResolver({ resolveScope: async () => ({}) }, { cacheTtlMs: 1000 }), (e) => e.code === 'SCM_CONFIG_INVALID')
    for (const bad of [{ ttlMs: -1, maxEntries: 1 }, { ttlMs: 1, maxEntries: 0 }, { ttlMs: 1.5, maxEntries: 1 }]) assert.throws(() => createScopeCache(bad), (e) => e.code === 'SCM_CONFIG_INVALID')
  })
})
