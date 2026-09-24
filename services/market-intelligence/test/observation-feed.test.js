import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MARKET_OBSERVATION_FEED_LIMIT,
  getMarketObservationFeed,
  parseMarketObservationFeedQuery,
  translateRawRecordToMarketObservation,
  extractGenericMarketCandidate,
} from '../src/index.js'
import {
  BUSINESS_A,
  BUSINESS_B,
  BUSINESS_U,
  TENANT_T,
  createObservationTable,
  createScopeAuthority,
  rawRecord,
} from './fakes.js'

async function seed(table, raw) {
  const draft = await translateRawRecordToMarketObservation(raw, { extractCandidate: extractGenericMarketCandidate })
  const store = await table.open({ tenantId: draft.tenantId, businessId: draft.businessId })
  return store.insertIfAbsent(draft)
}

async function fixture() {
  const table = createObservationTable()
  await seed(table, rawRecord({ id: 'a-1', businessId: BUSINESS_A, receivedAt: new Date('2026-09-01Z') }))
  await seed(table, rawRecord({ id: 'a-2', businessId: BUSINESS_A, receivedAt: new Date('2026-09-02Z') }))
  await seed(table, rawRecord({ id: 'b-1', businessId: BUSINESS_B }))
  await seed(table, rawRecord({ id: 'null-1', businessId: null }))
  await seed(table, rawRecord({ id: 'u-1', tenantId: 'tenant-u', businessId: BUSINESS_U }))
  return { table, deps: { scopeAuthority: createScopeAuthority(), openObservationStore: table.open } }
}

const actorA = { sees: [BUSINESS_A], owns: [] }

test('Business A reads only A rows: no B, no tenant-shared null rows, no other tenant', async () => {
  const { deps } = await fixture()
  const feed = await getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_A, limit: 50 }, deps)
  assert.deepEqual(feed.observations.map((row) => row.externalId), ['ext-a-2', 'ext-a-1'])
  assert.deepEqual(feed.scope, { businessId: BUSINESS_A, businessName: 'A', tenantId: TENANT_T })
  assert.equal(feed.counts.observations, 2)
  assert.deepEqual(feed.counts.byResolutionStatus, { UNRESOLVED: 2 })
  assert.equal(feed.truncated, false)
})

test('a Business the actor cannot see is 403; hidden Market domain is 404', async () => {
  const { deps } = await fixture()
  await assert.rejects(getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_B }, deps), { status: 403, message: 'Business access denied' })
  await assert.rejects(
    getMarketObservationFeed({ actor: { sees: [BUSINESS_A], marketHidden: [BUSINESS_A] }, businessId: BUSINESS_A }, deps),
    { status: 404, message: 'Business not found' },
  )
})

test('refusal happens before any store is opened', async () => {
  let opened = false
  const deps = { scopeAuthority: createScopeAuthority(), openObservationStore: async () => { opened = true } }
  await assert.rejects(getMarketObservationFeed({ actor: {}, businessId: BUSINESS_A }, deps), { status: 403 })
  assert.equal(opened, false)
})

test('the store is opened with the authority scope, not anything the caller named', async () => {
  const opened = []
  const deps = {
    scopeAuthority: createScopeAuthority(),
    openObservationStore: async (scope) => { opened.push(scope); return { listRecent: async () => [] } },
  }
  await getMarketObservationFeed({ actor: { ...actorA, tenantId: 'tenant-evil' }, businessId: BUSINESS_A, tenantId: 'tenant-evil' }, deps)
  assert.deepEqual(opened, [{ tenantId: TENANT_T, businessId: BUSINESS_A }])
})

test('a store that leaks another Business row fails closed', async () => {
  const deps = {
    scopeAuthority: createScopeAuthority(),
    openObservationStore: async () => ({ listRecent: async () => [{ tenantId: TENANT_T, businessId: BUSINESS_B, candidateJson: '{}' }] }),
  }
  await assert.rejects(getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_A }, deps), /outside the authorized Business/)
})

test('a malformed authority answer is a fault, never an allow', async () => {
  const deps = { scopeAuthority: { authorize: async () => ({ allowed: 'yes' }) }, openObservationStore: async () => ({}) }
  await assert.rejects(getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_A }, deps), /invalid decision/)
  const mismatch = {
    scopeAuthority: { authorize: async () => ({ allowed: true, scope: { tenantId: TENANT_T, businessId: BUSINESS_B } }) },
    openObservationStore: async () => ({}),
  }
  await assert.rejects(getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_A }, mismatch), /does not match/)
})

test('truncated is reported when the page is full', async () => {
  const { deps } = await fixture()
  const feed = await getMarketObservationFeed({ actor: actorA, businessId: BUSINESS_A, limit: 1 }, deps)
  assert.equal(feed.observations.length, 1)
  assert.equal(feed.truncated, true)
})

test('query parsing keeps the legacy default, cap and strictness', () => {
  assert.deepEqual(parseMarketObservationFeedQuery({ businessId: ' b ' }), { businessId: 'b', limit: MARKET_OBSERVATION_FEED_LIMIT })
  assert.equal(parseMarketObservationFeedQuery({ businessId: 'b', limit: '999' }).limit, 200)
  assert.throws(() => parseMarketObservationFeedQuery({ businessId: 'b', tenantId: 't' }))
  assert.throws(() => parseMarketObservationFeedQuery({ businessId: '   ' }))
  assert.throws(() => parseMarketObservationFeedQuery({ businessId: 'b', limit: '0' }))
})
