// SKU identity (FR-203, FR-204, FR-177) through the real SCM commands, queries and
// ledger. [legacy] tests mirror apps/server fr201-inventory-sku-governance.test.js
// AC-203.1 and AC-204.1 with the same inputs and expectations; the merge-redirect
// half of resolve uses a SKU whose mergedIntoProductId is set directly (MERGE
// itself has not moved — SCM-HANDOFF F-13).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, idem } from '../support/fixtures.js'
import { appendMovement } from '../../src/modules/inventory/index.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  noDomain: { [BIZ]: { owner: false, domains: ['projects'], permissions: [] } },
}
let h, goodMaster, serviceMaster
before(async () => {
  h = createHarness({ products: [] })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'id-cat', nameTh: 'หมวด', nameEn: 'Category' })).category
  goodMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-ID-GOOD', categoryId: category.id, nameTh: 'g', nameEn: 'g' })).master
  serviceMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-ID-SVC', categoryId: category.id, nameTh: 's', nameEn: 's', nature: 'SERVICE' })).master
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: goodMaster.id, ...over }).then((r) => r.product)
const addIdentifier = (productId, body, who = 'owner') => run(who, 'inventory.identifier.add', { businessId: BIZ, ...body }, productId).then((r) => r.identifier)
const addConversion = (productId, body, who = 'owner') => run(who, 'inventory.unit-conversion.add', { businessId: BIZ, ...body }, productId).then((r) => r.conversion)
const resolve = (identifier, who = 'member') => h.bus.queries.resolve(as(who), { businessId: BIZ, identifier })
const receive = (productId, quantity, over = {}) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind: 'RECEIPT', quantity, reason: 'TEST', ...over }, { now: new Date().toISOString() }))

describe('[legacy] FR-203 identifiers and resolve', () => {
  test('AC-203.1 — identifiers: valid GTIN, unique per Tenant, one value space for the scannable kinds, retire keeps the row, and resolve finds the SKU', async () => {
    const a = await sku('ID-A', { name: 'Identified A' })
    const c = await sku('ID-C', { name: 'Identified C' })
    const gtin = await addIdentifier(a.id, { kind: 'GTIN', value: '4006381333931', issuer: 'GS1' }, 'manager')
    assert.deepEqual([gtin.kind, gtin.value, gtin.status, gtin.version, gtin.productId], ['GTIN', '4006381333931', 'ACTIVE', 1, a.id])
    await assert.rejects(addIdentifier(a.id, { kind: 'GTIN', value: '4006381333932' }), /check digit/)
    const taken = await rejects(addIdentifier(c.id, { kind: 'GTIN', value: '4006381333931' }), { status: 409, code: 'INVENTORY_IDENTIFIER_TAKEN' })
    assert.deepEqual([taken.details.productId, taken.details.code], [a.id, 'ID-A'])
    await rejects(addIdentifier(c.id, { kind: 'BARCODE', value: '4006381333931' }), { status: 409, code: 'INVENTORY_IDENTIFIER_TAKEN' })
    const supplier = await addIdentifier(c.id, { kind: 'SUPPLIER_CODE', value: '4006381333931', issuer: 'ACME' })
    assert.equal(supplier.kind, 'SUPPLIER_CODE')
    await rejects(addIdentifier(a.id, { kind: 'BARCODE', value: 'CASE-A', unit: 'BOX12' }), { status: 422, code: 'INVENTORY_UNIT_UNKNOWN' })
    await rejects(addIdentifier(a.id, { kind: 'BARCODE', value: 'X' }, 'member'), { status: 404 })
    assert.equal((await h.bus.queries.identifiers(as('member'), a.id)).identifiers.length, 1)

    const byIdentifier = await resolve('4006381333931')
    assert.deepEqual([byIdentifier.matchedBy, byIdentifier.product.id, byIdentifier.product.code, byIdentifier.matchedIdentifier.kind, byIdentifier.matchedIdentifier.factor, byIdentifier.redirectedFrom], ['IDENTIFIER', a.id, 'ID-A', 'GTIN', 1, []])
    const byCode = await resolve('ID-C')
    assert.deepEqual([byCode.matchedBy, byCode.product.id], ['CODE', c.id])
    await run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'GOV01-2(P-1)' }, c.id)
    const byFlow = await resolve('GOV01-2(P-1)')
    assert.deepEqual([byFlow.matchedBy, byFlow.product.id], ['FLOWACCOUNT_SKU', c.id])
    const miss = await resolve('nobody-knows-this')
    assert.deepEqual([miss.matchedBy, miss.product], [null, null])
    await rejects(resolve('ID-A', 'noDomain'), { status: 404 })

    const retired = (await run('owner', 'inventory.identifier.action', { identifierId: gtin.id, action: 'RETIRE', version: 1 }, a.id)).identifier
    assert.deepEqual([retired.status, retired.version], ['RETIRED', 2])
    await rejects(run('owner', 'inventory.identifier.action', { identifierId: gtin.id, action: 'RETIRE', version: 2 }, a.id), { status: 409, code: 'PRODUCT_IDENTIFIER_RETIRED' })
    assert.equal((await h.bus.queries.identifiers(as('member'), a.id)).identifiers.length, 0)
    assert.equal((await h.bus.queries.identifiers(as('member'), a.id, { includeRetired: true })).identifiers.length, 1)
    const afterRetire = await resolve('4006381333931')
    assert.deepEqual([afterRetire.matchedBy, afterRetire.product.id, afterRetire.matchedIdentifier.kind], ['IDENTIFIER', c.id, 'SUPPLIER_CODE'])
    await rejects(addIdentifier(c.id, { kind: 'GTIN', value: '4006381333931' }), { status: 409, code: 'INVENTORY_IDENTIFIER_TAKEN' })
  })
})

describe('[legacy] FR-204 unit conversions', () => {
  test('AC-204.1 — a pack size is a conversion: a movement in BOX12 lands in base units, the base unit and an unknown unit are refused, a serial product takes none', async () => {
    const bottle = await sku('UOM-BOTTLE', { name: 'Bottle', unit: 'EA' })
    const box = await addConversion(bottle.id, { unit: 'BOX12', name: 'Box of 12', factor: 12, usage: 'PURCHASE' }, 'manager')
    assert.deepEqual([box.unit, box.factor, box.usage, box.status, box.version], ['BOX12', 12, 'PURCHASE', 'ACTIVE', 1])
    await rejects(addConversion(bottle.id, { unit: 'EA', factor: 1 }), { status: 422, code: 'INVENTORY_UNIT_IS_BASE' })
    await rejects(addConversion(bottle.id, { unit: 'BOX12', factor: 24 }), { status: 409, code: 'INVENTORY_UNIT_TAKEN' })
    const listed = await h.bus.queries.unitConversions(as('member'), bottle.id)
    assert.deepEqual([listed.baseUnit, listed.conversions.map((x) => x.unit)], ['EA', ['BOX12']])

    const moved = await receive(bottle.id, 2, { unit: 'BOX12', reference: 'PO:1' })
    assert.deepEqual([moved.quantity, moved.onHandAfter, moved.unitConversion], [24, 24, { unit: 'BOX12', factor: 12, quantityInUnit: 2 }])
    assert.equal((await h.bus.queries.product(as('member'), bottle.id)).product.onHand, 24)
    const audit = await h.store.read((sql) => JSON.parse(sql.get("SELECT payloadJson FROM ScmAuditEvent WHERE entityType = 'STOCK_MOVEMENT' AND entityId = ?", moved.movements[0].id).payloadJson))
    assert.deepEqual([audit.quantity, audit.unitConversion], [24, { unit: 'BOX12', factor: 12, quantityInUnit: 2 }])
    assert.equal((await receive(bottle.id, 3, { unit: 'EA' })).onHandAfter, 27)
    await rejects(receive(bottle.id, 1, { unit: 'PALLET' }), { status: 422, code: 'INVENTORY_UNIT_UNKNOWN' })
    await addIdentifier(bottle.id, { kind: 'BARCODE', value: 'CASE-BOTTLE', unit: 'BOX12' })
    const pack = await resolve('CASE-BOTTLE')
    assert.deepEqual([pack.matchedBy, pack.product.id, pack.matchedIdentifier.unit, pack.matchedIdentifier.factor], ['IDENTIFIER', bottle.id, 'BOX12', 12])

    const updated = (await run('owner', 'inventory.unit-conversion.action', { conversionId: box.id, action: 'UPDATE', version: 1, fields: { factor: 10 } }, bottle.id)).conversion
    assert.deepEqual([updated.factor, updated.version], [10, 2])
    const retired = (await run('owner', 'inventory.unit-conversion.action', { conversionId: box.id, action: 'RETIRE', version: 2 }, bottle.id)).conversion
    assert.equal(retired.status, 'RETIRED')
    await rejects(receive(bottle.id, 1, { unit: 'BOX12' }), { status: 422, code: 'INVENTORY_UNIT_UNKNOWN' })

    const serial = await sku('UOM-SERIAL', { name: 'Serial thing', trackingMode: 'SERIAL' })
    await rejects(addConversion(serial.id, { unit: 'PAIR', factor: 2 }), { status: 422, code: 'INVENTORY_UNIT_NOT_FOR_SERIAL' })
    const service = (await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'UOM-SVC', productMasterId: serviceMaster.id })).product
    await rejects(addConversion(service.id, { unit: 'DAY', factor: 8 }), { status: 422, code: 'INVENTORY_PRODUCT_IS_A_SERVICE' })
  })
})

describe('SCM additions', () => {
  test('resolve follows a merged duplicate to its survivor (merge data arriving by transfer)', async () => {
    const keep = await sku('RS-KEEP', { name: 'Keeper' })
    const dup = await sku('RS-DUP', { name: 'Duplicate' })
    await addIdentifier(dup.id, { kind: 'BARCODE', value: 'RS-DUP-BAR' })
    await h.store.transaction((sql) => sql.run("UPDATE Product SET mergedIntoProductId = ?, status = 'ARCHIVED' WHERE id = ?", keep.id, dup.id))
    const byCode = await resolve('RS-DUP')
    assert.deepEqual([byCode.matchedBy, byCode.product.id, byCode.redirectedFrom], ['CODE', keep.id, ['RS-DUP']])
    assert.equal((await resolve('RS-DUP-BAR')).product.id, keep.id)
  })

  test('FlowAccount SKU: pattern first (even unauthorized), unique per Tenant, archived SKU refused, audited', async () => {
    const a = await sku('FA-A', { name: 'FA A' })
    const b = await sku('FA-B', { name: 'FA B' })
    await rejects(run('member', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'not a set' }, a.id), { status: 422, code: 'INVENTORY_FINISHED_SET_SKU_INVALID' })
    await rejects(run('member', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'FA01-2(P-1)' }, a.id), { status: 404 })
    const set = (await run('manager', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'FA01-2(P-1)' }, a.id)).product
    assert.deepEqual([set.flowAccountSku, set.version], ['FA01-2(P-1)', 2])
    const clash = await rejects(run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'FA01-2(P-1)' }, b.id), { status: 409, code: 'INVENTORY_FLOWACCOUNT_SKU_TAKEN' })
    assert.deepEqual(clash.details, { flowAccountSku: 'FA01-2(P-1)', takenBy: 'FA-A' })
    const audit = await h.store.read((sql) => JSON.parse(sql.get("SELECT payloadJson FROM ScmAuditEvent WHERE entityId = ? AND action = 'PRODUCT_FLOWACCOUNT_SKU_SET'", a.id).payloadJson))
    assert.deepEqual([audit.from, audit.to], [null, 'FA01-2(P-1)'])
  })

  test('an identifier action names the SKU in its path: an identifier of another SKU is 404', async () => {
    const a = await sku('PATH-A', { name: 'Path A' })
    const b = await sku('PATH-B', { name: 'Path B' })
    const ida = await addIdentifier(a.id, { kind: 'BARCODE', value: 'PATH-A-BAR' })
    await rejects(run('owner', 'inventory.identifier.action', { identifierId: ida.id, action: 'RETIRE', version: 1 }, b.id), { status: 404 })
  })
})
