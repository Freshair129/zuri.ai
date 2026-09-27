// SCM_AUTH_MODE configuration: production is core-only; core mode needs both
// tokens (>= 32 chars, different) and a clean core URL; delegation mode needs the
// delegation key. Every refusal names fields, never a value.
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
  const c = loadConfig({ ...core, SCM_AUTH_MODE: undefined, SCM_ENV: 'production' })
  assert.deepEqual([c.authMode, c.apiToken, c.coreToken, c.coreUrl, c.coreTimeoutMs, c.delegationKey], ['core', API, CORE, 'http://core.internal:3000', 3000, null])
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
