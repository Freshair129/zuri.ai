// The Inventory catalogue writers (FR-154, FR-201, FR-202, FR-205) through the real
// SCM commands and store. [legacy] tests mirror apps/server
// tests/integration/fr154-inventory-catalog.test.js and the in-scope cases of
// fr201-inventory-sku-governance.test.js with the same inputs and expectations;
// ARCHIVE and MERGE (AC-205) are in inventory-lifecycle.test.js.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, idem } from '../support/fixtures.js'
import { appendMovement } from '../../src/modules/inventory/index.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  manager: { [BIZ]: { owner: false, domains: ['inventory'], permissions: ['inventory.catalog.write'] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  foreignOwner: { [OTHER_BIZ]: { owner: true, domains: ['inventory'], permissions: [] }, [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
  noDomain: { [BIZ]: { owner: true, domains: ['projects'], permissions: [] } },
  otherOwner: { [OTHER_BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
}
let h
before(() => { h = createHarness({ products: [] }) })
after(() => h.close())
const as = (who) => h.as({ sub: `per-${who}`, grants: G[who] })
const run = (who, action, body, targetId = null) => h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) })
const create = (kind, body, who = 'owner') => run(who, `inventory.${kind}.create`, { businessId: BIZ, ...body })
const act = (product, body, who = 'owner') => run(who, 'inventory.product.action', body, product.id).then((r) => r.product)
const q = (who) => h.bus.queries
const audits = (entityId) => h.store.read((sql) => sql.all('SELECT action, payloadJson FROM ScmAuditEvent WHERE entityId = ? ORDER BY rowid', entityId).map((a) => ({ action: a.action, payload: JSON.parse(a.payloadJson) })))
const receive = (product, quantity, who = 'owner') => h.store.transaction((sql) => appendMovement(sql, as(who), { businessId: BIZ, productId: product.id, kind: 'RECEIPT', quantity, reason: 'TEST' }, { now: new Date().toISOString() }))
let seq = 0
const next = (prefix) => `${prefix}-${++seq}`

describe('[legacy] FR-154 Inventory catalogue', () => {
  let category, master
  test('AC-154.1 — a category, a family and a factory are created with Tenant-scoped codes and one audit row each', async () => {
    category = (await create('category', { code: 'eco-friendly', nameTh: 'รักษ์โลก', nameEn: 'Eco-friendly', slug: 'eco-friendly', vibe: 'calm', targetRecipient: 'Operations' }, 'manager')).category
    assert.deepEqual([category.code, category.businessId, category.slug, category.status, category.version], ['eco-friendly', BIZ, 'eco-friendly', 'ACTIVE', 1])
    await rejects(create('category', { code: 'eco-friendly', nameTh: 'ซ้ำ', nameEn: 'Dup' }), { status: 409, code: 'INVENTORY_CATEGORY_CODE_TAKEN' })
    await rejects(create('category', { code: 'eco-2', nameTh: 'ซ้ำ', nameEn: 'Dup', slug: 'eco-friendly' }), { status: 409, code: 'INVENTORY_CATEGORY_SLUG_TAKEN' })
    const family = (await create('family', { code: 'drinkware', name: 'Drinkware' })).family
    const factory = (await create('factory', { code: 'FAC-CM', name: 'Chiang Mai Ceramics', country: 'TH' })).factory
    assert.deepEqual([family.code, factory.code, factory.country], ['drinkware', 'FAC-CM', 'TH'])
    const actions = await h.store.read((sql) => sql.all(`SELECT action FROM ScmAuditEvent WHERE entityId IN (?,?,?) ORDER BY rowid`, category.id, family.id, factory.id).map((a) => a.action))
    assert.deepEqual(actions, ['INVENTORY_CATEGORY_CREATED', 'PRODUCT_FAMILY_CREATED', 'FACTORY_CREATED'])
    assert.equal((await q().categories(as('member'), { businessId: BIZ })).length, 1)
  })

  test('AC-154.2 — a product master references a category, family and factory of the same Business only', async () => {
    const family = (await create('family', { code: next('fam'), name: 'Family' })).family
    const foreignCategory = (await run('otherOwner', 'inventory.category.create', { businessId: OTHER_BIZ, code: 'foreign-cat', nameTh: 'อื่น', nameEn: 'Other' })).category
    await rejects(create('product-master', { code: 'PM-X', categoryId: foreignCategory.id, nameTh: 'x', nameEn: 'x' }), { status: 422, code: 'INVENTORY_CATEGORY_NOT_FOUND' })
    await rejects(create('product-master', { code: 'PM-X', categoryId: category.id, familyId: 'no-such-family', nameTh: 'x', nameEn: 'x' }), { status: 422, code: 'PRODUCT_FAMILY_NOT_FOUND' })
    master = (await create('product-master', { code: 'PM-TUMBLER', categoryId: category.id, familyId: family.id, nameTh: 'แก้วเก็บอุณหภูมิ', nameEn: 'Tumbler', baseCost: 120.5, specs: { capacityMl: 450 } }, 'manager')).master
    assert.deepEqual([master.code, master.categoryId, master.familyId, master.baseCost, master.specs], ['PM-TUMBLER', category.id, family.id, 120.5, { capacityMl: 450 }])
    assert.equal(master.specsJson, undefined)
    const listed = await q().productMasters(as('member'), { businessId: BIZ, categoryId: category.id })
    assert.ok(listed.map((m) => m.code).includes('PM-TUMBLER'))
  })

  test('AC-154.3 — a SKU fixes its stock policy and tracking mode at creation; an UNTRACKED one has no ledger', async () => {
    const counted = (await create('product', { code: 'SKU-TUMBLER-BLK', productMasterId: master.id, name: 'Tumbler black', color: 'black', stockPolicy: 'TRACKED', trackingMode: 'LOT', safetyStock: 5 }, 'manager')).product
    assert.deepEqual([counted.stockPolicy, counted.trackingMode, counted.safetyStock, counted.unit, counted.status, counted.version], ['TRACKED', 'LOT', 5, 'EA', 'ACTIVE', 1])
    const service = (await create('product', { code: 'SKU-ENGRAVING', productMasterId: master.id, name: 'Engraving service', stockPolicy: 'UNTRACKED' })).product
    assert.deepEqual([service.stockPolicy, service.trackingMode], ['UNTRACKED', 'NONE'])
    await rejects(create('product', { code: 'SKU-TUMBLER-BLK', productMasterId: master.id }), { status: 409, code: 'PRODUCT_CODE_TAKEN' })
    await rejects(create('product', { code: 'SKU-NOPE', productMasterId: 'no-such-master' }), { status: 422, code: 'PRODUCT_MASTER_NOT_FOUND' })
    await rejects(receive(service, 1), { status: 422, code: 'INVENTORY_PRODUCT_UNTRACKED' })
    assert.equal((await q().product(as('member'), service.id)).product.onHand, null)
    assert.equal((await q().product(as('member'), counted.id)).product.onHand, 0)
  })

  test('AC-154.4 — the authority ladder: members read, only OWNER or INVENTORY_MANAGER write, everything else is one 404', async () => {
    assert.ok(Array.isArray(await q().products(as('member'), { businessId: BIZ })))
    await rejects(create('category', { code: next('cat'), nameTh: 'x', nameEn: 'x' }, 'member'), { status: 404 })
    await rejects(create('category', { code: next('cat'), nameTh: 'x', nameEn: 'x' }, 'foreignOwner'), { status: 404 })
    await rejects(q().categories(as('noDomain'), { businessId: BIZ }), { status: 404 })
    await rejects(q().categories(as('owner'), { businessId: 'no-such-business' }), { status: 404 })
    await rejects(q().product(as('owner'), 'no-such-product'), { status: 404 })
    const products = await q().products(as('owner'), { businessId: BIZ })
    await rejects(act(products[0], { action: 'UPDATE', version: products[0].version, fields: { name: 'x' } }, 'member'), { status: 404 })
    // A malformed body is refused by validation before any scope question, as in legacy.
    await assert.rejects(create('category', { code: 'bad code with spaces', nameTh: 'x' }, 'member'), (e) => e.name === 'ZodError')
  })

  test('AC-154.5 — versioned product actions: UPDATE edits fields, a stale version conflicts, ARCHIVE keeps the row', async () => {
    const product = (await create('product', { code: next('SKU'), productMasterId: master.id, name: 'Before' })).product
    const updated = await act(product, { action: 'UPDATE', version: 1, fields: { name: 'After', safetyStock: 2, color: 'red' } }, 'manager')
    assert.deepEqual([updated.name, updated.safetyStock, updated.color, updated.version, updated.stockPolicy], ['After', 2, 'red', 2, 'TRACKED'])
    await rejects(act(product, { action: 'UPDATE', version: 1, fields: { name: 'x' } }), { status: 409, code: 'PRODUCT_VERSION_CONFLICT' })
    await rejects(act(product, { action: 'MERGE', version: 2, into: product.id }), { status: 409, code: 'INVENTORY_MERGE_INTO_SELF' })
    const archived = await act(product, { action: 'ARCHIVE', version: 2 })
    assert.deepEqual([archived.status, archived.version], ['ARCHIVED', 3])
    assert.deepEqual((await audits(product.id)).map((a) => a.action), ['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ARCHIVED'])
  })

  test('AC-154.6 — a bundle packs same-Business SKUs with quantities and reports the complete sets the ledger allows', async () => {
    const a = (await create('product', { code: next('SKU-A'), productMasterId: master.id, name: 'A' })).product
    const b = (await create('product', { code: next('SKU-B'), productMasterId: master.id, name: 'B' })).product
    const card = (await create('product', { code: next('SKU-CARD'), productMasterId: master.id, name: 'Greeting card', stockPolicy: 'UNTRACKED' })).product
    await rejects(create('bundle', { code: 'BND-X', name: 'x', items: [{ productId: 'no-such', qty: 1 }] }), { status: 422, code: 'PRODUCT_NOT_FOUND' })
    const bundle = (await create('bundle', { code: 'BND-EXEC', name: 'Executive box', targetRecipients: 50, totalPrice: 1490, items: [{ productId: a.id, qty: 2 }, { productId: b.id, qty: 1 }, { productId: card.id, qty: 1 }] }, 'manager')).bundle
    assert.equal(bundle.items.length, 3)
    const sets = async () => (await q().bundles(as('member'), { businessId: BIZ })).find((x) => x.id === bundle.id).availableSets
    assert.equal(await sets(), 0)
    await receive(a, 10)
    await receive(b, 3)
    assert.equal(await sets(), 3)
    await rejects(create('bundle', { code: 'BND-EXEC', name: 'dup', items: [{ productId: a.id, qty: 1 }] }), { status: 409, code: 'PRODUCT_BUNDLE_CODE_TAKEN' })
  })
})

describe('[legacy] FR-201 / FR-202 / FR-205 SKU governance (in-scope cases)', () => {
  let category, goodMaster, serviceMaster, axesMaster
  const master = (code, over = {}) => create('product-master', { code, categoryId: category.id, nameTh: code, nameEn: code, ...over }).then((r) => r.master)
  const sku = (code, over = {}) => create('product', { code, productMasterId: goodMaster.id, ...over }).then((r) => r.product)
  before(async () => {
    category = (await create('category', { code: 'gov-cat', nameTh: 'หมวด', nameEn: 'Category' })).category
    goodMaster = await master('PM-GOOD')
    serviceMaster = await master('PM-SVC', { nature: 'SERVICE' })
    axesMaster = await master('PM-AXES', { variantAxes: ['color', 'size'], defaultStockPolicy: 'UNTRACKED' })
  })

  test('AC-201.1 — a SERVICE master yields service SKUs with no stock fields; a GOOD master refuses a service', async () => {
    assert.deepEqual([serviceMaster.nature, serviceMaster.defaultStockPolicy, serviceMaster.variantAxes], ['SERVICE', 'SERVICE', []])
    assert.deepEqual([goodMaster.nature, goodMaster.defaultStockPolicy, goodMaster.variantAxes], ['GOOD', 'TRACKED', []])
    const engraving = (await create('product', { code: 'SVC-ENGRAVE', productMasterId: serviceMaster.id, name: 'Engraving', safetyStock: 9, trackingMode: 'NONE' }, 'manager')).product
    assert.deepEqual([engraving.stockPolicy, engraving.trackingMode, engraving.safetyStock, engraving.reorderPoint, engraving.variant, engraving.variantKey], ['SERVICE', 'NONE', 0, null, {}, null])
    await rejects(create('product', { code: 'SVC-X', productMasterId: serviceMaster.id, stockPolicy: 'TRACKED' }), { status: 422, code: 'INVENTORY_NATURE_MISMATCH' })
    const mismatch = await rejects(sku('GOOD-X', { stockPolicy: 'SERVICE' }), { status: 422, code: 'INVENTORY_NATURE_MISMATCH' })
    assert.deepEqual(mismatch.details, { masterNature: 'GOOD', stockPolicy: 'SERVICE' })
    const defaulted = (await create('product', { code: 'AX-DEFAULT', productMasterId: axesMaster.id, variant: { color: 'white', size: 'L' } })).product
    assert.equal(defaulted.stockPolicy, 'UNTRACKED')
    await rejects(receive(engraving, 1), { status: 422, code: 'INVENTORY_PRODUCT_IS_A_SERVICE' })
    assert.deepEqual((await q().products(as('member'), { businessId: BIZ, nature: 'SERVICE' })).map((p) => p.code), ['SVC-ENGRAVE'])
    assert.deepEqual((await q().products(as('member'), { businessId: BIZ, stockPolicy: 'UNTRACKED' })).map((p) => p.code).filter((c) => c.startsWith('AX-')), ['AX-DEFAULT'])
    assert.deepEqual((await q().productMasters(as('member'), { businessId: BIZ, nature: 'SERVICE' })).map((m) => m.code), ['PM-SVC'])
    await rejects(act(engraving, { action: 'UPDATE', version: 1, fields: { reorderPoint: 5 } }), { status: 422, code: 'INVENTORY_PRODUCT_IS_A_SERVICE' })
  })

  test('AC-202.1 — one physical variant is one SKU: the key is unique per master, values cover every axis, the legacy colour column stands in', async () => {
    const black = (await create('product', { code: 'AX-BLK-M', productMasterId: axesMaster.id, name: 'Tee', variant: { color: 'Black', size: 'M' } }, 'manager')).product
    assert.deepEqual([black.variant, black.variantKey], [{ color: 'Black', size: 'M' }, 'color=black|size=m'])
    const dup = await rejects(create('product', { code: 'AX-BLK-M-2', productMasterId: axesMaster.id, name: 'Tee again', variant: { color: ' black', size: 'm ' } }), { status: 409, code: 'INVENTORY_PRODUCT_VARIANT_EXISTS' })
    assert.deepEqual(dup.details, { existingProductId: black.id, existingCode: 'AX-BLK-M', existingStatus: 'ACTIVE', variantKey: 'color=black|size=m' })
    assert.deepEqual((await rejects(create('product', { code: 'AX-NO-SIZE', productMasterId: axesMaster.id, variant: { color: 'red' } }), { status: 422, code: 'INVENTORY_VARIANT_AXES_INCOMPLETE' })).details.missing, ['size'])
    assert.deepEqual((await rejects(create('product', { code: 'AX-EXTRA', productMasterId: axesMaster.id, variant: { color: 'red', size: 'S', fabric: 'wool' } }), { status: 422, code: 'INVENTORY_VARIANT_AXIS_UNKNOWN' })).details.unknown, ['fabric'])
    const red = (await create('product', { code: 'AX-RED-S', productMasterId: axesMaster.id, color: 'Red', variant: { size: 'S' } })).product
    assert.deepEqual([red.variantKey, red.variant], ['color=red|size=s', { color: 'Red', size: 'S' }])
    await rejects(act(red, { action: 'UPDATE', version: 1, fields: { variant: { color: 'black', size: 'M' } } }), { status: 409, code: 'INVENTORY_PRODUCT_VARIANT_EXISTS' })
    const corrected = await act(red, { action: 'UPDATE', version: 1, fields: { variant: { color: 'Crimson', size: 'S' } } })
    assert.deepEqual([corrected.variantKey, corrected.version], ['color=crimson|size=s', 2])
    assert.equal((await sku('G-A', { name: 'Widget A' })).variantKey, null)
    assert.equal((await sku('G-B', { name: 'Widget B' })).variantKey, null)
  })

  test('AC-202.2 — the lookalike guard refuses an exact duplicate under a master without axes, and records the override when a caller insists', async () => {
    const first = await sku('LK-1', { name: 'Tumbler black', color: 'Black' })
    const refused = await rejects(sku('LK-2', { name: 'tumbler-black', color: 'black' }), { status: 409, code: 'INVENTORY_PRODUCT_LOOKALIKE' })
    assert.deepEqual(refused.details, { existingProductId: first.id, existingCode: 'LK-1' })
    const second = await sku('LK-2', { name: 'tumbler-black', color: 'black', allowLookalike: true })
    assert.equal(second.code, 'LK-2')
    const created = (await audits(second.id)).find((a) => a.action === 'PRODUCT_CREATED')
    assert.deepEqual([created.payload.allowLookalike, created.payload.lookalikeOf], [true, first.id])
    assert.equal((await sku('LK-3', { name: 'Tumbler black', color: 'Red' })).code, 'LK-3')
    assert.equal((await sku('LK-4')).code, 'LK-4')
    assert.equal((await sku('LK-5')).code, 'LK-5')
  })

  test('AC-205.1 (moved half) — PHASE_OUT refuses receipts and keeps issuing; REACTIVATE restores; ARCHIVE has not moved', async () => {
    const p = await sku('LC-1', { name: 'Lifecycle', safetyStock: 0 })
    await receive(p, 5)
    const phased = await act(p, { action: 'PHASE_OUT', version: 1, reason: 'discontinued by supplier' }, 'manager')
    assert.deepEqual([phased.status, phased.version], ['PHASE_OUT', 2])
    await rejects(receive(p, 1), { status: 409, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    const issued = await h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId: p.id, kind: 'ISSUE', quantity: 2, reason: 'TEST' }, { now: new Date().toISOString() }))
    assert.equal(issued.onHandAfter, 3)
    await rejects(act(p, { action: 'PHASE_OUT', version: 2 }), { status: 409, code: 'INVENTORY_PRODUCT_PHASED_OUT' })
    const back = await act(p, { action: 'REACTIVATE', version: 2 })
    assert.deepEqual([back.status, back.version, back.archivedAt], ['ACTIVE', 3, null])
    await rejects(act(p, { action: 'REACTIVATE', version: 3 }), { status: 409, code: 'INVENTORY_PRODUCT_ALREADY_ACTIVE' })
    const events = await audits(p.id)
    assert.deepEqual(events.map((a) => a.action), ['PRODUCT_CREATED', 'PRODUCT_PHASED_OUT', 'PRODUCT_REACTIVATED'])
    assert.deepEqual([events[1].payload.reason, events[1].payload.onHand, events[1].payload.from, events[1].payload.to], ['discontinued by supplier', 5, { status: 'ACTIVE' }, { status: 'PHASE_OUT' }])
  })
})

describe('SCM additions', () => {
  test('the product page composes Inventory costing with Procurement price breaks from CONFIRMED sheets only', async () => {
    const category = (await create('category', { code: 'page-cat', nameTh: 'x', nameEn: 'x' })).category
    const m = (await create('product-master', { code: 'PM-PAGE', categoryId: category.id, nameTh: 'x', nameEn: 'x' })).master
    const p = (await create('product', { code: 'SKU-PAGE', productMasterId: m.id, name: 'Page' })).product
    const owner = h.as({ sub: 'per-page-owner', grants: { [BIZ]: { owner: true, domains: ['inventory', 'procurement'], permissions: [] } } })
    const { supplier } = await h.run(owner, 'procurement.supplier.create', { body: { businessId: BIZ, code: 'SUP-PAGE', name: 'Page supplier' } })
    const env = (hash, cost) => ({ businessId: BIZ, supplierId: supplier.id, currency: 'USD', fxRateLocked: 34, sourceSha256: hash.repeat(64), lines: [{ sku: 'SKU-PAGE', minQty: 1, unitCostForeign: cost }] })
    const commit = async (hash, cost) => {
      const sheet = (await h.run(owner, 'procurement.cost-sheet.preview', { body: env(hash, cost) })).sheet
      await h.run(owner, 'procurement.cost-sheet.commit', { body: { businessId: BIZ, sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: [{ sourceSku: 'SKU-PAGE', productId: p.id, confirmed: true }] } })
      return sheet
    }
    await commit('c', 1.5) // committed, then SUPERSEDED by the next one: its lines stay, and must not show
    const confirmed = await commit('a', 1.25)
    await h.run(owner, 'procurement.cost-sheet.preview', { body: env('b', 9) }) // a DRAFT sheet has no lines at all
    await receive(p, 4)
    const page = (await q().product(as('member'), p.id)).product
    assert.equal(page.onHand, 4)
    assert.deepEqual(page.supplierCostPriceBreaks.map((b) => [b.minQty, b.unitCostBaht, b.currency, b.sheet.code, b.sheet.supplier.code]), [[1, 42.5, 'USD', confirmed.code, 'SUP-PAGE']])
    assert.deepEqual(page.costing.supplierCostPriceBreaks, page.supplierCostPriceBreaks)
    assert.equal(page.costing.costHistory.length, 1)
  })

  test('a duplicate FlowAccount SKU is refused with the setFlowAccountSku code (legacy surfaced a bare database error)', async () => {
    const category = (await create('category', { code: 'flow-cat', nameTh: 'x', nameEn: 'x' })).category
    const m = (await create('product-master', { code: 'PM-FLOW', categoryId: category.id, nameTh: 'x', nameEn: 'x' })).master
    await create('product', { code: 'SKU-FLOW-1', productMasterId: m.id, name: 'Flow 1', flowAccountSku: 'TMS06-4(P-16)' })
    const refused = await rejects(create('product', { code: 'SKU-FLOW-2', productMasterId: m.id, name: 'Flow 2', flowAccountSku: 'TMS06-4(P-16)' }), { status: 409, code: 'INVENTORY_FLOWACCOUNT_SKU_TAKEN' })
    assert.deepEqual(refused.details, { flowAccountSku: 'TMS06-4(P-16)', takenBy: 'SKU-FLOW-1' })
  })

  test('a SKU version moved between check and update is refused and nothing is written', async () => {
    let current = null
    let interleave = false
    const hc = createHarness({ products: [], faults: { 'inventory.product.action': { beforeProductUpdate: () => { if (interleave) current.run("UPDATE Product SET name = 'concurrent', version = version + 1 WHERE code = 'SKU-CAS'") } } } })
    try {
      const transaction = hc.store.transaction
      hc.store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
      const owner = hc.as({ sub: 'per-owner', grants: G.owner })
      const c = async (action, body, targetId = null) => (await hc.run(owner, action, { body, targetId, idempotencyKey: idem(action) }))
      const category = (await c('inventory.category.create', { businessId: BIZ, code: 'cas-cat', nameTh: 'x', nameEn: 'x' })).category
      const m = (await c('inventory.product-master.create', { businessId: BIZ, code: 'PM-CAS', categoryId: category.id, nameTh: 'x', nameEn: 'x' })).master
      const p = (await c('inventory.product.create', { businessId: BIZ, code: 'SKU-CAS', productMasterId: m.id, name: 'Cas' })).product
      interleave = true
      await rejects(c('inventory.product.action', { action: 'UPDATE', version: 1, fields: { name: 'Lost' } }, p.id), { status: 409, code: 'PRODUCT_VERSION_CONFLICT' })
      const row = await hc.store.read((sql) => ({ ...sql.get('SELECT name, version FROM Product WHERE id = ?', p.id) }))
      // The concurrent edit ran inside the refused unit: it rolled back with it.
      assert.deepEqual(row, { name: 'Cas', version: 1 })
      assert.deepEqual(await hc.store.read((sql) => sql.all("SELECT action FROM ScmAuditEvent WHERE entityId = ? ORDER BY rowid", p.id).map((a) => a.action)), ['PRODUCT_CREATED'])
      interleave = false
      assert.equal((await c('inventory.product.action', { action: 'UPDATE', version: 1, fields: { name: 'Won' } }, p.id)).product.name, 'Won')
    } finally { await hc.close() }
  })
})
