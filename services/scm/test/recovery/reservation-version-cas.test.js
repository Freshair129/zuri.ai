// Reservation compare-and-swap (FR-180): the hold's version moving between the
// check and the update (the PostgreSQL-shaped interleaving) refuses the CONVERT
// with 409, and the ORDER hold it already inserted in this unit of work rolls back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, REFERENCE_FIXTURE, idem, openTestStore } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const ACTION = 'inventory.reservation.action'
const ITEM = { id: 'rsv-cas-item', code: 'RSV-CAS-ITEM' }

test('a StockReservation version change during CONVERT is refused and the committed hold rolls back', async () => {
  const h = createHarness({ products: [ITEM], seed: { stock: [{ productId: ITEM.id, quantity: 10 }] } })
  const owner = h.as({ sub: 'per-owner', grants: OWNER })
  const { reservation } = await h.run(owner, 'inventory.reservation.create', { body: { businessId: BIZ, productId: ITEM.id, quantity: 4 } })
  await h.store.close()
  const store = openTestStore(h.db)
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { [ACTION]: { beforeReservationUpdate: () => {
    if (interleave) current.run('UPDATE StockReservation SET version = version + 1 WHERE id = ?', reservation.id)
  } } } })
  try {
    const body = { businessId: BIZ, action: 'CONVERT', version: 1, salesOrderId: 'so-cas' }
    await rejects(bus.run(owner, ACTION, { idempotencyKey: idem('cas'), targetId: reservation.id, body }), { status: 409, code: 'STOCK_RESERVATION_VERSION_CONFLICT' })
    const after = await store.read((sql) => ({ rows: Number(sql.get('SELECT COUNT(*) AS n FROM StockReservation').n), row: { ...sql.get('SELECT status, version FROM StockReservation WHERE id = ?', reservation.id) } }))
    assert.deepEqual(after, { rows: 1, row: { status: 'ACTIVE', version: 1 } })
    interleave = false
    const converted = await bus.run(owner, ACTION, { idempotencyKey: idem('cas-retry'), targetId: reservation.id, body })
    assert.deepEqual([converted.released.status, converted.committed.purpose], ['CONVERTED', 'ORDER'])
  } finally {
    await store.close()
    h.db.cleanup()
  }
})
