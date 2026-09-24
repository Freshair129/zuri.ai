// Physical stocktake (FR-184) through the real SCM commands: authority, NONE /
// LOT validation, the durable preview, completeness, the atomic commit with one
// signed ADJUSTMENT per variance and one fence advance per movement, replay and
// conflict of the body key, and the stale refusal. [legacy] tests mirror apps/server
// fr184-inventory-stocktake.test.js with the same inputs and expectations; the two
// "real concurrent" cases run here through one in-process store (serialized) and
// across two processes in test/recovery/two-process-stocktake.test.js.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { TENANT, idem } from '../support/fixtures.js'

// The stocktake contract (kernel zStocktake*) takes UUID ids, as legacy Businesses are; synthetic ones here.
const BIZ = '5c0a7e11-0000-4000-8000-000000000001'
const OTHER_BIZ = '5c0a7e11-0000-4000-8000-000000000002'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] }, [OTHER_BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
}
let h, locationA, locationB, noneProduct, lotProduct, serialProduct, otherProduct, lot
const line = (productId, locationId, countedQuantity, lotId = null) => ({ productId, locationId, lotId, countedQuantity })
before(async () => {
  h = createHarness({ products: [] })
  locationA = await loc(BIZ, 'ST-LOC-A', 'TH_FINISHED_GOODS')
  locationB = await loc(BIZ, 'ST-LOC-B', 'TH_CENTRAL_RAW')
  await loc(OTHER_BIZ, 'ST-LOC-B-OTHER', 'TH_FINISHED_GOODS')
  const master = await masterOf(BIZ, 'ST')
  const sku = (businessId, masterId, code, trackingMode) => run('owner', 'inventory.product.create', { businessId, code, productMasterId: masterId, name: code, trackingMode }).then((r) => r.product)
  noneProduct = await sku(BIZ, master.id, 'ST-NONE', 'NONE')
  lotProduct = await sku(BIZ, master.id, 'ST-LOT', 'LOT')
  serialProduct = await sku(BIZ, master.id, 'ST-SERIAL', 'SERIAL')
  otherProduct = await sku(OTHER_BIZ, (await masterOf(OTHER_BIZ, 'ST-OTHER')).id, 'ST-OTHER', 'NONE')
  lot = (await run('owner', 'inventory.lot.create', { businessId: BIZ, productId: lotProduct.id, code: 'ST-LOT-1' })).lot
  await record({ productId: noneProduct.id, kind: 'RECEIPT', quantity: 10, targetLocationId: locationA.id })
  await record({ productId: noneProduct.id, kind: 'RECEIPT', quantity: 2 })
  await record({ productId: lotProduct.id, kind: 'RECEIPT', quantity: 5, lotId: lot.id, targetLocationId: locationA.id })
  await record({ productId: noneProduct.id, kind: 'RECEIPT', quantity: 4, targetLocationId: locationB.id })
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
async function loc(businessId, code, type) { return (await run('owner', 'inventory.location.create', { businessId, code, name: code, type })).location }
async function masterOf(businessId, code) {
  const category = (await run('owner', 'inventory.category.create', { businessId, code: `${code}-CAT`, nameTh: 'ทดสอบ', nameEn: 'Test' })).category
  return (await run('owner', 'inventory.product-master.create', { businessId, code: `${code}-PM`, categoryId: category.id, nameTh: 'สินค้าตรวจนับ', nameEn: 'Stocktake item' })).master
}
const record = (body) => run('owner', 'inventory.movement.record', { businessId: BIZ, ...body })
const preview = (lines, who = 'owner') => run(who, 'inventory.stocktake.preview', { businessId: BIZ, lines }).then((r) => r.stocktake)
const commit = (body, who = 'owner') => run(who, 'inventory.stocktake.commit', { businessId: BIZ, ...body }).then((r) => r.stocktake)
const count = (sqlText, ...args) => h.store.read((sql) => Number(sql.get(sqlText, ...args).n))
const fence = () => h.store.read((sql) => Number(sql.get('SELECT mutationRevision AS r FROM InventoryLedgerFence WHERE tenantId = ? AND businessId = ?', TENANT, BIZ).r))
const requestOf = (p, key) => ({ previewId: p.previewId, snapshotToken: p.snapshotToken, idempotencyKey: key, lines: p.lines.map(({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity })) })

describe('[legacy] FR-184 Inventory physical stocktake', () => {
  test('refuses unauthorized, cross-Business, SERIAL and invalid NONE/LOT inputs', async () => {
    await rejects(preview([line(noneProduct.id, locationA.id, 10)], 'member'), { status: 404 })
    await rejects(preview([line(otherProduct.id, locationA.id, 0)]), { status: 422, code: 'INVENTORY_STOCKTAKE_PRODUCT_NOT_FOUND' })
    await rejects(preview([line(serialProduct.id, locationA.id, 0)]), { status: 422, code: 'INVENTORY_STOCKTAKE_SERIAL_UNSUPPORTED' })
    await rejects(preview([line(lotProduct.id, locationA.id, 5)]), { status: 422, code: 'INVENTORY_STOCKTAKE_LOT_REQUIRED' })
    await assert.rejects(preview([line(noneProduct.id, locationA.id, 1.5)]))
    await rejects(preview([line(noneProduct.id, locationA.id, 10, lot.id)]), { status: 422, code: 'INVENTORY_STOCKTAKE_LOT_NOT_ALLOWED' })
  })

  test('persists a preview without movement/audit and refuses an omitted unlocated bucket', async () => {
    const movements = () => count('SELECT COUNT(*) AS n FROM StockMovement WHERE businessId = ?', BIZ)
    const audits = () => count("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE entityType = 'INVENTORY_STOCKTAKE'")
    const [m0, a0] = [await movements(), await audits()]
    const p = await preview([line(noneProduct.id, locationA.id, 8)])
    assert.deepEqual([p.status, p.complete, typeof p.snapshotVersion, typeof p.generatedAt], ['PREVIEWED', false, 'number', 'string'])
    assert.ok(p.missingBuckets.some((b) => b.productId === noneProduct.id && b.locationId === null && b.expectedQuantity === 2))
    assert.deepEqual([await movements(), await audits()], [m0, a0])
    await rejects(commit({ previewId: p.previewId, snapshotToken: p.snapshotToken, idempotencyKey: 'st-incomplete', lines: [line(noneProduct.id, locationA.id, 8)] }), { status: 409, code: 'INVENTORY_STOCKTAKE_INCOMPLETE' })
    assert.equal(await h.store.read((sql) => sql.get('SELECT status FROM InventoryStocktake WHERE id = ?', p.previewId).status), 'PREVIEWED')
  })

  test('allows a selected location while leaving another location outside the operation', async () => {
    const p = await preview([line(noneProduct.id, locationA.id, 10), line(noneProduct.id, null, 2)])
    assert.deepEqual([p.complete, p.missingBuckets], [true, []])
  })

  test('commits NONE and LOT variances atomically, advances the fence once per movement, and retries deterministically', async () => {
    const before = await fence()
    const p = await preview([line(noneProduct.id, locationA.id, 8), line(noneProduct.id, null, 2), line(lotProduct.id, locationA.id, 7, lot.id)])
    assert.equal(p.complete, true)
    const request = requestOf(p, 'st-success')
    const committed = await commit(request)
    assert.deepEqual([committed.status, typeof committed.generatedAt, committed.result.movementCount], ['COMMITTED', 'string', 2])
    const balance = (productId, lotId) => committed.result.lineBalances.find((b) => b.productId === productId && b.locationId === locationA.id && b.lotId === lotId)
    assert.deepEqual([balance(noneProduct.id, null).postCommitQuantity, balance(noneProduct.id, null).variance], [8, -2])
    assert.deepEqual([balance(lotProduct.id, lot.id).postCommitQuantity, balance(lotProduct.id, lot.id).variance], [7, 2])
    const rows = await h.store.read((sql) => sql.all('SELECT quantity FROM StockMovement WHERE businessId = ? AND reference = ?', BIZ, `STOCKTAKE:${p.previewId}`).map((r) => Number(r.quantity)).sort())
    assert.deepEqual(rows, [-2, 2])
    assert.equal(await fence(), before + 2)
    assert.equal(await count("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE entityType = 'INVENTORY_STOCKTAKE' AND entityId = ? AND action = 'INVENTORY_STOCKTAKE_COMMITTED'", p.previewId), 1)
    const retried = await commit(request)
    assert.deepEqual(retried.result, committed.result)
    assert.equal(await count('SELECT COUNT(*) AS n FROM StockMovement WHERE businessId = ? AND reference = ?', BIZ, `STOCKTAKE:${p.previewId}`), 2)
    await rejects(commit({ ...request, lines: request.lines.map((e) => (e.productId === noneProduct.id && e.locationId === locationA.id ? { ...e, countedQuantity: 9 } : e)) }), { status: 409, code: 'INVENTORY_STOCKTAKE_IDEMPOTENCY_CONFLICT' })
  })

  test('returns a strict stale refusal after a movement and writes no partial adjustment', async () => {
    const p = await preview([line(noneProduct.id, locationA.id, 8), line(noneProduct.id, null, 2)])
    await record({ productId: noneProduct.id, kind: 'RECEIPT', quantity: 1, targetLocationId: locationA.id })
    await rejects(commit(requestOf(p, 'st-stale')), { status: 409, code: 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE' })
    assert.equal(await h.store.read((sql) => sql.get('SELECT status FROM InventoryStocktake WHERE id = ?', p.previewId).status), 'PREVIEWED')
    assert.equal(await count('SELECT COUNT(*) AS n FROM StockMovement WHERE businessId = ? AND reference = ?', BIZ, `STOCKTAKE:${p.previewId}`), 0)
  })

  test('keeps same-key zero-variance retries as one durable no-op (two commits in flight)', async () => {
    const expected = await count('SELECT COALESCE(SUM(quantity), 0) AS n FROM StockMovement WHERE businessId = ? AND productId = ?', BIZ, lotProduct.id)
    const p = await preview([line(lotProduct.id, locationA.id, expected, lot.id)])
    assert.equal(p.complete, true)
    const request = { previewId: p.previewId, snapshotToken: p.snapshotToken, idempotencyKey: 'st-concurrent-noop', lines: [line(lotProduct.id, locationA.id, expected, lot.id)] }
    const results = await Promise.all([commit(request), commit(request)])
    assert.deepEqual(results[0].result, results[1].result)
    assert.equal(results[0].result.movementCount, 0)
    assert.equal(await count("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE entityType = 'INVENTORY_STOCKTAKE' AND entityId = ? AND action = 'INVENTORY_STOCKTAKE_COMMITTED'", p.previewId), 1)
  })

  test('two different-key commits of one snapshot: one wins, the other is stale with no partial adjustment', async () => {
    const view = await h.store.read((sql) => sql.all('SELECT quantity, sourceLocationId, targetLocationId FROM StockMovement WHERE businessId = ? AND productId = ?', BIZ, noneProduct.id))
    const atA = view.reduce((sum, m) => sum + (m.targetLocationId === locationA.id || m.sourceLocationId === locationA.id ? Number(m.quantity) : 0), 0)
    const unlocated = view.reduce((sum, m) => sum + (m.targetLocationId === null && m.sourceLocationId === null ? Number(m.quantity) : 0), 0)
    const requestLines = [line(noneProduct.id, locationA.id, atA + 1), line(noneProduct.id, null, unlocated)]
    const [a, b] = await Promise.all([preview(requestLines), preview(requestLines)])
    assert.equal(a.snapshotVersion, b.snapshotVersion)
    const outcomes = await Promise.allSettled([a, b].map((p, i) => commit({ previewId: p.previewId, snapshotToken: p.snapshotToken, idempotencyKey: `st-concurrent-mutation-${i}`, lines: requestLines })))
    const won = outcomes.filter((o) => o.status === 'fulfilled')
    const lost = outcomes.filter((o) => o.status === 'rejected')
    assert.deepEqual([won.length, lost.length, lost[0].reason.code], [1, 1, 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE'])
    assert.equal(won[0].value.result.movementCount, 1)
    assert.equal(await count(`SELECT COUNT(*) AS n FROM StockMovement WHERE businessId = ? AND reference IN (?, ?)`, BIZ, `STOCKTAKE:${a.previewId}`, `STOCKTAKE:${b.previewId}`), 1)
  })

  test('the committed stocktake reads back by id; another Business sees 404', async () => {
    const [row] = await h.store.read((sql) => sql.all("SELECT id FROM InventoryStocktake WHERE status = 'COMMITTED' ORDER BY createdAt LIMIT 1"))
    const { stocktake } = await h.bus.queries.stocktake(as('member'), row.id, { businessId: BIZ })
    assert.deepEqual([stocktake.status, stocktake.previewId], ['COMMITTED', row.id])
    await rejects(h.bus.queries.stocktake(as('owner'), row.id, { businessId: OTHER_BIZ }), { status: 404 })
  })
})
