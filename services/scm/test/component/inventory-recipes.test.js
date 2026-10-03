// Recipes (FR-156) and de-kitting (FR-178) through the real SCM commands, queries
// and ledger. [legacy] tests mirror apps/server fr156-inventory-recipe.test.js and
// fr178-de-kitting.test.js with the same inputs and expectations; locations are
// seeded (their writers move with the stocktake/transfers group).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, idem } from '../support/fixtures.js'
import { appendMovement } from '../../src/modules/inventory/index.js'
import { pickRecipeForQuantity } from '../../src/kernel/inventory/inventory.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] }, [OTHER_BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
}
const LOC = {
  raw: { id: 'dk-raw', code: 'DK-RAW', type: 'TH_CENTRAL_RAW' },
  fg: { id: 'dk-fg', code: 'DK-FG', type: 'TH_FINISHED_GOODS' },
  scrap: { id: 'dk-scrap', code: 'DK-SCRAP', type: 'TH_QUARANTINE_SCRAP' },
  wip: { id: 'dk-wip', code: 'DK-WIP', type: 'TH_WIP_ASSEMBLY' },
}
let h
let master
before(async () => {
  h = createHarness({ products: [], seed: { locations: Object.values(LOC) } })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'executive', nameTh: 'ผู้บริหาร', nameEn: 'Executive' })).category
  master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-GIFT', categoryId: category.id, nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' })).master
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: master.id, name: code, ...over }).then((r) => r.product)
const createRecipe = (body, who = 'owner') => run(who, 'inventory.recipe.create', { businessId: BIZ, ...body }).then((r) => r.recipe)
const getRecipe = (id, query = {}, who = 'member') => h.bus.queries.recipe(as(who), id, query).then((r) => r.recipe)
const build = (id, body, who = 'owner') => run(who, 'inventory.recipe.build', { businessId: BIZ, ...body }, id).then((r) => r.build)
const deKit = (body, who = 'owner') => run(who, 'inventory.de-kit', { businessId: BIZ, ...body }).then((r) => r.deKit)
const receive = (productId, quantity, over = {}) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind: 'RECEIPT', quantity, reason: 'TEST', ...over }, { now: new Date().toISOString() }))
const onHand = (productId) => h.store.read((sql) => Number(sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?', productId).q))
const audits = (entityType, entityId) => h.store.read((sql) => sql.all(`SELECT action, payloadJson FROM ScmAuditEvent WHERE entityType = ? ${entityId ? 'AND entityId = ?' : ''} ORDER BY occurredAt, rowid`, ...[entityType, ...(entityId ? [entityId] : [])]))

describe('[legacy] FR-156 recipes (bill of materials)', () => {
  let box, ribbon, tea, card, crate, gadget, blend, foreignProduct, recipe10
  before(async () => {
    box = await sku('BOX-EXEC')
    ribbon = await sku('RIBBON', { unit: 'm' })
    tea = await sku('TEA-LEAF', { trackingMode: 'LOT', unit: 'g' })
    card = await sku('CARD-PRINT', { stockPolicy: 'UNTRACKED' })
    crate = await sku('CRATE')
    gadget = await sku('GADGET', { trackingMode: 'SERIAL' })
    blend = await sku('TEA-BLEND', { trackingMode: 'LOT', unit: 'g' })
    const foreignCategory = (await run('owner', 'inventory.category.create', { businessId: OTHER_BIZ, code: 'other', nameTh: 'อื่น', nameEn: 'Other' })).category
    const foreignMaster = (await run('owner', 'inventory.product-master.create', { businessId: OTHER_BIZ, code: 'PM-OTHER', categoryId: foreignCategory.id, nameTh: 'x', nameEn: 'x' })).master
    foreignProduct = (await run('owner', 'inventory.product.create', { businessId: OTHER_BIZ, code: 'OTHER-SKU', productMasterId: foreignMaster.id })).product
  })

  test('AC-156.1 — a recipe belongs to one output SKU at one batch size, with same-Business components that are not itself', async () => {
    const lines = [
      { componentProductId: ribbon.id, qty: 5, unit: 'm' },
      { componentProductId: tea.id, qty: 200, unit: 'g' },
      { componentProductId: card.id, qty: 10 },
      { componentProductId: crate.id, qty: 1, fixed: true, note: 'one shipping crate per batch' },
    ]
    recipe10 = await createRecipe({ code: 'RCP-BOX-10', productId: box.id, name: 'Executive box × 10', batchSize: 10, lines }, 'manager')
    assert.deepEqual([recipe10.code, recipe10.productId, recipe10.batchSize, recipe10.yieldQty, recipe10.unit, recipe10.status, recipe10.version], ['RCP-BOX-10', box.id, 10, 10, 'EA', 'ACTIVE', 1])
    assert.equal(recipe10.lines.length, 4)
    const crateLine = recipe10.lines.find((l) => l.componentProductId === crate.id)
    assert.deepEqual([crateLine.fixed, crateLine.qty], [true, 1])

    await rejects(createRecipe({ code: 'RCP-BOX-10', productId: box.id, name: 'dup', batchSize: 50, lines }), { status: 409, code: 'PRODUCT_RECIPE_CODE_TAKEN' })
    await rejects(createRecipe({ code: 'RCP-BOX-10B', productId: box.id, name: 'dup batch', batchSize: 10, lines }), { status: 409, code: 'PRODUCT_RECIPE_BATCH_TAKEN' })
    await rejects(createRecipe({ code: 'RCP-SELF', productId: box.id, name: 'self', batchSize: 1, lines: [{ componentProductId: box.id, qty: 1 }] }), { status: 422, code: 'PRODUCT_RECIPE_SELF_REFERENCE' })
    await rejects(createRecipe({ code: 'RCP-FOREIGN', productId: box.id, name: 'foreign', batchSize: 1, lines: [{ componentProductId: foreignProduct.id, qty: 1 }] }), { status: 422, code: 'PRODUCT_NOT_FOUND' })
    await rejects(createRecipe({ code: 'RCP-MEMBER', productId: box.id, name: 'x', batchSize: 1, lines }, 'member'), { status: 404 })
    assert.deepEqual((await audits('PRODUCT_RECIPE', recipe10.id)).map((a) => a.action), ['PRODUCT_RECIPE_CREATED'])
  })

  test('AC-156.2 — the recipe for a quantity is the largest batch size that fits; explosion scales every line but a fixed one and reports shortages against the ledger', async () => {
    const recipe50 = await createRecipe({ code: 'RCP-BOX-50', productId: box.id, name: 'Executive box × 50', batchSize: 50, lines: [{ componentProductId: ribbon.id, qty: 20 }, { componentProductId: crate.id, qty: 2, fixed: true }] })
    const { recipes } = await h.bus.queries.recipes(as('member'), { businessId: BIZ, productId: box.id })
    assert.deepEqual(recipes.map((r) => r.batchSize), [10, 50])
    assert.equal(pickRecipeForQuantity(recipes, 25).id, recipe10.id)
    assert.equal(pickRecipeForQuantity(recipes, 60).id, recipe50.id)
    assert.equal(pickRecipeForQuantity(recipes, 3).id, recipe10.id)

    const exploded = await getRecipe(recipe10.id, { quantity: 25 })
    const r = exploded.requirements
    assert.deepEqual([r.quantity, r.factor, r.producedQty, r.canBuild], [25, 2.5, 25, false])
    const line = (id) => r.lines.find((l) => l.componentProductId === id)
    assert.deepEqual([line(ribbon.id).required, line(ribbon.id).issueQty, line(ribbon.id).onHand, line(ribbon.id).shortage], [12.5, 13, 0, 13])
    assert.deepEqual([line(tea.id).required, line(tea.id).issueQty, line(tea.id).onHand, line(tea.id).shortage], [500, 500, 0, 500])
    assert.deepEqual([line(card.id).required, line(card.id).onHand, line(card.id).shortage], [25, null, 0])
    assert.deepEqual([line(crate.id).required, line(crate.id).fixed, line(crate.id).onHand, line(crate.id).shortage], [1, true, 0, 1])
    assert.equal(exploded.maxBuildableQuantity, 0)
    await rejects(getRecipe('no-such-recipe', {}, 'owner'), { status: 404 })
  })

  test('AC-156.3 — once stock arrives the explosion is buildable and the ledger says how many', async () => {
    await receive(ribbon.id, 20)
    await receive(crate.id, 2)
    await receive(tea.id, 300, { lotCode: 'TEA-A' })
    await receive(tea.id, 300, { lotCode: 'TEA-B' })
    await h.store.transaction((sql) => {
      sql.run("UPDATE ProductLot SET expiresAt = '2027-01-01T00:00:00.000Z' WHERE productId = ? AND code = 'TEA-A'", tea.id)
      sql.run("UPDATE ProductLot SET expiresAt = '2026-12-01T00:00:00.000Z' WHERE productId = ? AND code = 'TEA-B'", tea.id)
    })
    const ready = await getRecipe(recipe10.id, { quantity: 25 })
    assert.equal(ready.requirements.canBuild, true)
    // ribbon allows floor(20/5)*10 = 40, tea floor(600/200)*10 = 30, the crate is fixed and present.
    assert.equal(ready.maxBuildableQuantity, 30)
  })

  test('AC-156.4 — a build issues every counted component (FEFO for lots), receives the output, and is refused whole when short', async () => {
    const built = await build(recipe10.id, { quantity: 25, reference: 'ORD-001' }, 'manager')
    assert.deepEqual([built.quantity, built.factor, built.producedQty, built.reference], [25, 2.5, 25, 'ORD-001'])
    assert.deepEqual([built.produced.productId, built.produced.quantity, built.produced.onHandAfter], [box.id, 25, 25])
    const consumed = Object.fromEntries(built.consumed.map((c) => [c.componentProductId, c]))
    assert.deepEqual([consumed[ribbon.id].quantity, consumed[ribbon.id].onHandAfter], [13, 7])
    assert.deepEqual([consumed[crate.id].quantity, consumed[crate.id].onHandAfter], [1, 1])
    assert.deepEqual([consumed[tea.id].quantity, consumed[tea.id].onHandAfter], [500, 100])
    assert.equal(consumed[card.id], undefined)
    // FEFO: TEA-B expires first, so its 300 go before 200 of TEA-A.
    const lots = await h.store.read((sql) => Object.fromEntries(sql.all('SELECT l.code AS code, COALESCE(SUM(m.quantity), 0) AS q FROM ProductLot l LEFT JOIN StockMovement m ON m.lotId = l.id WHERE l.productId = ? GROUP BY l.code', tea.id).map((x) => [x.code, Number(x.q)])))
    assert.deepEqual(lots, { 'TEA-A': 100, 'TEA-B': 0 })
    const ledger = await h.store.read((sql) => sql.all("SELECT kind, quantity, productId FROM StockMovement WHERE reference = 'ORD-001'"))
    assert.equal(ledger.filter((m) => m.kind === 'ISSUE').reduce((s, m) => s + Number(m.quantity), 0), -(13 + 1 + 500))
    const receipt = ledger.find((m) => m.kind === 'RECEIPT')
    assert.deepEqual([receipt.productId, Number(receipt.quantity)], [box.id, 25])

    const error = await rejects(build(recipe10.id, { quantity: 25 }), { status: 409, code: 'INVENTORY_RECIPE_SHORTAGE' })
    assert.deepEqual(error.details.map((d) => d.code).sort(), ['RIBBON', 'TEA-LEAF'])
    const ribbonShort = error.details.find((d) => d.code === 'RIBBON')
    assert.deepEqual([ribbonShort.required, ribbonShort.onHand, ribbonShort.shortage], [13, 7, 6])
    // Nothing moved on the refused build.
    assert.equal((await getRecipe(recipe10.id)).requirements.lines.find((l) => l.componentProductId === ribbon.id).onHand, 7)
    await rejects(build(recipe10.id, { quantity: 1 }, 'member'), { status: 404 })
    const built1 = (await audits('PRODUCT_RECIPE', recipe10.id)).filter((a) => a.action === 'PRODUCT_RECIPE_BUILT')
    assert.equal(built1.length, 1)
    assert.deepEqual([JSON.parse(built1[0].payloadJson).quantity, JSON.parse(built1[0].payloadJson).producedQty], [25, 25])
  })

  test('AC-156.5 — serial components and outputs are refused, a lot-tracked output needs its lot, UPDATE replaces lines and ARCHIVE closes', async () => {
    const withGadget = await createRecipe({ code: 'RCP-GADGET', productId: box.id, name: 'x', batchSize: 1, lines: [{ componentProductId: gadget.id, qty: 1 }] })
    await rejects(build(withGadget.id, { quantity: 1 }), { status: 422, code: 'INVENTORY_RECIPE_SERIAL_COMPONENT' })
    const serialOutput = await createRecipe({ code: 'RCP-SERIAL-OUT', productId: gadget.id, name: 'x', batchSize: 1, lines: [{ componentProductId: crate.id, qty: 1 }] })
    await rejects(build(serialOutput.id, { quantity: 1 }), { status: 422, code: 'INVENTORY_RECIPE_SERIAL_OUTPUT' })

    const blendRecipe = await createRecipe({ code: 'RCP-BLEND', productId: blend.id, name: 'Blend × 100 g', batchSize: 100, lines: [{ componentProductId: tea.id, qty: 100 }] })
    await rejects(build(blendRecipe.id, { quantity: 50 }), { status: 422, code: 'INVENTORY_LOT_REQUIRED' })
    const blended = await build(blendRecipe.id, { quantity: 50, outputLotCode: 'BLEND-1' })
    assert.deepEqual([blended.produced.productId, blended.produced.quantity, blended.produced.onHandAfter], [blend.id, 50, 50])
    assert.ok(blended.produced.lotId)
    assert.deepEqual([blended.consumed[0].componentProductId, blended.consumed[0].quantity, blended.consumed[0].onHandAfter], [tea.id, 50, 50])

    const updated = (await run('manager', 'inventory.recipe.action', { action: 'UPDATE', version: 1, fields: { name: 'Executive box × 10 (v2)', lines: [{ componentProductId: ribbon.id, qty: 4 }] } }, recipe10.id)).recipe
    assert.deepEqual([updated.name, updated.version, updated.lines.length], ['Executive box × 10 (v2)', 2, 1])
    await rejects(run('owner', 'inventory.recipe.action', { action: 'ARCHIVE', version: 1 }, recipe10.id), { status: 409, code: 'PRODUCT_RECIPE_VERSION_CONFLICT' })
    const archived = (await run('owner', 'inventory.recipe.action', { action: 'ARCHIVE', version: 2 }, recipe10.id)).recipe
    assert.deepEqual([archived.status, archived.version], ['ARCHIVED', 3])
    await rejects(build(recipe10.id, { quantity: 1 }), { status: 409, code: 'PRODUCT_RECIPE_ARCHIVED' })
    assert.ok(!(await h.bus.queries.recipes(as('member'), { businessId: BIZ, productId: box.id })).recipes.map((x) => x.code).includes('RCP-BOX-10'))
    assert.ok((await h.bus.queries.recipes(as('member'), { businessId: BIZ, productId: box.id, includeArchived: true })).recipes.map((x) => x.code).includes('RCP-BOX-10'))
    assert.deepEqual((await audits('PRODUCT_RECIPE', recipe10.id)).map((a) => a.action), ['PRODUCT_RECIPE_CREATED', 'PRODUCT_RECIPE_BUILT', 'PRODUCT_RECIPE_UPDATED', 'PRODUCT_RECIPE_ARCHIVED'])
  })
})

describe('[legacy] FR-178 de-kitting', () => {
  const PTT = 'cust-ptt'
  const SO = 'so-ptt-1'
  let tumbler, brandedTumbler, box, foam, plainSet, brandedSet, plainRecipe, brandedRecipe
  before(async () => {
    tumbler = await sku('COMP-TUMBLER')
    brandedTumbler = await sku('BRANDED-TUMBLER-PTT', { itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: PTT, dedicatedSalesOrderId: SO })
    box = await sku('PKG-BOX-P-06', { itemKind: 'PACKAGING_MATERIAL' })
    foam = await sku('PKG-FOAM-EVA', { itemKind: 'PACKAGING_MATERIAL' })
    plainSet = await sku('SET-TMS06-3-P06', { itemKind: 'FINISHED_SET' })
    brandedSet = await sku('SET-TMS06-3-P06-PTT', { itemKind: 'FINISHED_SET' })
    await run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'TMS06-3(P-06)' }, plainSet.id)
    plainRecipe = await createRecipe({ code: 'RCP-PLAIN-10', productId: plainSet.id, name: 'Plain × 10', batchSize: 10, lines: [{ componentProductId: tumbler.id, qty: 10 }, { componentProductId: box.id, qty: 10 }, { componentProductId: foam.id, qty: 10 }] })
    brandedRecipe = await createRecipe({ code: 'RCP-PTT-10', productId: brandedSet.id, name: 'PTT × 10', batchSize: 10, lines: [{ componentProductId: brandedTumbler.id, qty: 10 }, { componentProductId: box.id, qty: 10 }] })
    await receive(plainSet.id, 50, { targetLocationId: LOC.fg.id, costSatang: 42046 })
    await receive(brandedSet.id, 20, { targetLocationId: LOC.fg.id })
    await receive(tumbler.id, 5, { targetLocationId: LOC.raw.id, costSatang: 11346 })
    await receive(box.id, 5, { targetLocationId: LOC.raw.id, costSatang: 4500 })
  })

  test('AC-178.1 — the sets are issued and their surviving components come back at the stated location', async () => {
    const before = { set: await onHand(plainSet.id), tumbler: await onHand(tumbler.id), box: await onHand(box.id), foam: await onHand(foam.id) }
    const result = await deKit({ recipeId: plainRecipe.id, quantity: 10, sourceLocationId: LOC.fg.id, targetLocationId: LOC.raw.id })
    assert.equal(result.quantity, 10)
    assert.equal(await onHand(plainSet.id), before.set - 10)
    assert.equal(await onHand(tumbler.id), before.tumbler + 10)
    assert.equal(await onHand(box.id), before.box + 10)
    assert.equal(await onHand(foam.id), before.foam + 10)
    const back = (productId) => h.store.read((sql) => sql.get("SELECT costSatang, targetLocationId FROM StockMovement WHERE productId = ? AND reason = 'DE_KITTING' ORDER BY createdAt, id LIMIT 1", productId))
    const tumblerBack = await back(tumbler.id)
    assert.deepEqual([Number(tumblerBack.costSatang), tumblerBack.targetLocationId], [11346, LOC.raw.id])
    assert.equal((await back(foam.id)).costSatang, null)
    assert.equal((await audits('STOCK_MOVEMENT')).filter((a) => a.action === 'STOCK_DE_KITTED').length, 1)
  })

  test('AC-178.2 — packaging the disassembly destroyed is written off, not put back on the shelf', async () => {
    const before = { box: await onHand(box.id), foam: await onHand(foam.id), tumbler: await onHand(tumbler.id) }
    const result = await deKit({ recipeId: plainRecipe.id, quantity: 10, sourceLocationId: LOC.fg.id, targetLocationId: LOC.raw.id, destroyedComponentProductIds: [box.id, foam.id] })
    assert.deepEqual(result.writtenOff.map((w) => w.code).sort(), ['PKG-BOX-P-06', 'PKG-FOAM-EVA'])
    assert.deepEqual(result.returned.map((r) => r.code), ['COMP-TUMBLER'])
    assert.equal(await onHand(tumbler.id), before.tumbler + 10)
    assert.equal(await onHand(box.id), before.box)
    assert.equal(await onHand(foam.id), before.foam)
  })

  test('AC-178.3 — a branded component can never come back into generic raw stock (BR-028)', async () => {
    await rejects(deKit({ recipeId: brandedRecipe.id, quantity: 10, sourceLocationId: LOC.fg.id, targetLocationId: LOC.raw.id }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_NOT_RETURNABLE' })
    const toWip = await deKit({ recipeId: brandedRecipe.id, quantity: 10, sourceLocationId: LOC.fg.id, targetLocationId: LOC.wip.id })
    assert.equal(await onHand(brandedTumbler.id), 10)
    const back = await h.store.read((sql) => sql.get("SELECT customerId, salesOrderId, targetLocationId FROM StockMovement WHERE productId = ? AND kind = 'RECEIPT'", brandedTumbler.id))
    assert.deepEqual([back.customerId, back.salesOrderId, back.targetLocationId], [PTT, SO, LOC.wip.id])
    assert.ok(toWip.returned.map((r) => r.code).includes('BRANDED-TUMBLER-PTT'))
    await deKit({ recipeId: brandedRecipe.id, quantity: 10, sourceLocationId: LOC.fg.id, targetLocationId: LOC.scrap.id })
    assert.equal(await onHand(brandedSet.id), 0)
  })

  test('AC-178.4 — de-kitting refuses more sets than exist, an unknown recipe, and a viewer without write authority', async () => {
    await rejects(deKit({ recipeId: plainRecipe.id, quantity: 9999, sourceLocationId: LOC.fg.id, targetLocationId: LOC.raw.id }), { status: 409, code: 'INVENTORY_INSUFFICIENT_STOCK' })
    await rejects(deKit({ recipeId: 'nope', quantity: 1 }), { status: 422, code: 'PRODUCT_RECIPE_NOT_FOUND' })
    await rejects(deKit({ recipeId: plainRecipe.id, quantity: 10 }, 'member'), { status: 404 })
  })
})
