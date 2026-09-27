// SCM_AUTH_MODE configuration: production is core-only; core mode needs both
// tokens (>= 32 chars, different) and a clean core URL; delegation mode needs the
// delegation key; production core URLs are https or a single-label service name;
// the resolve-scope cache TTL is capped. Every refusal names fields, never a value.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../../src/config.js'

const API = 'scm-api-token-synthetic-AAAAAAAAAAAAAAAAAAAA'
const CORE = 'scm-core-token-synthetic-BBBBBBBBBBBBBBBBBBB'
const KEY = 'scm-delegation-key-synthetic-CCCCCCCCCCCCCCCC'
const base = { SCM_SQLITE_PATH: 'synthetic.sqlite' }
const core = { ...base, SCM_AUTH_MODE: 'core', SCM_API_TOKEN: API, SCM_CORE_URL: 'http://core.internal:3000', SCM_CORE_TOKEN: CORE }
const refused = (env, field) => assert.throws(() => loadConfig(env), (e) => {
  assert.equal(e.code, 'SCM_CONFIG_INVALID')
  assert.match(e.message, new RegExp(field))
  for (const secret of [API, CORE, KEY, 'short-secret-value', 'user:pw']) assert.ok(!e.message.includes(secret), `message leaks a value: ${e.message}`)
  return true
})

test('delegation is the default outside production and needs its key', () => {
  const c = loadConfig({ ...base, SCM_DELEGATION_KEY: KEY })
  assert.deepEqual([c.authMode, c.delegationKey, c.apiToken, c.coreToken, c.coreUrl], ['delegation', KEY, null, null, null])
  refused({ ...base }, 'SCM_DELEGATION_KEY')
  refused({ ...base, SCM_DELEGATION_KEY: 'short-secret-value' }, 'SCM_DELEGATION_KEY')
})

test('production refuses delegation mode and defaults to core', () => {
  refused({ ...base, SCM_ENV: 'production', SCM_AUTH_MODE: 'delegation', SCM_DELEGATION_KEY: KEY }, 'SCM_AUTH_MODE')
  // Unset in production means core — which then needs its own settings.
  refused({ ...base, SCM_ENV: 'production', SCM_DELEGATION_KEY: KEY }, 'SCM_API_TOKEN, SCM_CORE_URL, SCM_CORE_TOKEN')
  const c = loadConfig({ ...core, SCM_AUTH_MODE: undefined, SCM_ENV: 'production', SCM_CORE_URL: 'http://web:3000' })
  assert.deepEqual([c.authMode, c.apiToken, c.coreToken, c.coreUrl, c.coreTimeoutMs, c.delegationKey], ['core', API, CORE, 'http://web:3000', 3000, null])
})

test('core mode: tokens present, >= 32 chars and different; URL http(s) without credentials, query or hash', () => {
  assert.equal(loadConfig({ ...core, SCM_CORE_TIMEOUT_MS: '1500' }).coreTimeoutMs, 1500)
  assert.equal(loadConfig(core).delegationKey, null, 'no delegation key is required or kept in core mode')
  for (const field of ['SCM_API_TOKEN', 'SCM_CORE_URL', 'SCM_CORE_TOKEN']) refused({ ...core, [field]: undefined }, field)
  refused({ ...core, SCM_API_TOKEN: 'short-secret-value' }, 'SCM_API_TOKEN')
  refused({ ...core, SCM_CORE_TOKEN: 'short-secret-value' }, 'SCM_CORE_TOKEN')
  refused({ ...core, SCM_CORE_TOKEN: API }, 'SCM_API_TOKEN and SCM_CORE_TOKEN must differ')
  for (const url of ['http://user:pw@core.internal', 'http://core.internal/?user:pw', 'http://core.internal/#user:pw', 'ftp://core.internal', 'user:pw']) refused({ ...core, SCM_CORE_URL: url }, 'SCM_CORE_URL')
  refused({ ...core, SCM_CORE_TIMEOUT_MS: '0' }, 'SCM_CORE_TIMEOUT_MS')
  refused({ ...core, SCM_AUTH_MODE: 'bearer' }, 'SCM_AUTH_MODE')
})

test('production core URL: https, or plain http only to a single-label service name (the Market rule)', () => {
  const prod = { ...core, SCM_ENV: 'production' }
  for (const url of ['https://core.example.test', 'https://core.example.test:8443/prefix', 'http://web:3000', 'http://web', 'http://web:3000/', 'http://zuri-web-1:3000']) {
    assert.equal(loadConfig({ ...prod, SCM_CORE_URL: url }).coreUrl, url, url)
  }
  for (const url of ['http://core.internal:3000', 'http://10.0.0.5:3000', 'http://localhost.localdomain', 'http://web:3000/prefix', 'http://web_1:3000']) {
    refused({ ...prod, SCM_CORE_URL: url }, 'SCM_CORE_URL must be https or a private service name in production')
    assert.throws(() => loadConfig({ ...prod, SCM_CORE_URL: url }), (e) => !e.message.includes(url))
  }
  // Outside production plain http to any host stays allowed (local rehearsal).
  assert.equal(loadConfig({ ...core, SCM_CORE_URL: 'http://core.internal:3000' }).coreUrl, 'http://core.internal:3000')
})

test('resolve-scope cache: TTL defaults to 15000, 0 disables, 60000 is the hard max; entries bounded', () => {
  const c = loadConfig(core)
  assert.deepEqual([c.coreScopeCacheTtlMs, c.coreScopeCacheMaxEntries], [15000, 1000])
  for (const ttl of ['0', '1', '60000']) assert.equal(loadConfig({ ...core, SCM_CORE_SCOPE_CACHE_TTL_MS: ttl }).coreScopeCacheTtlMs, Number(ttl))
  for (const ttl of ['60001', '-1', '1.5', 'soon']) refused({ ...core, SCM_CORE_SCOPE_CACHE_TTL_MS: ttl }, 'SCM_CORE_SCOPE_CACHE_TTL_MS')
  assert.equal(loadConfig({ ...core, SCM_CORE_SCOPE_CACHE_MAX_ENTRIES: '5' }).coreScopeCacheMaxEntries, 5)
  for (const max of ['0', '100001', 'many']) refused({ ...core, SCM_CORE_SCOPE_CACHE_MAX_ENTRIES: max }, 'SCM_CORE_SCOPE_CACHE_MAX_ENTRIES')
})
