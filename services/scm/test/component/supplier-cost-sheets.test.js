// Supplier cost sheets (TASK-ZAI-053, FR-164 + FR-154) through the real SCM use
// cases and store. [legacy] tests mirror apps/server
// tests/integration/task-zai-053-supplier-cost-sheet.test.js with the same
// envelope and expectations; the rest pin the commit path's guards and its
// single unit of work (Procurement lines + Inventory carton facts + supersession).
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, idem } from '../support/fixtures.js'

const HASH = 'a'.repeat(64)
const P = {
  box: { id: 'prod-box', code: 'SG-BOX-053', name: 'Gift box' },
  missing: { id: 'prod-missing', code: 'SG-MISSING-053', name: 'Missing carton data' },
  cup: { id: 'prod-cup', code: 'SG-CUP-053', name: 'Mug' },
  archived: { id: 'prod-arch', code: 'SG-ARCH-053', status: 'ARCHIVED' },
  foreign: { id: 'prod-foreign', code: 'SG-FOREIGN-053', businessId: OTHER_BIZ },
}
const G = {
  owner: { [BIZ]: { owner: true, domains: ['procurement', 'inventory'], permissions: [] } },
  buyer: { [BIZ]: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write'] } },
  buyerWithInventory: { [BIZ]: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write', 'inventory.catalog.write'] } },
  inventoryOnly: { [BIZ]: { owner: false, domains: ['procurement', 'inventory'], permissions: ['inventory.catalog.write'] } },
  noProcurementDomain: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  viewer: { [BIZ]: { owner: false, domains: ['procurement'], permissions: [] } },
}

let h, supplier
beforeEach(async () => {
  h = createHarness({ products: Object.values(P), seed: { identifiers: [{ productId: P.cup.id, value: '8850000000017' }] } })
  supplier = (await h.run(as('owner'), 'procurement.supplier.create', { body: { businessId: BIZ, code: 'SUP-COST-053', name: 'Factory Cost Supplier' } })).supplier
})
afterEach(() => h.close())
const as = (who) => h.as({ sub: `per-${who}`, grants: G[who] })

const envelope = (over = {}) => ({
  businessId: BIZ, supplierId: supplier.id, currency: 'USD', fxRateLocked: 34, sourceRef: 'factory-costs.json', sourceSha256: HASH,
  lines: [
    { sku: P.box.code, minQty: 1, unitCostForeign: 1.25, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
    { sku: P.box.code, minQty: 100, unitCostForeign: 1.1, unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 },
  ],
  ...over,
})
const preview = (body = envelope(), who = 'owner', key = idem('preview')) => h.run(as(who), 'procurement.cost-sheet.preview', { idempotencyKey: key, body })
const commit = (body, who = 'owner', key = idem('commit')) => h.run(as(who), 'procurement.cost-sheet.commit', { idempotencyKey: key, body: { businessId: BIZ, ...body } })
const confirmBox = [{ sourceSku: P.box.code, productId: P.box.id, confirmed: true }]
const carton = (id) => h.store.read((sql) => ({ ...sql.get('SELECT unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays, version FROM Product WHERE id = ?', id) }))
const lineCount = (sheetId) => h.store.read((sql) => sql.get('SELECT COUNT(*) AS n FROM SupplierCostLine WHERE sheetId = ?', sheetId).n)
const EMPTY_CARTON = { unitsPerCarton: null, cartonCbm: null, cartonKg: null, freightGoodsType: null, leadTimeDays: null, version: 1 }

describe('[legacy] TASK-ZAI-053 supplier cost sheets', () => {
  test('previews without lines, requires person-confirmed mapping, and replays by source hash', async () => {
    const first = await preview()
    assert.equal(first.replayed, false)
    const s = first.sheet
    assert.deepEqual([s.businessId, s.supplierId, s.currency, s.fxRateLocked, s.sourceSha256, s.status, s.lineCount, s.version], [BIZ, supplier.id, 'USD', 34, HASH, 'DRAFT', 2, 1])
    assert.deepEqual([s.preview.lines[0].mapping.productId, s.preview.lines[0].mapping.confidence], [P.box.id, 'EXACT_PRODUCT_CODE'])
    assert.match(s.code, /^SCS-[0-9A-F]{16}$/)
    assert.deepEqual(s.supplier, { id: supplier.id, code: 'SUP-COST-053', name: 'Factory Cost Supplier' })
    assert.equal(await lineCount(s.id), 0)
    await rejects(commit({ sheetId: s.id, previewHash: s.preview.hash }), { status: 422, code: 'PROCUREMENT_COST_SHEET_MAPPING_UNCONFIRMED' })
    assert.equal(await lineCount(s.id), 0)
    // A new key, the same source: the legacy source-hash replay.
    const again = await preview()
    assert.deepEqual([again.replayed, again.sheet.id, again.sheet.preview.hash], [true, s.id, s.preview.hash])
  })

  test('keeps Procurement buyer and Inventory writer authorities separate, then commits the confirmed version atomically', async () => {
    const { sheet } = await preview()
    const before = await h.snapshot()
    await rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox }, 'buyer'), { status: 404 })
    assert.equal(await lineCount(sheet.id), 0)
    assert.deepEqual(await carton(P.box.id), EMPTY_CARTON)
    assert.deepEqual(await h.snapshot(), before)

    const committed = await commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox })
    assert.equal(committed.replayed, false)
    assert.deepEqual([committed.sheet.status, committed.sheet.version, committed.sheet.lineCount, committed.sheet.confirmedByPersonId], ['CONFIRMED', 2, 2, 'per-owner'])
    assert.deepEqual(committed.sheet.lines.map((l) => l.unitCostBaht), [42.5, 37.4])
    assert.deepEqual(committed.sheet.lines.map((l) => [l.minQty, l.unitCostSatang, l.mappingConfidence, l.mappingConfirmedByPersonId]), [[1, 4250, 'EXACT_PRODUCT_CODE', 'per-owner'], [100, 3740, 'EXACT_PRODUCT_CODE', 'per-owner']])
    assert.equal(await lineCount(sheet.id), 2)
    assert.deepEqual(await carton(P.box.id), { unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14, version: 2 })
    assert.deepEqual(await carton(P.missing.id), EMPTY_CARTON)
    const audits = await h.store.read((sql) => sql.all('SELECT entityType, action FROM ScmAuditEvent ORDER BY rowid').map((a) => `${a.entityType}:${a.action}`))
    assert.deepEqual(audits.slice(-3), ['SUPPLIER_COST_SHEET:SUPPLIER_COST_SHEET_PREVIEWED', 'PRODUCT:PRODUCT_CARTON_ATTRIBUTES_SET', 'SUPPLIER_COST_SHEET:SUPPLIER_COST_SHEET_COMMITTED'])

    const replay = await commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox })
    assert.deepEqual([replay.replayed, replay.sheet.status, replay.sheet.version], [true, 'CONFIRMED', 2])
    assert.equal(await lineCount(sheet.id), 2)
  })

  test('refuses a changed payload under a reused file hash', async () => {
    await preview()
    const changed = envelope()
    changed.lines[0].unitCostForeign = 1.3
    await rejects(preview(changed), { status: 409, code: 'PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED' })
  })
})

describe('SCM additions', () => {
  test('authority: buyer or owner previews; view-only, inventory-only and no-domain are 404; a buyer with Inventory write commits', async () => {
    for (const who of ['viewer', 'inventoryOnly', 'noProcurementDomain']) await rejects(preview(envelope(), who), { status: 404 })
    const { sheet } = await preview(envelope(), 'buyer')
    const done = await commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox }, 'buyerWithInventory')
    assert.equal(done.sheet.status, 'CONFIRMED')
    assert.equal((await h.bus.queries.costSheet(as('viewer'), sheet.id)).sheet.lines.length, 2)
    await rejects(h.bus.queries.costSheet(as('noProcurementDomain'), sheet.id), { status: 404 })
    await rejects(h.bus.queries.costSheets(as('noProcurementDomain'), { businessId: BIZ }), { status: 404 })
    const listed = await h.bus.queries.costSheets(as('viewer'), { businessId: BIZ })
    assert.deepEqual(listed.sheets.map((s) => [s.id, s.preview, s.lines.length]), [[sheet.id, null, 0]])
  })

  test('supplier must be this Business\'s and not archived', async () => {
    await rejects(preview(envelope({ supplierId: 'no-such-supplier' })), { status: 422, code: 'SUPPLIER_NOT_FOUND' })
    await h.store.transaction((sql) => sql.run("UPDATE Supplier SET status = 'ARCHIVED' WHERE id = ?", supplier.id))
    await rejects(preview(envelope({ sourceSha256: 'b'.repeat(64) })), { status: 409, code: 'SUPPLIER_ARCHIVED' })
  })

  test('commit refusals leave nothing: stale hash, duplicate/foreign/archived mapping, carton conflict', async () => {
    const lines = [
      { sku: P.box.code, minQty: 1, unitCostForeign: 1, unitsPerCarton: 24 },
      { sku: '8850000000017', minQty: 1, unitCostForeign: 2, unitsPerCarton: 12 },
    ]
    const { sheet } = await preview(envelope({ lines, sourceSha256: 'c'.repeat(64) }))
    assert.deepEqual(sheet.preview.lines.map((l) => l.mapping.confidence), ['EXACT_PRODUCT_CODE', 'EXACT_IDENTIFIER'])
    const both = [{ sourceSku: P.box.code, productId: P.box.id, confirmed: true }, { sourceSku: '8850000000017', productId: P.cup.id, confirmed: true }]
    const before = await h.snapshot()
    await rejects(commit({ sheetId: sheet.id, previewHash: 'f'.repeat(64), mappings: both }), { status: 409, code: 'PROCUREMENT_COST_SHEET_PREVIEW_STALE' })
    await rejects(commit({ sheetId: sheet.id, mappings: both }), { status: 409, code: 'PROCUREMENT_COST_SHEET_PREVIEW_STALE' })
    await rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: [...both, both[0]] }), { status: 422, code: 'PROCUREMENT_COST_SHEET_MAPPING_DUPLICATE' })
    await rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: [both[0], { ...both[1], productId: P.foreign.id }] }), { status: 422, code: 'PRODUCT_NOT_FOUND' })
    await rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: [both[0], { ...both[1], productId: P.archived.id }] }), { status: 409, code: 'PRODUCT_ARCHIVED' })
    // Two source SKUs mapped to ONE product with different carton facts.
    const conflict = await rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: [both[0], { ...both[1], productId: P.box.id }] }), { status: 422, code: 'PROCUREMENT_COST_SHEET_CARTON_CONFLICT' })
    assert.deepEqual(conflict.details, [{ productId: P.box.id, field: 'unitsPerCarton', first: 24, next: 12 }])
    assert.deepEqual(await h.snapshot(), before)
    assert.deepEqual([await carton(P.box.id), await carton(P.cup.id)], [EMPTY_CARTON, EMPTY_CARTON])
    // Commit by source hash instead of id.
    const done = await commit({ sourceSha256: 'c'.repeat(64), previewHash: sheet.preview.hash, mappings: both })
    assert.deepEqual([done.sheet.id, done.sheet.status], [sheet.id, 'CONFIRMED'])
    await rejects(commit({ sheetId: sheet.id, previewHash: 'f'.repeat(64), mappings: both }), { status: 409, code: 'PROCUREMENT_COST_SHEET_PREVIEW_STALE' })
    await rejects(commit({ sheetId: 'no-such-sheet', previewHash: sheet.preview.hash, mappings: both }), { status: 404 })
  })

  test('a newer confirmed sheet supersedes the supplier\'s previous one; a superseded sheet cannot be committed', async () => {
    const a = (await preview(envelope({ sourceSha256: 'd'.repeat(64) }))).sheet
    const b = (await preview(envelope({ sourceSha256: 'e'.repeat(64), lines: [{ sku: P.box.code, minQty: 1, unitCostForeign: 1.5 }] }))).sheet
    const c = (await preview(envelope({ sourceSha256: '9'.repeat(64), lines: [{ sku: P.box.code, minQty: 1, unitCostForeign: 1.6 }] }))).sheet
    await commit({ sheetId: a.id, previewHash: a.preview.hash, mappings: confirmBox })
    await commit({ sheetId: b.id, previewHash: b.preview.hash, mappings: confirmBox })
    const statuses = await h.store.read((sql) => Object.fromEntries(sql.all('SELECT id, status, version, supersededAt FROM SupplierCostSheet').map((r) => [r.id, [r.status, r.version, Boolean(r.supersededAt)]])))
    assert.deepEqual([statuses[a.id], statuses[b.id], statuses[c.id]], [['SUPERSEDED', 3, true], ['CONFIRMED', 2, false], ['DRAFT', 1, false]])
    await rejects(commit({ sheetId: a.id, previewHash: a.preview.hash, mappings: confirmBox }), { status: 409, code: 'PROCUREMENT_COST_SHEET_SUPERSEDED' })
    // Only CONFIRMED sheets are listed with that status filter.
    assert.deepEqual((await h.bus.queries.costSheets(as('owner'), { businessId: BIZ, status: 'CONFIRMED' })).sheets.map((s) => s.id), [b.id])
  })

  test('the store keeps one CONFIRMED sheet per supplier, an immutable source and immutable lines', async () => {
    const a = (await preview(envelope({ sourceSha256: 'd'.repeat(64) }))).sheet
    const b = (await preview(envelope({ sourceSha256: 'e'.repeat(64) }))).sheet
    await commit({ sheetId: a.id, previewHash: a.preview.hash, mappings: confirmBox })
    for (const [statement, args, pattern] of [
      ["UPDATE SupplierCostSheet SET status = 'CONFIRMED' WHERE id = ?", [b.id], /UNIQUE|unique constraint/],
      ['UPDATE SupplierCostSheet SET fxRateLocked = 35 WHERE id = ?', [a.id], /PROCUREMENT_COST_SHEET_SOURCE_IMMUTABLE/],
      ['UPDATE SupplierCostSheet SET previewJson = ? WHERE id = ?', ['{}', b.id], /PROCUREMENT_COST_SHEET_SOURCE_IMMUTABLE/],
      ['UPDATE SupplierCostLine SET unitCostForeign = 0.01 WHERE sheetId = ?', [a.id], /PROCUREMENT_COST_LINE_IMMUTABLE/],
    ]) {
      await assert.rejects(h.store.transaction((sql) => sql.run(statement, ...args)), pattern, statement)
    }
  })

  test('a fault after the carton write, after the lines or after the audit leaves nothing; the same key then commits once', async () => {
    for (const point of ['afterCartonAttributes', 'afterLines', 'afterAudit']) {
      await h.close()
      let fail = true
      h = createHarness({ products: Object.values(P), faults: { 'procurement.cost-sheet.commit': { [point]: () => { if (fail) throw new Error(`crash ${point}`) } } } })
      supplier = (await h.run(as('owner'), 'procurement.supplier.create', { body: { businessId: BIZ, code: 'SUP-COST-053', name: 'Factory Cost Supplier' } })).supplier
      const { sheet } = await preview()
      const before = await h.snapshot()
      const key = idem('crash')
      await assert.rejects(commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox }, 'owner', key), new RegExp(`crash ${point}`))
      assert.deepEqual(await h.snapshot(), before, point)
      assert.deepEqual(await carton(P.box.id), EMPTY_CARTON, point)
      assert.equal(await lineCount(sheet.id), 0, point)
      fail = false
      const done = await commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox }, 'owner', key)
      assert.deepEqual([done.replayed, done.sheet.status, await lineCount(sheet.id)], [false, 'CONFIRMED', 2], point)
      const again = await commit({ sheetId: sheet.id, previewHash: sheet.preview.hash, mappings: confirmBox }, 'owner', key)
      assert.equal(again.operation.id, done.operation.id, point)
    }
  })
})
