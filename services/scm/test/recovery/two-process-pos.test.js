// Acceptance B10 (issue half) + D26 for POS on SQLite: two SEPARATE SCM processes
// sell the last 3 units with 8 concurrent single-unit checkouts. Exactly 3
// commit; the rest are refused INVENTORY_INSUFFICIENT_STOCK with no trace; ledger,
// orders and PENDING payments agree; codes stay unique. SQLite engine only.
// Also: a process with no reference owner configured refuses POS (503), never
// assuming a Branch/Customer is valid.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, LOCATIONS, PRODUCTS, REFERENCE_FIXTURE, ROLES, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const db = tempDbPath('pos-race')
after(() => db.cleanup())
seedDatabase(db.path, { products: [PRODUCTS.plain], locations: [LOCATIONS.shop], stock: [{ productId: PRODUCTS.plain.id, quantity: 3 }] })
const fixturePath = join(dirname(db.path), 'references.json')
writeFileSync(fixturePath, JSON.stringify(REFERENCE_FIXTURE))
const sale = { businessId: BIZ, branchId: 'branch-main', warehouseLocationId: LOCATIONS.shop.id, lines: [{ productId: PRODUCTS.plain.id, qty: 1, unitPrice: 99 }], payment: { method: 'CASH', receivedAmount: 100 } }

test('8 concurrent checkouts over 3 units across two processes never oversell', async (t) => {
  const env = { SCM_TEST_REFERENCE_FIXTURE: fixturePath }
  const a = await startScmProcess({ sqlitePath: db.path, env })
  const b = await startScmProcess({ sqlitePath: db.path, env })
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).request('POST', '/v1/commerce/pos/checkout', {
      token: delegation({ sub: `person-cashier-${i}`, grants: { [BIZ]: ROLES.cashier } }), key: idem(`pos-${i}`), body: sale,
    })))
    t.diagnostic(`outcomes: ${JSON.stringify(results.map((r, i) => [i % 2 ? 'A' : 'B', r.status === 201 ? 'COMMITTED' : r.body.error.code]))}`)
    const committed = results.filter((r) => r.status === 201)
    assert.equal(committed.length, 3)
    for (const r of results.filter((x) => x.status !== 201)) assert.ok(['INVENTORY_INSUFFICIENT_STOCK', 'SCM_STORE_BUSY'].includes(r.body.error.code), r.body.error.code)
    for (const r of committed) assert.equal(r.body.paymentStatus, 'PENDING')
    const check = new DatabaseSync(db.path)
    try {
      assert.equal(check.prepare('SELECT SUM(quantity) AS q FROM StockMovement').get().q, 0, 'on-hand never below zero')
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM SalesOrder').get().n, 3)
      assert.equal(check.prepare('SELECT COUNT(DISTINCT code) AS n FROM SalesOrder').get().n, 3)
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM Payment WHERE status = 'PENDING'").get().n, 3)
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM Payment WHERE status != 'PENDING'").get().n, 0)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})

test('without a reference owner the process refuses POS with a retryable 503 and writes nothing', async () => {
  const scm = await startScmProcess({ sqlitePath: db.path })
  try {
    assert.ok(scm.logs.some((l) => l.message === 'listening' && l.references === 'unavailable'))
    const res = await scm.request('POST', '/v1/commerce/pos/checkout', { token: delegation({ sub: 'p', grants: { [BIZ]: ROLES.cashier } }), key: idem('pos'), body: sale })
    assert.deepEqual([res.status, res.body.error.code, res.body.error.retryable], [503, 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE', true])
  } finally { await scm.kill() }
})

test('the reference fixture seam is refused outside SCM_ENV=test', async () => {
  await assert.rejects(startScmProcess({ sqlitePath: db.path, env: { SCM_ENV: 'production', SCM_TEST_REFERENCE_FIXTURE: fixturePath } }), (e) => e.exitCode === 1 && e.logs.some((l) => l.code === 'SCM_CONFIG_INVALID'))
})
