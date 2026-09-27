// Two SCM processes placing and converting holds at once (FR-180).
//  1. Eight concurrent holds of 3 over 10 units: at most 3 commit and the live
//     holds never exceed on-hand. Legacy reads on-hand and the live holds with no
//     lock, so under PostgreSQL READ COMMITTED concurrent holds can all pass and
//     promise the same units (F-16); SCM takes the Business's ledger fence first
//     (D-23; scripts/prove-guards-on-postgres.mjs R-1).
//  2. Two concurrent CONVERTs of one quote hold: exactly one commits, so exactly
//     one ORDER hold exists. Legacy updates the hold by id after its version check
//     (F-17); SCM compares-and-swaps it (R-2).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, delegation, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const ITEM = { id: 'rsv-race-item', code: 'RSV-RACE-ITEM' }
const db = tempDbPath('reservation-race')
after(() => db.cleanup())

test('concurrent holds never promise more than on-hand; one hold converts once', async (t) => {
  seedDatabase(db, { products: [ITEM], stock: [{ productId: ITEM.id, quantity: 10 }] })
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  try {
    const token = () => delegation({ sub: 'per-owner', grants: OWNER })
    const post = (p, path, body) => p.request('POST', path, { token: token(), key: idem('rsv'), body })
    const holds = await Promise.all(Array.from({ length: 8 }, (_, i) => post(i % 2 ? b : a, '/v1/inventory/reservations', { businessId: BIZ, productId: ITEM.id, quantity: 3, quoteReference: `QT-RACE-${i}` })))
    const won = holds.filter((r) => r.status === 201)
    t.diagnostic(`outcomes: ${JSON.stringify(holds.map((r) => (r.status === 201 ? 'HELD' : r.body.error.code)))}`)
    for (const r of holds.filter((x) => x.status !== 201)) assert.ok(['STOCK_RESERVATION_INSUFFICIENT_ATP', 'SCM_CONCURRENT_CONFLICT', 'SCM_STORE_BUSY'].includes(r.body.error.code), r.body.error.code)
    const check = openRaw(db)
    try {
      const held = Number(check.prepare("SELECT COALESCE(SUM(quantity), 0) AS q FROM StockReservation WHERE productId = ? AND status = 'ACTIVE'").get(ITEM.id).q)
      assert.ok(held <= 10, `held ${held} of 10`)
      assert.equal(won.length, held / 3)
    } finally { check.close() }

    const hold = won[0].body.reservation
    const converts = await Promise.all([a, b].map((p) => post(p, `/v1/inventory/reservations/${hold.id}/actions`, { businessId: BIZ, action: 'CONVERT', version: hold.version, salesOrderId: 'so-race' })))
    t.diagnostic(`outcomes: ${JSON.stringify(converts.map((r) => (r.status === 201 ? 'CONVERTED' : r.body.error.code)))}`)
    assert.equal(converts.filter((r) => r.status === 201).length, 1)
    const check2 = openRaw(db)
    try {
      assert.equal(Number(check2.prepare("SELECT COUNT(*) AS n FROM StockReservation WHERE salesOrderId = 'so-race' AND purpose = 'ORDER'").get().n), 1)
    } finally { check2.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
