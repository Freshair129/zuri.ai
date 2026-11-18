import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

// @req FR-046, FR-296 — independent fixtures retain real, rate-limited sign-in.
// @spec ADR-017, SEC-008, SEC-026
// @tested tests/unit/e2e-owner-login-isolation.test.js
const require = createRequire(import.meta.url)
const authPath = new URL('../e2e/e2e-auth.js', import.meta.url)
const target = { baseURL: 'http://localhost:3100' }

function loadAuth(prepareOwnerLogin) {
  const module = { exports: {} }
  vm.runInNewContext(readFileSync(authPath, 'utf8'), {
    module, exports: module.exports, process, URL,
    __dirname: new URL('../e2e/', import.meta.url).pathname,
    require: (name) => {
      if (name === './owner-login-isolation.cjs') return { prepareOwnerLogin }
      if (name === './e2e-target') return { e2eTarget: () => target }
      return require(name)
    },
  }, { filename: authPath.pathname })
  return module.exports
}

function loginTransport(limit = 2) {
  let count = 0
  return {
    reset: () => { count = 0 },
    context: () => ({ post: async () => {
      const status = ++count <= limit ? 200 : 429
      return { status: () => status, ok: () => status === 200 }
    } }),
  }
}

function oncePerContext(reset) {
  const contexts = new WeakSet()
  return async (context) => {
    if (!contexts.has(context)) { reset(); contexts.add(context) }
  }
}

test('owner fixture prepares a fresh context before its real login request', async () => {
  const transport = loginTransport()
  const { loginRequest } = loadAuth(oncePerContext(transport.reset))
  for (let i = 0; i < 6; i++) {
    const response = await loginRequest(transport.context())
    assert.equal(response.status(), 200, 'a new context inherited an exhausted login bucket')
  }
})

test('repeated sign-ins in one context still reach the limiter', async () => {
  const transport = loginTransport()
  const context = transport.context()
  const { loginRequest } = loadAuth(oncePerContext(transport.reset))
  assert.equal((await loginRequest(context)).status(), 200)
  assert.equal((await loginRequest(context)).status(), 200)
  assert.equal((await loginRequest(context)).status(), 429)
})

test('API fixture uses only its derived local target and preserves caller options', async () => {
  let received
  const context = { post: async (url, options) => { received = { url, options }; return 'response' } }
  const { loginRequest, E2E_USERNAME, E2E_PASSWORD } = loadAuth(async () => {})
  assert.equal(await loginRequest(context, { timeout: 1234, headers: { 'x-test': 'fixture' } }), 'response')
  assert.equal(received.url, `${target.baseURL}/api/auth/login`)
  assert.equal(received.options.timeout, 1234)
  assert.equal(received.options.headers['x-test'], 'fixture')
  assert.equal(received.options.data.username, E2E_USERNAME)
  assert.equal(received.options.data.password, E2E_PASSWORD)
})

function fakePage(status, origin = target.baseURL) {
  let navigations = 0
  const response = { status: () => status, ok: () => status === 200,
    url: () => `${target.baseURL}/api/auth/login`, request: () => ({ method: () => 'POST' }) }
  return {
    request: {},
    goto: async () => {},
    url: () => `${origin}/login`,
    getByLabel: () => ({ fill: async () => {}, check: async () => {} }),
    getByRole: () => ({ click: async () => {} }),
    waitForResponse: async (predicate) => { assert.equal(predicate(response), true); return response },
    waitForURL: async () => { navigations++ },
    navigations: () => navigations,
  }
}

test('UI fixture reports an HTTP refusal without waiting for a redirect or exposing its body', async () => {
  const page = fakePage(429)
  const { loginAsOwner } = loadAuth(async () => {})
  await assert.rejects(loginAsOwner(page), { message: 'Owner login fixture failed: HTTP 429' })
  assert.equal(page.navigations(), 0)
})

test('UI fixture refuses a non-fixture origin before touching database or credentials', async () => {
  let prepared = 0
  const page = fakePage(200, 'https://production.invalid')
  const { loginAsOwner } = loadAuth(async () => { prepared++ })
  await assert.rejects(loginAsOwner(page), /E2E_LOGIN_TARGET_MISMATCH/)
  assert.equal(prepared, 0)
  assert.equal(page.navigations(), 0)
})

test('UI fixture still signs in and waits for businesses after a successful response', async () => {
  const page = fakePage(200)
  let prepared
  const { loginAsOwner } = loadAuth(async (context) => { prepared = context })
  await loginAsOwner(page, { remember: true })
  assert.equal(prepared, page.request)
  assert.equal(page.navigations(), 1)
})

const { createHash } = require('node:crypto')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { ownerLoginBucketFilter, fixtureDatabaseUrl, createOwnerLoginIsolation } = require('../e2e/owner-login-isolation.cjs')
const digest = (value) => createHash('sha256').update(value).digest('hex')

test('preparation is once per normalized owner and context, including concurrent calls', async () => {
  const calls = []
  const prepare = createOwnerLoginIsolation(async (username) => { calls.push(username) })
  const context = {}
  await Promise.all([prepare(context, '  Owner@Local '), prepare(context, 'owner@local')])
  await prepare(context, 'owner@local')
  assert.deepEqual(calls, ['owner@local'])
  await prepare({}, 'owner@local')
  assert.deepEqual(calls, ['owner@local', 'owner@local'])
})

test('failed preparation is propagated and never retried in the same context', async () => {
  let calls = 0
  const prepare = createOwnerLoginIsolation(async () => { calls++; throw new Error('fixture database unavailable') })
  const context = {}
  await assert.rejects(prepare(context, 'owner@local'), /fixture database unavailable/)
  await assert.rejects(prepare(context, 'owner@local'), /fixture database unavailable/)
  assert.equal(calls, 1)
})

test('invalid context or username cannot invoke the reset callback', async () => {
  let calls = 0
  const prepare = createOwnerLoginIsolation(async () => { calls++ })
  await assert.rejects(prepare(null, 'owner@local'), /CONTEXT_REQUIRED/)
  await assert.rejects(prepare({}, ' '), /USERNAME_REQUIRED/)
  assert.equal(calls, 0)
})

test('bucket filter selects exactly one owner and loopback password-login keys', () => {
  assert.deepEqual(ownerLoginBucketFilter('  Owner@Local '), { OR: [
    { key: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER:${digest('owner@local')}` },
    { key: { startsWith: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER_ADDRESS:${digest('owner@local')}:` } },
    { key: { in: ['127.0.0.1', '::1', '::ffff:127.0.0.1'].map((ip) => `AUTH_RATE_LIMIT:LOGIN:ADDRESS:${digest(ip)}`) } },
  ] })
})

function diskFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'e2e-login-isolation-'))
  mkdirSync(path.join(root, 'prisma'))
  const target = { port: 3100, baseURL: 'http://localhost:3100', databaseFile: 'e2e-3100.db',
    databaseUrl: 'file:./e2e-3100.db', databasePath: path.join(root, 'prisma', 'e2e-3100.db') }
  return { root, target, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('database guard accepts only the already-prepared, port-paired SQLite file', () => {
  const f = diskFixture()
  try {
    assert.throws(() => fixtureDatabaseUrl(f.target, f.root), /NOT_PREPARED/)
    writeFileSync(f.target.databasePath, '')
    assert.equal(fixtureDatabaseUrl(f.target, f.root), `file:${f.target.databasePath.replace(/\\/g, '/')}`)
    for (const changed of [
      { baseURL: 'https://production.invalid' }, { databaseUrl: 'postgresql://example.invalid/prod' },
      { databasePath: path.join(f.root, 'production.db') }, { databaseFile: 'prod.db' }, { port: 0 }, { port: 65536 },
    ]) assert.throws(() => fixtureDatabaseUrl({ ...f.target, ...changed }, f.root), /TARGET_MISMATCH/)
  } finally { f.cleanup() }
})

test('database guard rejects a symlink file without opening its target', () => {
  const f = diskFixture()
  try {
    const outside = path.join(f.root, 'unrelated.db')
    writeFileSync(outside, 'unrelated fixture')
    symlinkSync(outside, f.target.databasePath)
    assert.throws(() => fixtureDatabaseUrl(f.target, f.root), /TARGET_MISMATCH/)
    assert.equal(readFileSync(outside, 'utf8'), 'unrelated fixture')
  } finally { f.cleanup() }
})

test('database guard rejects an outward directory alias', () => {
  const f = diskFixture()
  const other = diskFixture()
  try {
    writeFileSync(other.target.databasePath, 'unrelated fixture')
    rmSync(path.join(f.root, 'prisma'), { recursive: true })
    symlinkSync(path.join(other.root, 'prisma'), path.join(f.root, 'prisma'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => fixtureDatabaseUrl(f.target, f.root), /TARGET_MISMATCH/)
  } finally { f.cleanup(); other.cleanup() }
})

test('real preparation lifecycle separates fresh contexts but not attempts within a context', async () => {
  const transport = loginTransport()
  const { loginRequest } = loadAuth(createOwnerLoginIsolation(transport.reset))
  for (let i = 0; i < 60; i++) assert.equal((await loginRequest(transport.context())).status(), 200)
  const context = transport.context()
  assert.equal((await loginRequest(context)).status(), 200)
  assert.equal((await loginRequest(context)).status(), 200)
  assert.equal((await loginRequest(context)).status(), 429)
})
