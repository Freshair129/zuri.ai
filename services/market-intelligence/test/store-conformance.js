import { test } from 'node:test'
import assert from 'node:assert/strict'

import { extractGenericMarketCandidate, translateRawRecordToMarketObservation } from '../src/index.js'
import { LineageScopeCollision } from '../src/adapters/observation-schema.js'
import { BUSINESS_A, BUSINESS_B, TENANT_T, rawRecord } from './fakes.js'

// The ObservationStore contract (ADR-108 D2). Every adapter runs this whole suite; an
// adapter that passes only its own tests does not count. `race(draft, n)` must insert
// the same draft from n SEPARATE connections running concurrently and resolve to the
// n statuses — that is the only proof of lineage atomicity on a real engine.

export async function draftFor(overrides = {}) {
  return translateRawRecordToMarketObservation(rawRecord(overrides), {
    extractCandidate: extractGenericMarketCandidate,
    now: () => new Date('2026-09-24T01:02:03.456Z'),
  })
}

const scopeA = { tenantId: TENANT_T, businessId: BUSINESS_A }

/**
 * @param {string} name
 * @param {() => Promise<{ factory, race?: Function, reopen?: Function, cleanup: Function }>} setup
 */
export function runObservationStoreConformance(name, setup) {
  let env

  const fresh = async () => {
    if (env) await env.cleanup()
    env = await setup()
    return env
  }

  test(`${name}: insert is CREATED once, then UNCHANGED with the same row`, async () => {
    const { factory } = await fresh()
    const store = await factory.open(scopeA)
    const draft = await draftFor({ id: 'r-1' })
    const first = await store.insertIfAbsent(draft)
    const second = await store.insertIfAbsent(draft)
    assert.equal(first.status, 'CREATED')
    assert.equal(second.status, 'UNCHANGED')
    assert.equal(second.observation.id, first.observation.id)
    assert.equal(first.observation.lineageKey, draft.lineageKey)
  })

  test(`${name}: timestamps round-trip as exact UTC instants`, async () => {
    const { factory } = await fresh()
    const store = await factory.open(scopeA)
    const draft = await draftFor({ id: 'r-time', receivedAt: new Date('2026-01-02T03:04:05.678Z') })
    const { observation } = await store.insertIfAbsent(draft)
    assert.equal(new Date(observation.observedAt).toISOString(), '2026-01-02T03:04:05.678Z')
    assert.equal(new Date(observation.translatedAt).toISOString(), '2026-09-24T01:02:03.456Z')
    const [listed] = await store.listRecent({ limit: 1 })
    assert.equal(new Date(listed.observedAt).toISOString(), '2026-01-02T03:04:05.678Z')
  })

  test(`${name}: a draft outside the store scope is refused before any write`, async () => {
    const { factory } = await fresh()
    const store = await factory.open(scopeA)
    await assert.rejects(store.insertIfAbsent(await draftFor({ id: 'r-b', businessId: BUSINESS_B })), /business scope mismatch/)
    await assert.rejects(store.insertIfAbsent(await draftFor({ id: 'r-u', tenantId: 'tenant-u' })), /tenant scope mismatch/)
    assert.deepEqual(await store.listRecent({ limit: 10 }), [])
  })

  test(`${name}: businessId must be explicit, and null is its own scope`, async () => {
    const { factory } = await fresh()
    await assert.rejects(factory.open({ tenantId: TENANT_T }), /must be explicit/)
    const shared = await factory.open({ tenantId: TENANT_T, businessId: null })
    await shared.insertIfAbsent(await draftFor({ id: 'r-null', businessId: null }))
    const a = await factory.open(scopeA)
    assert.deepEqual(await a.listRecent({ limit: 10 }), [])
    assert.equal((await shared.listRecent({ limit: 10 })).length, 1)
  })

  test(`${name}: listRecent is scope-only, newest observation first, capped at 200`, async () => {
    const { factory } = await fresh()
    const a = await factory.open(scopeA)
    const b = await factory.open({ tenantId: TENANT_T, businessId: BUSINESS_B })
    await a.insertIfAbsent(await draftFor({ id: 'old', receivedAt: new Date('2026-09-01T00:00:00Z') }))
    await a.insertIfAbsent(await draftFor({ id: 'new', receivedAt: new Date('2026-09-03T00:00:00Z') }))
    await b.insertIfAbsent(await draftFor({ id: 'b-row', businessId: BUSINESS_B }))
    assert.deepEqual((await a.listRecent({ limit: 10 })).map((row) => row.rawRecordId), ['new', 'old'])
    assert.equal((await a.listRecent({ limit: 1 })).length, 1)
    await assert.doesNotReject(a.listRecent({ limit: 10_000 }))
    await assert.rejects(a.listRecent({ limit: 0 }), /positive integer/)
  })

  test(`${name}: findTranslatedRawRecordIds answers only inside the scope`, async () => {
    const { factory } = await fresh()
    const a = await factory.open(scopeA)
    const b = await factory.open({ tenantId: TENANT_T, businessId: BUSINESS_B })
    await a.insertIfAbsent(await draftFor({ id: 'shared-id' }))
    assert.deepEqual(await a.findTranslatedRawRecordIds(['shared-id', 'missing']), ['shared-id'])
    assert.deepEqual(await b.findTranslatedRawRecordIds(['shared-id']), [])
    assert.deepEqual(await a.findTranslatedRawRecordIds([]), [])
  })

  test(`${name}: findExistingLineageKeys is per schema version and scope-only`, async () => {
    const { factory } = await fresh()
    const a = await factory.open(scopeA)
    const b = await factory.open({ tenantId: TENANT_T, businessId: BUSINESS_B })
    const v1 = await draftFor({ id: 'versioned' })
    await a.insertIfAbsent(v1)
    const { buildMarketObservationLineageKey } = await import('../src/index.js')
    const v2Key = buildMarketObservationLineageKey({
      rawRecordId: v1.rawRecordId,
      payloadHash: v1.sourcePayloadHash,
      translationSchemaVersion: 'market-observation.test-v2',
      observationType: v1.observationType,
    })
    // v1 rows present, v2 run: the v2 key is new work; the v1 key is found.
    assert.deepEqual(await a.findExistingLineageKeys([v1.lineageKey, v2Key]), [v1.lineageKey])
    assert.deepEqual(await b.findExistingLineageKeys([v1.lineageKey]), [])
    assert.deepEqual(await a.findExistingLineageKeys([]), [])
  })

  test(`${name}: a lineage key owned by another scope is a collision fault, not a replay`, async () => {
    const { factory } = await fresh()
    const a = await factory.open(scopeA)
    const b = await factory.open({ tenantId: TENANT_T, businessId: BUSINESS_B })
    const draft = await draftFor({ id: 'collide' })
    await a.insertIfAbsent(draft)
    // Same globally-unique lineage key, forged into B's scope.
    await assert.rejects(b.insertIfAbsent({ ...draft, businessId: BUSINESS_B }), LineageScopeCollision)
    assert.deepEqual(await b.listRecent({ limit: 10 }), [])
  })

  test(`${name}: concurrent inserts from separate connections create exactly one row`, async (t) => {
    const current = await fresh()
    if (!current.race) return t.skip('adapter provides no multi-connection race harness')
    const draft = await draftFor({ id: 'race' })
    const statuses = await current.race(draft, 8)
    assert.equal(statuses.length, 8)
    assert.equal(statuses.filter((status) => status === 'CREATED').length, 1)
    assert.equal(statuses.filter((status) => status === 'UNCHANGED').length, 7)
    const store = await current.factory.open(scopeA)
    assert.equal((await store.listRecent({ limit: 10 })).length, 1)
  })

  test(`${name}: observations survive a store restart`, async (t) => {
    const current = await fresh()
    if (!current.reopen) return t.skip('adapter provides no reopen harness')
    const store = await current.factory.open(scopeA)
    const created = await store.insertIfAbsent(await draftFor({ id: 'durable' }))
    const reopened = await current.reopen()
    const again = await (await reopened.open(scopeA)).insertIfAbsent(await draftFor({ id: 'durable' }))
    assert.equal(again.status, 'UNCHANGED')
    assert.equal(again.observation.id, created.observation.id)
    await env.cleanup()
    env = undefined
  })

  test(`${name}: ping answers`, async () => {
    const { factory } = await fresh()
    assert.equal(await factory.ping(), true)
    await env.cleanup()
    env = undefined
  })
}
