import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loadConfig } from '../src/config.js'

const base = {
  MARKET_API_TOKEN: 'a'.repeat(40),
  MARKET_CORE_TOKEN: 'c'.repeat(40),
  MARKET_CORE_URL: 'http://web:3000',
  MARKET_STORE: 'sqlite',
  MARKET_SQLITE_PATH: '/tmp/market.db',
}

test('development config loads with defaults', () => {
  const config = loadConfig(base)
  assert.equal(config.port, 3082)
  assert.equal(config.production, false)
  assert.equal(config.assumeExecutionOwner, false)
})

test('short or shared tokens are refused', () => {
  assert.throws(() => loadConfig({ ...base, MARKET_API_TOKEN: 'short' }))
  assert.throws(() => loadConfig({ ...base, MARKET_CORE_TOKEN: base.MARKET_API_TOKEN }), /must differ/)
})

test('each store needs its own location', () => {
  assert.throws(() => loadConfig({ ...base, MARKET_SQLITE_PATH: undefined }), /MARKET_SQLITE_PATH/)
  assert.throws(() => loadConfig({ ...base, MARKET_STORE: 'postgres' }), /MARKET_DATABASE_URL/)
})

test('production refuses every development convenience', () => {
  const prod = { ...base, MARKET_ENV: 'production', MARKET_STORE: 'postgres', MARKET_DATABASE_URL: 'postgres://x' }
  assert.doesNotThrow(() => loadConfig(prod))
  assert.throws(() => loadConfig({ ...prod, MARKET_STORE: 'sqlite' }), /MARKET_STORE=postgres/)
  assert.throws(() => loadConfig({ ...prod, MARKET_STORE_ENSURE_SCHEMA: '1' }), /must not create schema/)
  assert.throws(() => loadConfig({ ...prod, MARKET_TEST_ASSUME_EXECUTION_OWNER: '1' }), /execution ownership/)
  assert.throws(() => loadConfig({ ...prod, MARKET_CORE_URL: 'http://203.0.113.5:3000' }), /https or a private service name/)
  assert.doesNotThrow(() => loadConfig({ ...prod, MARKET_CORE_URL: 'https://core.example' }))
})
