// Product ARCHIVE and MERGE (FR-205) through the real SCM commands, queries and
// ledger. [legacy] tests mirror apps/server fr201-inventory-sku-governance.test.js
// AC-205.1 and AC-205.2 with the same inputs and expectations. Quote holds are
// placed and released through SCM's own reservation commands. The last describe
// covers the blockers this tranche made reachable — recipes and open work orders.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, idem } from '../support/fixtures.js'
import { appendMovement } from '../../src/modules/inventory/index.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
}
let h, goodMaster, serviceMaster
before(async () => {
  h = createHarness({ products: [] })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'lc-cat', nameTh: 'หมวด', nameEn: 'Category' })).category
  goodMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-LC-GOOD', categoryId: category.id, nameTh: 'g', nameEn: 'g' })).master
  serviceMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-LC-SVC', categoryId: category.id, nameTh: 's', nameEn: 's', nature: 'SERVICE' })).master
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: goodMaster.id, ...over }).then((r) => r.product)
const act = (id, body, who = 'owner') => run(who, 'inventory.product.action', body, id).then((r) => r.product)
const move = (productId, kind, quantity, over = {}) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind, quantity, reason: 'TEST', ...over }, { now: new Date().toISOString() }))
const product = (id) => h.bus.queries.product(as('member'), id).then((r) => r.product)
const productAudits = (ids) => h.store.read((sql) => sql.all(`SELECT entityId, action FROM ScmAuditEvent WHERE entityType = 'PRODUCT' AND entityId IN (${ids.map(() => '?').join(',')}) ORDER BY occurredAt, rowid`, ...ids))
const hold = (productId, quantity = 1) => run('owner', 'inventory.reservation.create', { businessId: BIZ, productId, quantity }).then((r) => r.reservation.id)
const releaseHold = (id) => run('owner', 'inventory.reservation.action', { businessId: BIZ, action: 'RELEASE', version: 1 }, id)

describe('[legacy] FR-205 lifecycle: ARCHIVE and MERGE', () => {
  test('AC-205.1 — PHASE_OUT refuses receipts and keeps issuing; ARCHIVE refuses stock or a live promise; REACTIVATE restores', async () => {
    const p = await sku('LC-1', { name: 'Lifecycle', safetyStock: 0 })
    await move(p.id, 'RECEIPT', 5)
    const phased = await act(p.id, { action: 'PHASE_OUT', version: 1, reason: 'discontinued by supplier' }, 'manager')
    assert.deepEqual([phased.status, phased.version], ['PHASE_OUT', 2])
    await rejects(move(p.id, 'RECEIPT', 1), { status: 409, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    assert.equal((await move(p.id, 'ISSUE', 2)).onHandAfter, 3)
    await rejects(act(p.id, { action: 'PHASE_OUT', version: 2 }), { status: 409, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    const hasStock = await rejects(act(p.id, { action: 'ARCHIVE', version: 2 }), { status: 409, code: 'INVENTORY_PRODUCT_HAS_STOCK' })
    assert.deepEqual(hasStock.details, { onHand: 3 })

    const back = await act(p.id, { action: 'REACTIVATE', version: 2 })
    assert.deepEqual([back.status, back.version, back.archivedAt], ['ACTIVE', 3, null])
    await rejects(act(p.id, { action: 'REACTIVATE', version: 3 }), { status: 409, code: 'INVENTORY_PRODUCT_ALREADY_ACTIVE' })
    // A quote is promised while the 3 are still on hand; the units then leave, and the promise alone still holds the SKU.
    const quote = await hold(p.id, 1)
    await move(p.id, 'ISSUE', 3)
    await rejects(act(p.id, { action: 'ARCHIVE', version: 3 }), { status: 409, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' })
    await releaseHold(quote)
    const archived = await act(p.id, { action: 'ARCHIVE', version: 3 })
    assert.deepEqual([archived.status, archived.version], ['ARCHIVED', 4])
    const revived = await act(p.id, { action: 'REACTIVATE', version: 4 })
    assert.deepEqual([revived.status, revived.archivedAt], ['ACTIVE', null])
    assert.deepEqual((await productAudits([p.id])).map((a) => a.action), ['PRODUCT_CREATED', 'PRODUCT_PHASED_OUT', 'PRODUCT_REACTIVATED', 'PRODUCT_ARCHIVED', 'PRODUCT_REACTIVATED'])
  })

  test('AC-205.2 — MERGE moves stock through the ledger, re-points identifiers, conversions, bundle items and recipe lines, archives the duplicate pointing at its survivor, and never deletes', async () => {
    const keep = await sku('MG-KEEP', { name: 'Keeper', unit: 'EA', safetyStock: 0 })
    const dup = await sku('MG-DUP', { name: 'Duplicate', unit: 'EA', safetyStock: 0 })
    await move(keep.id, 'RECEIPT', 10)
    await move(dup.id, 'RECEIPT', 5)
    await run('owner', 'inventory.identifier.add', { businessId: BIZ, kind: 'BARCODE', value: 'DUP-BAR' }, dup.id)
    await run('owner', 'inventory.unit-conversion.add', { businessId: BIZ, unit: 'BOX6', factor: 6 }, dup.id)
    await run('owner', 'inventory.unit-conversion.add', { businessId: BIZ, unit: 'BOX6', factor: 6 }, keep.id)
    await run('owner', 'inventory.unit-conversion.add', { businessId: BIZ, unit: 'CTN', factor: 36 }, dup.id)
    const bundle = (await run('owner', 'inventory.bundle.create', { businessId: BIZ, code: 'MG-BND', name: 'Bundle', items: [{ productId: dup.id, qty: 2 }] })).bundle
    const clash = (await run('owner', 'inventory.bundle.create', { businessId: BIZ, code: 'MG-BND-BOTH', name: 'Both', items: [{ productId: dup.id, qty: 1 }, { productId: keep.id, qty: 1 }] })).bundle

    const blocked = await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES' })
    assert.deepEqual(blocked.details.map((b) => [b.kind, b.code]), [['BUNDLE_HOLDS_BOTH', 'MG-BND-BOTH']])
    await h.store.transaction((sql) => sql.run('DELETE FROM ProductBundleItem WHERE bundleId = ? AND productId = ?', clash.id, dup.id))
    await rejects(act(dup.id, { action: 'MERGE', version: 1, into: dup.id }), { status: 409, code: 'INVENTORY_MERGE_INTO_SELF' })
    await rejects(act(dup.id, { action: 'MERGE', version: 1, into: 'no-such' }), { status: 422, code: 'INVENTORY_MERGE_TARGET_NOT_FOUND' })
    await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }, 'member'), { status: 404 })

    const merged = await act(dup.id, { action: 'MERGE', version: 1, into: keep.id, reason: 'same tumbler entered twice' }, 'manager')
    assert.deepEqual([merged.status, merged.mergedIntoProductId, merged.version], ['ARCHIVED', keep.id, 2])
    assert.ok(merged.archivedAt)
    assert.equal((await product(dup.id)).onHand, 0)
    assert.equal((await product(keep.id)).onHand, 15)
    const pair = (await h.bus.queries.movements(as('member'), { businessId: BIZ })).movements.filter((m) => m.reference === 'MERGE:MG-DUP')
    assert.deepEqual(pair.map((m) => [m.productId, m.kind, Number(m.quantity)]).sort(), [[dup.id, 'ISSUE', -5], [keep.id, 'RECEIPT', 5]].sort())
    assert.deepEqual((await h.bus.queries.identifiers(as('member'), keep.id)).identifiers.map((i) => i.value), ['DUP-BAR'])
    assert.deepEqual((await h.bus.queries.unitConversions(as('member'), keep.id)).conversions.map((c) => c.unit).sort(), ['BOX6', 'CTN'])
    assert.deepEqual((await h.bus.queries.unitConversions(as('member'), dup.id, { includeRetired: true })).conversions.map((c) => [c.unit, c.status]), [['BOX6', 'RETIRED']])
    assert.deepEqual((await h.bus.queries.bundles(as('member'), { businessId: BIZ })).find((x) => x.id === bundle.id).items.map((i) => [i.productId, i.qty]), [[keep.id, 2]])
    const byCode = await h.bus.queries.resolve(as('member'), { businessId: BIZ, identifier: 'MG-DUP' })
    assert.deepEqual([byCode.matchedBy, byCode.product.id, byCode.redirectedFrom], ['CODE', keep.id, ['MG-DUP']])
    assert.equal((await h.bus.queries.resolve(as('member'), { businessId: BIZ, identifier: 'DUP-BAR' })).product.id, keep.id)
    await rejects(act(dup.id, { action: 'REACTIVATE', version: 2 }), { status: 409, code: 'INVENTORY_PRODUCT_MERGED' })
    assert.deepEqual((await productAudits([dup.id, keep.id])).map((a) => a.action).filter((a) => a.includes('MERGE')).sort(), ['PRODUCT_ABSORBED_MERGE', 'PRODUCT_MERGED'])
    assert.equal(await h.store.read((sql) => Number(sql.get('SELECT COUNT(*) AS n FROM Product WHERE id = ?', dup.id).n)), 1)

    // Stock that is lot-tracked cannot be moved by a merge: a person empties it first.
    const lotDup = await sku('MG-LOT', { name: 'Lot dup', trackingMode: 'LOT', safetyStock: 0 })
    await move(lotDup.id, 'RECEIPT', 2, { lotCode: 'L-1' })
    await rejects(act(lotDup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_REQUIRES_EMPTY_STOCK' })
    const svc = (await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'MG-SVC', productMasterId: serviceMaster.id })).product
    await rejects(act(svc.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_NATURE_MISMATCH' })
  })
})

describe('FR-205 MERGE against recipes and work orders (reachable now that they live in SCM)', () => {
  test('a merge re-points recipe lines and output recipes, and refuses a BOM that would change meaning or a live work order', async () => {
    const keep = await sku('RM-KEEP', { safetyStock: 0 })
    const dup = await sku('RM-DUP', { safetyStock: 0 })
    const other = await sku('RM-OTHER', { safetyStock: 0 })
    const box = await sku('RM-BOX', { safetyStock: 0 })
    const recipe = (body) => run('owner', 'inventory.recipe.create', { businessId: BIZ, ...body }).then((r) => r.recipe)
    // A recipe naming the duplicate as a component, and one producing it.
    const usesDup = await recipe({ code: 'RM-USES-DUP', productId: other.id, name: 'uses dup', batchSize: 1, lines: [{ componentProductId: dup.id, qty: 2 }] })
    const makesDup = await recipe({ code: 'RM-MAKES-DUP', productId: dup.id, name: 'makes dup', batchSize: 5, lines: [{ componentProductId: box.id, qty: 5 }] })
    // A BOM holding both SKUs would change meaning (a quantity sum), so it blocks, named.
    const holdsBoth = await recipe({ code: 'RM-HOLDS-BOTH', productId: box.id, name: 'both', batchSize: 1, lines: [{ componentProductId: dup.id, qty: 1 }, { componentProductId: keep.id, qty: 1 }] })
    const blocked = await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES' })
    assert.deepEqual(blocked.details.map((b) => [b.kind, b.code]), [['RECIPE_HOLDS_BOTH', 'RM-HOLDS-BOTH']])
    await run('owner', 'inventory.recipe.action', { action: 'UPDATE', version: 1, fields: { lines: [{ componentProductId: keep.id, qty: 1 }] } }, holdsBoth.id)

    // An open customization run on the duplicate blocks too.
    const cwo = (await run('owner', 'inventory.customization-work-order.open', { businessId: BIZ, rawProductId: dup.id, technique: 'SILK_SCREEN', netQuantity: 5 })).order
    const open = await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES' })
    assert.deepEqual(open.details.map((b) => [b.kind, b.count]), [['OPEN_CUSTOMIZATION_WORK_ORDERS', 1]])
    await run('owner', 'inventory.customization-work-order.action', { businessId: BIZ, action: 'CANCEL', version: cwo.version }, cwo.id)

    const merged = await act(dup.id, { action: 'MERGE', version: 1, into: keep.id })
    assert.deepEqual([merged.status, merged.mergedIntoProductId], ['ARCHIVED', keep.id])
    const recipes = await h.store.read((sql) => ({
      line: sql.get('SELECT componentProductId FROM ProductRecipeLine WHERE recipeId = ?', usesDup.id).componentProductId,
      output: sql.get('SELECT productId FROM ProductRecipe WHERE id = ?', makesDup.id).productId,
    }))
    assert.deepEqual(recipes, { line: keep.id, output: keep.id })
    const absorbed = (await h.store.read((sql) => sql.all("SELECT payloadJson FROM ScmAuditEvent WHERE entityId = ? AND action = 'PRODUCT_ABSORBED_MERGE'", keep.id))).map((a) => JSON.parse(a.payloadJson))
    assert.deepEqual([absorbed.length, absorbed[0].repointed.recipeLines, absorbed[0].repointed.recipes], [1, 1, 1])
  })

  test('a live promise on the duplicate blocks a merge exactly as it blocks an archive (BR-040)', async () => {
    const keep = await sku('RS-KEEP', { safetyStock: 0 })
    const dup = await sku('RS-DUP', { safetyStock: 0 })
    await move(dup.id, 'RECEIPT', 2)
    const quote = await hold(dup.id, 2)
    await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_PRODUCT_HAS_RESERVATIONS' })
    await releaseHold(quote)
    assert.equal((await act(dup.id, { action: 'MERGE', version: 1, into: keep.id })).mergedIntoProductId, keep.id)
  })

  test('F-15 — a survivor recipe at the same batch size blocks the merge by name even when archived (legacy died on the unique index)', async () => {
    const keep = await sku('F15-KEEP', { safetyStock: 0 })
    const dup = await sku('F15-DUP', { safetyStock: 0 })
    const box = await sku('F15-BOX', { safetyStock: 0 })
    const recipe = (body) => run('owner', 'inventory.recipe.create', { businessId: BIZ, ...body }).then((r) => r.recipe)
    await recipe({ code: 'F15-MAKES-DUP', productId: dup.id, name: 'makes dup', batchSize: 5, lines: [{ componentProductId: box.id, qty: 5 }] })
    const keep5 = await recipe({ code: 'F15-KEEP-5', productId: keep.id, name: 'keep × 5', batchSize: 5, lines: [{ componentProductId: box.id, qty: 5 }] })
    // Both live: the legacy blocker, unchanged in shape.
    const live = await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES' })
    assert.deepEqual(live.details, [{ kind: 'RECIPE_BATCH_SIZE_EXISTS', recipeId: live.details[0].recipeId, code: 'F15-MAKES-DUP', batchSize: 5 }])
    // Survivor's recipe archived: still a pair the store refuses, so still a named blocker.
    await run('owner', 'inventory.recipe.action', { action: 'ARCHIVE', version: 1 }, keep5.id)
    const archived = await rejects(act(dup.id, { action: 'MERGE', version: 1, into: keep.id }), { status: 409, code: 'INVENTORY_MERGE_BLOCKED_BY_REFERENCES' })
    assert.deepEqual(archived.details.map((b) => [b.kind, b.recipeStatus, b.survivorRecipeStatus]), [['RECIPE_BATCH_SIZE_EXISTS', 'ACTIVE', 'ARCHIVED']])
    assert.equal((await product(dup.id)).status, 'ACTIVE')
  })
})
