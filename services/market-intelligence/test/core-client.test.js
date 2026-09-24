import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CoreUnavailable, createCoreClient } from '../src/adapters/core-client.js'

const TOKEN = 't'.repeat(40)
const envelope = (data) => ({ contractVersion: 'market-core.v1', ok: true, data })
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function client(fetchFn, extra = {}) {
  return createCoreClient({ baseUrl: 'http://core.test', token: TOKEN, fetchFn, sleep: async () => {}, ...extra })
}

test('configuration is validated up front', () => {
  assert.throws(() => createCoreClient({ baseUrl: 'http://core.test', token: 'short' }), /at least 32/)
  assert.throws(() => createCoreClient({ baseUrl: 'ftp://core.test', token: TOKEN }), /invalid/)
  assert.throws(() => createCoreClient({ baseUrl: 'http://u:p@core.test', token: TOKEN }), /invalid/)
})

test('authorize needs a subject and never sends one it was not given', async () => {
  const calls = []
  const core = client(async (url, init) => { calls.push({ url: String(url), init }); return jsonResponse(200, envelope({ allowed: false, status: 403, message: 'Business access denied' })) })
  await assert.rejects(core.scopeAuthority.authorize({ actor: {}, businessId: 'b', action: 'market.feed.read' }), { status: 401 })
  assert.equal(calls.length, 0)
  await core.scopeAuthority.authorize({ actor: { subject: 'opaque-cookie' }, businessId: 'b', action: 'market.feed.read' })
  assert.equal(calls[0].url, 'http://core.test/api/internal/market-intelligence/v1/authorize')
  assert.equal(calls[0].init.headers['x-zuri-subject'], 'opaque-cookie')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`)
  assert.equal(calls[0].init.redirect, 'error')
})

test('reads retry a bounded number of times, then fail closed', async () => {
  let attempts = 0
  const core = client(async () => { attempts += 1; throw new TypeError('fetch failed') }, { retries: 2 })
  await assert.rejects(core.health(), CoreUnavailable)
  assert.equal(attempts, 3)
})

test('a transient failure recovers on retry', async () => {
  let attempts = 0
  const core = client(async () => (++attempts === 1 ? jsonResponse(503, {}) : jsonResponse(200, envelope({ ok: true, mode: 'remote' }))))
  assert.deepEqual(await core.health(), { ok: true, mode: 'remote' })
})

test('the audit append is not retried', async () => {
  let attempts = 0
  const core = client(async () => { attempts += 1; return jsonResponse(500, {}) })
  await assert.rejects(core.audit.record({ action: 'X' }), CoreUnavailable)
  assert.equal(attempts, 1)
})

test('a malformed envelope is an outage, never data', async () => {
  const core = client(async () => jsonResponse(200, { ok: true, data: { allowed: true } }))
  await assert.rejects(core.scopeAuthority.authorize({ actor: { subject: 's' }, businessId: 'b', action: 'a' }), CoreUnavailable)
})

test('core rejecting the service itself is a 502 fault, not a user refusal', async () => {
  const core = client(async () => jsonResponse(401, { error: 'bad token' }))
  await assert.rejects(core.health(), { status: 502, code: 'CORE_REJECTED' })
})

test('raw candidates come back with dates revived and must be an array', async () => {
  const good = client(async () => jsonResponse(200, envelope({ records: [{ id: 'r', receivedAt: '2026-09-01T00:00:00.000Z' }] })))
  const [record] = await good.rawEvidence.listMarketCandidates({ tenantId: 't', businessId: 'b', scanLimit: 5, subject: 's' })
  assert.ok(record.receivedAt instanceof Date)
  const bad = client(async () => jsonResponse(200, envelope({ records: 'nope' })))
  await assert.rejects(bad.rawEvidence.listMarketCandidates({ tenantId: 't', businessId: 'b', scanLimit: 5, subject: 's' }), CoreUnavailable)
})

test('execution ownership is true only when core says exactly true', async () => {
  assert.deepEqual(await client(async () => jsonResponse(200, envelope({ ownsTranslation: 'yes' }))).executionOwnership(), { ownsTranslation: false })
  assert.deepEqual(await client(async () => jsonResponse(200, envelope({ ownsTranslation: true }))).executionOwnership(), { ownsTranslation: true })
})
