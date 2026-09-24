// Kitting work-order compare-and-swap (FR-177). Legacy COMPLETE checks the
// order's version and then updates by id alone; SCM compares-and-swaps the order
// row in the same unit of work as the ledger rows. The PostgreSQL-shaped
// interleaving — the version moves between the check and the update — is
// refused with 409 and the stock already moved in this unit of work rolls back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, REFERENCE_FIXTURE, idem, openRaw, openTestStore } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const ACTION = 'inventory.kitting-work-order.action'
const COMP = { id: 'woc-comp', code: 'WOC-COMP' }
const SET = { id: 'woc-set', code: 'WOC-SET' }
const RECIPE = { businessId: BIZ, code: 'RCP-WOC-1', productId: SET.id, name: 'WOC × 1', batchSize: 1, lines: [{ componentProductId: COMP.id, qty: 2 }] }
const markFinishedSet = (raw) => raw.prepare("UPDATE Product SET flowAccountSku = 'WOC01-1(P-01)', itemKind = 'FINISHED_SET' WHERE id = ?").run(SET.id)

test('a KittingWorkOrder version change during COMPLETE is refused and the consumption rolls back', async () => {
  const h = createHarness({ products: [COMP, SET], seed: { stock: [{ productId: COMP.id, quantity: 100 }] } })
  const raw = openRaw(h.db)
  try { markFinishedSet(raw) } finally { raw.close() }
  const owner = h.as({ sub: 'per-owner', grants: OWNER })
  const { recipe } = await h.run(owner, 'inventory.recipe.create', { body: RECIPE })
  const { order } = await h.run(owner, 'inventory.kitting-work-order.open', { body: { businessId: BIZ, recipeId: recipe.id, plannedQty: 10 } })
  const released = (await h.run(owner, ACTION, { targetId: order.id, body: { businessId: BIZ, action: 'RELEASE', version: 1 } })).order
  const before = await h.snapshot()
  await h.store.close()
  const store = openTestStore(h.db)
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { [ACTION]: { beforeOrderUpdate: () => {
    if (interleave) current.run('UPDATE KittingWorkOrder SET version = version + 1 WHERE id = ?', order.id)
  } } } })
  try {
    const body = { businessId: BIZ, action: 'COMPLETE', version: released.version, assembledQty: 10 }
    await rejects(bus.run(owner, ACTION, { idempotencyKey: idem('cas'), targetId: order.id, body }), { status: 409, code: 'KITTING_WORK_ORDER_VERSION_CONFLICT' })
    const after = await store.read((sql) => ({ moves: Number(sql.get('SELECT COUNT(*) AS n FROM StockMovement').n), row: { ...sql.get('SELECT status, version, assembledQty FROM KittingWorkOrder WHERE id = ?', order.id) }, fence: Number(sql.get('SELECT COALESCE(MAX(mutationRevision), -1) AS r FROM InventoryLedgerFence').r) }))
    assert.deepEqual(after, { moves: before.StockMovement, row: { status: 'IN_PROGRESS', version: 2, assembledQty: 0 }, fence: Number(before.fence) })
    interleave = false
    assert.equal((await bus.run(owner, ACTION, { idempotencyKey: idem('cas-retry'), targetId: order.id, body })).order.status, 'COMPLETED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})

