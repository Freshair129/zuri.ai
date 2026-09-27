// Two SCM processes COMPLETE the same kitting order at once (FR-177): exactly one
// posts; the finished SKU is received once and each component issued once.
// Legacy updates the order by id alone after its version check, so under
// PostgreSQL READ COMMITTED both could post (double consumption and output);
// SCM's compare-and-swap is the guard (scripts/prove-guards-on-postgres.mjs W-1).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, delegation, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const COMP = { id: 'woc-comp', code: 'WOC-COMP' }
const SET = { id: 'woc-set', code: 'WOC-SET' }
const RECIPE = { businessId: BIZ, code: 'RCP-WOC-1', productId: SET.id, name: 'WOC × 1', batchSize: 1, lines: [{ componentProductId: COMP.id, qty: 2 }] }
const markFinishedSet = (raw) => raw.prepare("UPDATE Product SET flowAccountSku = 'WOC01-1(P-01)', itemKind = 'FINISHED_SET' WHERE id = ?").run(SET.id)

const db = tempDbPath('kitting-race')
after(() => db.cleanup())

test('two processes completing the same kitting order: exactly one posts, the output is received once', async (t) => {
  seedDatabase(db, { products: [COMP, SET], stock: [{ productId: COMP.id, quantity: 100 }] })
  const raw = openRaw(db)
  try { markFinishedSet(raw) } finally { raw.close() }
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  try {
    const token = () => delegation({ sub: 'per-owner', grants: OWNER })
    const post = (p, path, body) => p.request('POST', path, { token: token(), key: idem('wo'), body })
    const recipe = await post(a, '/v1/inventory/recipes', RECIPE)
    assert.equal(recipe.status, 201, JSON.stringify(recipe.body))
    const opened = await post(a, '/v1/inventory/kitting-work-orders', { businessId: BIZ, recipeId: recipe.body.recipe.id, plannedQty: 10 })
    assert.equal(opened.status, 201, JSON.stringify(opened.body))
    const id = opened.body.order.id
    const released = await post(a, `/v1/inventory/kitting-work-orders/${id}/actions`, { businessId: BIZ, action: 'RELEASE', version: 1 })
    assert.equal(released.status, 201, JSON.stringify(released.body))
    const body = { businessId: BIZ, action: 'COMPLETE', version: 2, assembledQty: 10 }
    const results = await Promise.all([a, b].map((p) => post(p, `/v1/inventory/kitting-work-orders/${id}/actions`, body)))
    t.diagnostic(`outcomes: ${JSON.stringify(results.map((r, i) => [i ? 'B' : 'A', r.status === 201 ? 'COMPLETED' : r.body.error.code]))}`)
    assert.equal(results.filter((r) => r.status === 201).length, 1)
    // Serialized (SQLite) the loser reads the COMPLETED order; interleaved (PostgreSQL)
    // it passed the check before the winner committed and the compare-and-swap refuses it.
    assert.ok(['KITTING_WORK_ORDER_COMPLETED', 'KITTING_WORK_ORDER_VERSION_CONFLICT', 'SCM_CONCURRENT_CONFLICT', 'SCM_STORE_BUSY'].includes(results.find((r) => r.status !== 201).body.error.code))
    const check = openRaw(db)
    try {
      const sum = (productId) => Number(check.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?').get(productId).q)
      assert.equal(sum(SET.id), 10)
      assert.equal(sum(COMP.id), 100 - 20)
      assert.equal(check.prepare('SELECT status FROM KittingWorkOrder WHERE id = ?').get(id).status, 'COMPLETED')
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
