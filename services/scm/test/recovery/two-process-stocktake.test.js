// Two SCM processes commit two previews of one stocktake snapshot at once (FR-184):
// exactly one posts its ADJUSTMENT; the other is refused STALE and writes nothing.
// The commit takes the Business ledger fence before it reads the operation and
// the snapshot, so the loser reads the winner's fence revision (guard S-1 in
// scripts/prove-guards-on-postgres.mjs).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { delegation, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const BIZ = '5c0a7e11-0000-4000-8000-0000000000a1'
const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const db = tempDbPath('stocktake-race')
after(() => db.cleanup())

test('two processes committing previews of one snapshot: one posts, the other is stale', async (t) => {
  seedDatabase(db, {})
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  try {
    const token = () => delegation({ sub: 'per-owner', grants: OWNER })
    const post = async (p, path, body) => {
      const r = await p.request('POST', path, { token: token(), key: idem('st'), body })
      if (r.status !== 201) throw Object.assign(new Error(`${path} ${r.status} ${JSON.stringify(r.body)}`), { response: r })
      return r.body
    }
    const category = (await post(a, '/v1/inventory/categories', { businessId: BIZ, code: 'st-race-cat', nameTh: 'หมวด', nameEn: 'Cat' })).category
    const master = (await post(a, '/v1/inventory/product-masters', { businessId: BIZ, code: 'PM-ST-RACE', categoryId: category.id, nameTh: 'ของ', nameEn: 'Thing' })).master
    const product = (await post(a, '/v1/inventory/products', { businessId: BIZ, code: 'SKU-ST-RACE', productMasterId: master.id })).product
    const shelf = (await post(a, '/v1/inventory/locations', { businessId: BIZ, code: 'LOC-ST-RACE', name: 'Shelf', type: 'TH_FINISHED_GOODS' })).location
    await post(a, '/v1/inventory/stock-movements', { businessId: BIZ, productId: product.id, kind: 'RECEIPT', quantity: 10, targetLocationId: shelf.id })
    const lines = [{ productId: product.id, locationId: shelf.id, lotId: null, countedQuantity: 11 }]
    const previews = [(await post(a, '/v1/inventory/stocktakes/preview', { businessId: BIZ, lines })).stocktake, (await post(b, '/v1/inventory/stocktakes/preview', { businessId: BIZ, lines })).stocktake]
    assert.equal(previews[0].snapshotVersion, previews[1].snapshotVersion)
    const results = await Promise.all(previews.map((p, i) => [a, b][i].request('POST', '/v1/inventory/stocktakes/commit', { token: token(), key: idem('st-commit'), body: { businessId: BIZ, previewId: p.previewId, snapshotToken: p.snapshotToken, idempotencyKey: `st-race-${i}`, lines } })))
    t.diagnostic(`outcomes: ${JSON.stringify(results.map((r) => (r.status === 201 ? 'COMMITTED' : r.body.error.code)))}`)
    assert.equal(results.filter((r) => r.status === 201).length, 1)
    assert.ok(['INVENTORY_STOCKTAKE_SNAPSHOT_STALE', 'SCM_CONCURRENT_CONFLICT', 'SCM_STORE_BUSY'].includes(results.find((r) => r.status !== 201).body.error.code))
    const check = openRaw(db)
    try {
      assert.equal(Number(check.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?').get(product.id).q), 11)
      assert.equal(Number(check.prepare("SELECT COUNT(*) AS n FROM StockMovement WHERE kind = 'ADJUSTMENT'").get().n), 1)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
