// Customization (FR-176) and kitting (FR-177) work orders through the real SCM
// commands, queries and ledger. [legacy] tests mirror apps/server
// fr176-customization-work-order.test.js and fr177-kitting-work-order.test.js with
// the same inputs and expectations. Locations are seeded (their writers move with
// the stocktake/transfers group); the FR-180 quote hold is placed with SCM's own
// reservation command.
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
const LOC = {
  raw: { id: 'wo-raw', code: 'WO-RAW', type: 'TH_CENTRAL_RAW' },
  laser: { id: 'wo-laser', code: 'WO-LASER', type: 'TH_WIP_CUSTOMIZATION' },
  scrap: { id: 'wo-scrap', code: 'WO-SCRAP', type: 'TH_QUARANTINE_SCRAP' },
  asm: { id: 'wo-asm', code: 'WO-ASM', type: 'TH_WIP_ASSEMBLY' },
  fg: { id: 'wo-fg', code: 'WO-FG', type: 'TH_FINISHED_GOODS' },
}
let h, master
before(async () => {
  h = createHarness({ products: [], seed: { locations: Object.values(LOC) } })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'giftset', nameTh: 'ชุดของขวัญ', nameEn: 'Gift set' })).category
  master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-WO', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' })).master
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: master.id, name: code, ...over }).then((r) => r.product)
const receive = (productId, quantity, over = {}) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind: 'RECEIPT', quantity, reason: 'TEST', ...over }, { now: new Date().toISOString() }))
const issue = (productId, quantity, over = {}) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind: 'ISSUE', quantity, ...over }, { now: new Date().toISOString() }))
const onHand = (productId) => h.store.read((sql) => Number(sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?', productId).q))
const sumWhere = (productId, column, locationId) => h.store.read((sql) => Number(sql.get(`SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ? AND ${column} = ?`, productId, locationId).q))
const atLocation = (productId, locationId) => h.store.read((sql) => Number(sql.get('SELECT COALESCE(SUM(CASE WHEN quantity > 0 AND targetLocationId = ? THEN quantity WHEN quantity < 0 AND sourceLocationId = ? THEN quantity ELSE 0 END), 0) AS q FROM StockMovement WHERE productId = ?', locationId, locationId, productId).q))
const auditActions = (entityType, entityId) => h.store.read((sql) => sql.all('SELECT action FROM ScmAuditEvent WHERE entityType = ? AND entityId = ? ORDER BY occurredAt, rowid', entityType, entityId).map((a) => a.action))
const cwo = {
  open: (body, who = 'owner') => run(who, 'inventory.customization-work-order.open', { businessId: BIZ, ...body }).then((r) => r.order),
  act: (id, body, who = 'owner') => run(who, 'inventory.customization-work-order.action', { businessId: BIZ, ...body }, id),
  list: (query = {}, who = 'manager') => h.bus.queries.customizationWorkOrders(as(who), { businessId: BIZ, ...query }).then((r) => r.orders),
}
const kwo = {
  open: (body, who = 'owner') => run(who, 'inventory.kitting-work-order.open', { businessId: BIZ, ...body }).then((r) => r.order),
  act: (id, body, who = 'owner') => run(who, 'inventory.kitting-work-order.action', { businessId: BIZ, ...body }, id),
  list: (query = {}, who = 'manager') => h.bus.queries.kittingWorkOrders(as(who), { businessId: BIZ, ...query }).then((r) => r.orders),
}

describe('[legacy] FR-176 customization work orders', () => {
  const PTT = 'cust-ptt'
  const SO = 'so-ptt-2026q4'
  let tumbler, serialGadget
  before(async () => {
    tumbler = await sku('COMP-TUMBLER-SUS304-500ML', { name: 'SUS304 500ml matte' })
    serialGadget = await sku('COMP-SPEAKER-BT', { name: 'Speaker', trackingMode: 'SERIAL' })
    // 1,000 blanks at 113.46 ฿ landed.
    await receive(tumbler.id, 1000, { targetLocationId: LOC.raw.id, costSatang: 11346, reference: 'GRN:CN-2026-01' })
  })

  test('AC-176.1 — opening a run creates the branded SKU it will produce, dedicated to one customer and one order', async () => {
    const order = await cwo.open({
      rawProductId: tumbler.id, technique: 'LASER_ENGRAVING', netQuantity: 500, customerId: PTT, salesOrderId: SO,
      logoArtworkUrl: 'https://files.example/ptt.ai', pantoneColors: ['PANTONE 355 C'], setupCostSatang: 80000, runCostSatang: 1200,
      sourceLocationId: LOC.raw.id, wipLocationId: LOC.laser.id, scrapLocationId: LOC.scrap.id,
    }, 'manager')
    assert.deepEqual([order.status, order.plannedQty, order.scrapAllowanceFactor, order.grossIssueQty, order.technique], ['DRAFT', 500, 0.02, 510, 'LASER_ENGRAVING'])
    assert.match(order.code, /^CWO-\d{8}-\d{3}$/)
    assert.deepEqual(order.pantoneColors, ['PANTONE 355 C'])
    const output = (await h.bus.queries.product(as('owner'), order.outputProductId)).product
    assert.deepEqual([output.itemKind, output.dedicatedCustomerId, output.dedicatedSalesOrderId, output.stockPolicy, output.code], ['CUSTOM_COMPONENT', PTT, SO, 'TRACKED', `${tumbler.code}-${order.code}`])
    assert.equal((await h.bus.queries.product(as('owner'), tumbler.id)).product.itemKind, 'RAW_COMPONENT')
    assert.deepEqual(await auditActions('CUSTOMIZATION_WORK_ORDER', order.id), ['CUSTOMIZATION_WORK_ORDER_OPENED'])
  })

  test('AC-176.2 — a run refuses a serial blank, an already-branded blank, and a member with no write authority', async () => {
    await rejects(cwo.open({ rawProductId: serialGadget.id, technique: 'SILK_SCREEN', netQuantity: 10 }), { status: 422, code: 'INVENTORY_CUSTOMIZATION_SERIAL_UNSUPPORTED' })
    await rejects(cwo.open({ rawProductId: tumbler.id, technique: 'SILK_SCREEN', netQuantity: 10 }, 'member'), { status: 404 })
    const [first] = await cwo.list({}, 'member')
    await rejects(cwo.open({ rawProductId: first.outputProductId, technique: 'SILK_SCREEN', netQuantity: 10 }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_ALREADY_BRANDED' })
  })

  test('AC-176.3 — releasing moves the gross quantity (net + buffer) to the workshop without changing Business-wide on-hand', async () => {
    const [order] = await cwo.list({ status: 'DRAFT' })
    const before = await onHand(tumbler.id)
    const released = (await cwo.act(order.id, { action: 'RELEASE', version: order.version }, 'manager')).order
    assert.deepEqual([released.status, released.issuedQty], ['IN_PROGRESS', 510])
    assert.equal(await onHand(tumbler.id), before)
    assert.equal(await sumWhere(tumbler.id, 'targetLocationId', LOC.laser.id), 510)
    await rejects(cwo.act(order.id, { action: 'RELEASE', version: order.version }, 'manager'), { status: 409, code: 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT' })
  })

  test('AC-176.4 — completing consumes the worked units, issues the ruined ones OUT of stock, produces branded stock at its landed cost, and returns the unused buffer', async () => {
    const [order] = await cwo.list({ status: 'IN_PROGRESS' })
    const blanksBefore = await onHand(tumbler.id)
    const result = await cwo.act(order.id, { action: 'COMPLETE', version: order.version, completedQty: 502, scrapQty: 8 }, 'manager')
    assert.deepEqual([result.order.status, result.order.completedQty, result.order.scrapQty, result.order.run.unusedBufferQty], ['COMPLETED', 502, 8, 0])
    assert.equal(await onHand(tumbler.id), blanksBefore - 510)
    assert.equal(await onHand(order.outputProductId), 502)
    // FR-175 — blank landed cost + amortised setup (800 ฿ / 500) + per-piece rate (12 ฿).
    assert.equal(result.unitCostSatang, 11346 + 160 + 1200)
    const receipt = await h.store.read((sql) => sql.get("SELECT costSatang, targetLocationId, customerId, salesOrderId, workOrderId FROM StockMovement WHERE productId = ? AND kind = 'RECEIPT'", order.outputProductId))
    assert.deepEqual([Number(receipt.costSatang), receipt.targetLocationId, receipt.customerId, receipt.salesOrderId, receipt.workOrderId], [12706, LOC.laser.id, PTT, SO, order.id])
    // The 8 ruined blanks LEFT stock; they were not received into quarantine.
    assert.equal(result.scrapped.quantity, -8)
    assert.equal(await sumWhere(tumbler.id, 'targetLocationId', LOC.scrap.id), 0)
  })

  test('AC-176.5 — branded stock cannot be issued for another customer or another order (BR-028)', async () => {
    const [order] = await cwo.list({ status: 'COMPLETED' })
    const branded = order.outputProductId
    await rejects(issue(branded, 1, { customerId: 'cust-scg', salesOrderId: 'so-scg-1' }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER' })
    await rejects(issue(branded, 1, { customerId: PTT, salesOrderId: 'so-other' }), { status: 409, code: 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER' })
    assert.equal((await issue(branded, 2, { customerId: PTT, salesOrderId: SO })).onHandAfter, 500)
    // …and so does the one exit BR-028 leaves open: a stated write-off.
    const writeOff = await run('owner', 'inventory.movement.record', { businessId: BIZ, productId: branded, kind: 'ADJUSTMENT', quantity: -1, reason: 'ORPHANED_CLIENT_CANCEL' })
    assert.equal(writeOff.movement.onHandAfter, 499)
  })

  test('AC-176.6 — a scrap overrun leaves the order BLOCKED_SHORTAGE with the shortfall named, not quietly COMPLETED', async () => {
    const order = await cwo.open({ rawProductId: tumbler.id, technique: 'SILK_SCREEN', netQuantity: 100, customerId: 'cust-scg', salesOrderId: 'so-scg-1', sourceLocationId: LOC.raw.id, wipLocationId: LOC.laser.id, scrapLocationId: LOC.scrap.id })
    const released = (await cwo.act(order.id, { action: 'RELEASE', version: order.version })).order
    assert.equal(released.issuedQty, 102)
    const result = await cwo.act(released.id, { action: 'COMPLETE', version: released.version, completedQty: 90, scrapQty: 12 })
    assert.deepEqual([result.order.status, result.shortfall, result.scrapThresholdExceeded, result.order.completedAt], ['BLOCKED_SHORTAGE', 10, true, null])
    assert.deepEqual(await auditActions('CUSTOMIZATION_WORK_ORDER', order.id), ['CUSTOMIZATION_WORK_ORDER_OPENED', 'CUSTOMIZATION_WORK_ORDER_RELEASED', 'CUSTOMIZATION_WORK_ORDER_BLOCKED'])
  })

  test('AC-176.7 — cancelling returns the blanks nobody worked on, and a completed order can never be cancelled', async () => {
    const order = await cwo.open({ rawProductId: tumbler.id, technique: 'UV_DIGITAL_PRINT', netQuantity: 50, customerId: 'cust-x', salesOrderId: 'so-x', sourceLocationId: LOC.raw.id, wipLocationId: LOC.laser.id })
    const released = (await cwo.act(order.id, { action: 'RELEASE', version: order.version })).order
    const atRawBefore = await sumWhere(tumbler.id, 'targetLocationId', LOC.raw.id)
    const cancelled = await cwo.act(released.id, { action: 'CANCEL', version: released.version, reason: 'client cancelled before the run' })
    assert.deepEqual([cancelled.order.status, cancelled.returned.quantity], ['CANCELLED', 51])
    assert.equal(await sumWhere(tumbler.id, 'targetLocationId', LOC.raw.id), atRawBefore + 51)
    const [done] = await cwo.list({ status: 'COMPLETED' })
    await rejects(cwo.act(done.id, { action: 'CANCEL', version: done.version }), { status: 409, code: 'CUSTOMIZATION_WORK_ORDER_COMPLETED' })
  })
})

describe('FR-174 transfer core under a work order (lot-tracked)', () => {
  test('staging a lot-tracked blank keeps the batch identity at the workshop and does not count the move as intake', async () => {
    const lotBlank = await sku('COMP-LOT-BLANK', { trackingMode: 'LOT' })
    await receive(lotBlank.id, 100, { targetLocationId: LOC.raw.id, lotCode: 'LB-1', costSatang: 5000 })
    const lot = () => h.store.read((sql) => sql.get("SELECT id, receivedQty FROM ProductLot WHERE productId = ? AND code = 'LB-1'", lotBlank.id))
    const { id: lotId } = await lot()
    const order = await cwo.open({ rawProductId: lotBlank.id, technique: 'SILK_SCREEN', netQuantity: 10, sourceLocationId: LOC.raw.id, wipLocationId: LOC.laser.id })
    await cwo.act(order.id, { action: 'RELEASE', version: order.version })
    // The receipt half mirrors the lot the issue took from…
    const staged = await h.store.read((sql) => sql.get("SELECT lotId, quantity FROM StockMovement WHERE productId = ? AND kind = 'RECEIPT' AND targetLocationId = ?", lotBlank.id, LOC.laser.id))
    assert.deepEqual([staged.lotId, Number(staged.quantity)], [lotId, 11])
    // …and a move between two shelves is not an arrival from outside the Business.
    assert.equal(Number((await lot()).receivedQty), 100)
    assert.equal(await onHand(lotBlank.id), 100)
  })
})

describe('[legacy] FR-177 kitting work orders', () => {
  let tumbler, powerbank, box, foam, giftSet, badlyNamedSet, recipe, badRecipe
  before(async () => {
    tumbler = await sku('KIT-TUMBLER-SUS304-500ML')
    powerbank = await sku('KIT-PB-10000MAH-MAGSAFE')
    box = await sku('KIT-BOX-P-16-RIGID', { itemKind: 'PACKAGING_MATERIAL' })
    foam = await sku('KIT-FOAM-EVA-P16-4SLOT', { itemKind: 'PACKAGING_MATERIAL' })
    giftSet = await sku('SET-TMS06-4-P16', { itemKind: 'FINISHED_SET' })
    await run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'TMS06-4(P-16)' }, giftSet.id)
    badlyNamedSet = await sku('SET-DELUXE-UNREGISTERED', { itemKind: 'FINISHED_SET' })
    // Landed costs: tumbler 113.46 ฿, power bank 240.00 ฿, box 45.00 ฿, foam 12.00 ฿.
    for (const [product, cost] of [[tumbler, 11346], [powerbank, 24000], [box, 4500], [foam, 1200]]) await receive(product.id, 1000, { targetLocationId: LOC.raw.id, costSatang: cost, reference: 'GRN:CN-2026-02' })
    recipe = (await run('owner', 'inventory.recipe.create', { businessId: BIZ, code: 'RCP-TMS06-4-100', productId: giftSet.id, name: 'TMS06-4(P-16) × 100', batchSize: 100, scrapAllowanceFactor: 0.02, lines: [tumbler, powerbank, box, foam].map((p) => ({ componentProductId: p.id, qty: 100 })) })).recipe
    badRecipe = (await run('owner', 'inventory.recipe.create', { businessId: BIZ, code: 'RCP-BAD-10', productId: badlyNamedSet.id, name: 'Badly named × 10', batchSize: 10, lines: [{ componentProductId: box.id, qty: 10 }] })).recipe
  })

  test('AC-177.1 — a recipe carries its declared scrap allowance, and a run refuses an output with no valid FlowAccount code (BR-032)', async () => {
    assert.equal(recipe.scrapAllowanceFactor, 0.02)
    assert.equal(badRecipe.scrapAllowanceFactor, 0)
    await rejects(run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'GIFTSET-DELUXE' }, badlyNamedSet.id), { status: 422, code: 'INVENTORY_FINISHED_SET_SKU_INVALID' })
    await rejects(kwo.open({ recipeId: badRecipe.id, plannedQty: 10 }), { status: 422, code: 'INVENTORY_FINISHED_SET_SKU_MISSING' })
    await rejects(kwo.open({ recipeId: recipe.id, plannedQty: 10 }, 'member'), { status: 404 })
  })

  test('AC-177.2 — opening a run freezes the exploded bill of materials with the buffer already in it (BR-029)', async () => {
    const order = await kwo.open({ recipeId: recipe.id, plannedQty: 500, laborCostSatang: 500000, sourceLocationId: LOC.raw.id, wipLocationId: LOC.asm.id, targetLocationId: LOC.fg.id }, 'manager')
    assert.deepEqual([order.status, order.plannedQty], ['DRAFT', 500])
    assert.match(order.code, /^KWO-\d{8}-\d{3}$/)
    const line = (id) => order.plannedLines.find((l) => l.componentProductId === id)
    assert.deepEqual([line(tumbler.id).netQty, line(tumbler.id).grossQty, line(tumbler.id).qtyPerBatch, line(tumbler.id).batchSize], [500, 510, 100, 100])
    assert.deepEqual([line(box.id).netQty, line(box.id).grossQty], [500, 510])
  })

  test('AC-177.3 — availability is ATP, so components another quote already promised do not count as free (FR-180)', async () => {
    // 1,000 tumblers on hand and a live quote holds 400: not enough for 714 (700 + 2%).
    const quote = (await run('owner', 'inventory.reservation.create', { businessId: BIZ, productId: tumbler.id, quantity: 400, purpose: 'QUOTE', quoteReference: 'QT-SCG-1' })).reservation
    const error = await rejects(kwo.open({ recipeId: recipe.id, plannedQty: 700 }), { status: 409, code: 'INVENTORY_KITTING_SHORTAGE' })
    assert.deepEqual(error.details.map((d) => [d.code, d.required, d.available]), [['KIT-TUMBLER-SUS304-500ML', 714, 600]])
    // A released hold no longer counts (expiry on the clock is AC-180.3).
    await run('owner', 'inventory.reservation.action', { businessId: BIZ, action: 'RELEASE', version: quote.version }, quote.id)
    const fits = await kwo.open({ recipeId: recipe.id, plannedQty: 700 })
    await kwo.act(fits.id, { action: 'CANCEL', version: fits.version })
  })

  test('AC-177.4 — releasing stages the gross quantities at the line without changing Business-wide on-hand', async () => {
    const [order] = await kwo.list({ status: 'DRAFT' })
    const before = await onHand(tumbler.id)
    const released = (await kwo.act(order.id, { action: 'RELEASE', version: order.version }, 'manager')).order
    assert.equal(released.status, 'IN_PROGRESS')
    assert.equal(await onHand(tumbler.id), before)
    assert.equal(await sumWhere(tumbler.id, 'targetLocationId', LOC.asm.id), 510)
  })

  test('AC-177.5 — completing consumes what the attempts used, produces the sets at their blended landed cost, and returns the buffer (FR-175)', async () => {
    const [order] = await kwo.list({ status: 'IN_PROGRESS' })
    const tumblersBefore = await onHand(tumbler.id)
    const result = await kwo.act(order.id, { action: 'COMPLETE', version: order.version, assembledQty: 500, scrapQty: 4 }, 'manager')
    assert.deepEqual([result.order.status, result.order.assembledQty, result.order.scrapQty], ['COMPLETED', 500, 4])
    assert.equal(await onHand(tumbler.id), tumblersBefore - 504)
    assert.equal(await onHand(giftSet.id), 500)
    assert.equal(result.returned.find((r) => r.componentProductId === tumbler.id).quantity, 6)
    assert.deepEqual([result.unitCost.componentsSatang, result.unitCost.laborPerUnitSatang, result.unitCost.unitCostSatang, result.unitCost.complete], [41046, 1000, 42046, true])
    const receipt = await h.store.read((sql) => sql.get("SELECT costSatang, targetLocationId, workOrderId FROM StockMovement WHERE productId = ? AND kind = 'RECEIPT'", giftSet.id))
    assert.deepEqual([Number(receipt.costSatang), receipt.targetLocationId, receipt.workOrderId], [42046, LOC.fg.id, order.id])
    assert.equal(result.order.unitCostSatang, 42046)
  })

  test('AC-177.6 — a run cannot assemble more than it planned, be completed twice, or be completed before it is released', async () => {
    const order = await kwo.open({ recipeId: recipe.id, plannedQty: 50, sourceLocationId: LOC.raw.id, wipLocationId: LOC.asm.id, targetLocationId: LOC.fg.id })
    await rejects(kwo.act(order.id, { action: 'COMPLETE', version: order.version, assembledQty: 10 }), { status: 409, code: 'KITTING_WORK_ORDER_NOT_RELEASED' })
    const released = (await kwo.act(order.id, { action: 'RELEASE', version: order.version })).order
    await rejects(kwo.act(released.id, { action: 'COMPLETE', version: released.version, assembledQty: 60 }), { status: 409, code: 'KITTING_WORK_ORDER_OVER_ASSEMBLED' })
    const done = await kwo.act(released.id, { action: 'COMPLETE', version: released.version, assembledQty: 50 })
    assert.equal(done.order.status, 'COMPLETED')
    await rejects(kwo.act(released.id, { action: 'COMPLETE', version: done.order.version, assembledQty: 1 }), { status: 409, code: 'KITTING_WORK_ORDER_COMPLETED' })
  })

  test('AC-177.7 — a run that assembled fewer than it planned lands BLOCKED_SHORTAGE, and a cancelled one puts everything back', async () => {
    const short = await kwo.open({ recipeId: recipe.id, plannedQty: 40, sourceLocationId: LOC.raw.id, wipLocationId: LOC.asm.id, targetLocationId: LOC.fg.id })
    const shortReleased = (await kwo.act(short.id, { action: 'RELEASE', version: short.version })).order
    const shortDone = await kwo.act(shortReleased.id, { action: 'COMPLETE', version: shortReleased.version, assembledQty: 30, scrapQty: 2 })
    assert.deepEqual([shortDone.order.status, shortDone.order.assembledQty, shortDone.order.completedAt], ['BLOCKED_SHORTAGE', 30, null])

    const doomed = await kwo.open({ recipeId: recipe.id, plannedQty: 10, sourceLocationId: LOC.raw.id, wipLocationId: LOC.asm.id, targetLocationId: LOC.fg.id })
    const doomedReleased = (await kwo.act(doomed.id, { action: 'RELEASE', version: doomed.version })).order
    const stagedBefore = await atLocation(box.id, LOC.asm.id)
    const cancelled = await kwo.act(doomedReleased.id, { action: 'CANCEL', version: doomedReleased.version, reason: 'client postponed' })
    assert.equal(cancelled.order.status, 'CANCELLED')
    assert.equal(cancelled.returned.find((r) => r.componentProductId === box.id).quantity, 11)
    assert.equal(await atLocation(box.id, LOC.asm.id), stagedBefore - 11)
  })
})
