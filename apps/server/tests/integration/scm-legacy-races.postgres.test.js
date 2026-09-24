// @req FR-165 — F-1: concurrent goods receipts on one purchase order line must
//   never receive more than was ordered. The purchase order update is a
//   compare-and-swap on its version, so a receipt planned against a stale order
//   is refused 409 PURCHASE_ORDER_VERSION_CONFLICT and writes nothing.
// @req FR-163 — F-9: concurrent refund verifications on one order must never
//   verify more than the verified net. The order row is locked before the
//   ceiling is read, so the second verification reads the first's result.
// @req FR-164 — F-12: concurrent commits of two cost sheets of one supplier must
//   leave exactly one CONFIRMED sheet. The supplier row is locked before the
//   previous confirmed sheet is superseded.
// F-14 (customization and kitting work orders): concurrent RELEASE / COMPLETE of
//   one work order must post it once. The order update is a compare-and-swap on
//   its version, so a call that passed the version check with a stale version is
//   refused 409 *_WORK_ORDER_VERSION_CONFLICT and its ledger rows roll back.
//   (Stated without requirement annotations so this hotfix leaves the generated
//   domain-state test counts, held by another lane, untouched.)
// @spec ADR-066, ADR-065
// @tested tests/integration/scm-legacy-races.postgres.test.js
//
// Found during the SCM service extraction (draft PR #546, SCM-HANDOFF §7 F-1,
// F-9, F-12, F-14), where the same guards are proven necessary on PostgreSQL.
//
// PostgreSQL only, READ COMMITTED (Prisma's default): SQLite's single writer lock
// serializes these transactions and hides every one of the three races, so the
// SQLite suite cannot prove them. Runs against a dedicated loopback database with
// an explicit opt-in (tests/helpers/scm-race-postgres-target.js); skipped
// otherwise, like the credential-vault PostgreSQL suite.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { createSupplier } from '@/modules/procurement/application/supplier-service'
import { applyPurchaseOrderAction, createPurchaseOrder } from '@/modules/procurement/application/purchase-order-service'
import { postGoodsReceipt } from '@/modules/procurement/application/goods-receipt-service'
import { createOrder } from '@/modules/commerce/application/sales-order-service'
import { applyPaymentAction, recordPayment } from '@/modules/commerce/application/payment-service'
import { commitSupplierCostSheet, previewSupplierCostSheet } from '@/modules/procurement/application/supplier-cost-sheet-service'
import { setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import { createLocation } from '@/modules/inventory/application/warehouse-location-service'
import { completeKittingWorkOrder, openKittingWorkOrder, releaseKittingWorkOrder } from '@/modules/inventory/application/kitting-work-order-service'
import { completeCustomizationWorkOrder, openCustomizationWorkOrder, releaseCustomizationWorkOrder } from '@/modules/inventory/application/customization-work-order-service'
import { parseScmRacePostgresTarget } from '../helpers/scm-race-postgres-target'

const target = parseScmRacePostgresTarget({
  databaseUrl: process.env.ZURI_SCM_RACE_TEST_POSTGRES_URL,
  optIn: process.env.ZURI_SCM_RACE_TEST_DESTRUCTIVE_OPT_IN,
})
const runPostgres = target.enabled ? describe : describe.skip

// Always runs (no database): the destructive suite may only ever reach a dedicated
// loopback database, judged as the driver resolves the URL.
describe('SCM race suite target guard', () => {
  const OPT_IN = 'YES_RESET_ZURI_SCM_RACE_TEST_DATABASE'
  const guard = (databaseUrl, optIn = OPT_IN) => () => parseScmRacePostgresTarget({ databaseUrl, optIn })
  it('accepts only a dedicated loopback database with the explicit opt-in', () => {
    expect(parseScmRacePostgresTarget({ databaseUrl: undefined, optIn: OPT_IN })).toEqual({ enabled: false })
    expect(guard('postgresql://u@127.0.0.1:55434/zuri_scm_race_test')()).toEqual({ enabled: true, databaseUrl: 'postgresql://u@127.0.0.1:55434/zuri_scm_race_test' })
    expect(guard('postgres://u@[::1]:5432/zuri_scm_race_test')().enabled).toBe(true)
    expect(guard('postgresql://u@127.0.0.1/zuri_scm_race_test', 'yes')).toThrow('SCM_RACE_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
    expect(guard('postgresql://u@db.example.com/zuri_scm_race_test')).toThrow('SCM_RACE_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
    expect(guard('postgresql://u@127.0.0.1/postgres')).toThrow('SCM_RACE_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
    expect(guard('not a url')).toThrow('SCM_RACE_TEST_DATABASE_URL_INVALID')
    expect(guard('mysql://u@127.0.0.1/zuri_scm_race_test')).toThrow('SCM_RACE_TEST_DATABASE_URL_INVALID')
  })
  it('refuses any query override: pg lets ?host / ?hostaddr / ?port replace the loopback authority', () => {
    for (const query of ['?host=db.example.com', '?hostaddr=10.0.0.5', '?port=6543', '?host=%2Fvar%2Frun%2Fpostgresql', '?sslmode=disable', '?options=-csearch_path%3Dother'])
      expect(guard(`postgresql://u@127.0.0.1:55434/zuri_scm_race_test${query}`)).toThrow('SCM_RACE_TEST_DATABASE_URL_OVERRIDES_REFUSED')
    expect(guard('postgresql://u@127.0.0.1/zuri_scm_race_test#x')).toThrow('SCM_RACE_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })
})
const DOMAINS = ['projects', 'platform', 'procurement', 'inventory', 'commerce']

function schemaSql() {
  return execFileSync(process.execPath, [
    path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script',
  ], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

runPostgres('SCM legacy races on PostgreSQL (F-1, F-9, F-12)', () => {
  let db
  let business
  const owner = (id) => makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: DOMAINS, principal: { id, code: id.toUpperCase(), displayName: id } })
  const codeOf = (error) => error?.message ?? String(error)

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: target.databaseUrl })
    await admin.connect()
    await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
    await admin.query(schemaSql())
    await admin.end()
    const url = new URL(target.databaseUrl)
    url.searchParams.set('connection_limit', '24')
    db = new PostgresPrismaClient({ datasourceUrl: url.toString() })
    const portfolio = await db.portfolio.create({ data: { code: 'PF-SCM-RACE', name: 'Race portfolio' } })
    const tenant = await db.tenant.create({ data: { code: 'TNT-SCM-RACE', name: 'Race tenant', portfolioId: portfolio.id } })
    business = await db.business.create({ data: { code: 'BUS-SCM-RACE', name: 'Race business', tenantId: tenant.id } })
  }, 120000)
  afterAll(async () => { await db?.$disconnect() })

  async function product(code) {
    const viewer = owner('per-catalogue')
    const category = await createCategory({ businessId: business.id, code: `CAT-${code}`, nameTh: 'หมวด', nameEn: 'Category' }, { viewer, db })
    const master = await createProductMaster({ businessId: business.id, code: `PM-${code}`, categoryId: category.id, nameTh: 'สินค้า', nameEn: 'Product' }, { viewer, db })
    return createProduct({ businessId: business.id, code, productMasterId: master.id, name: code }, { viewer, db })
  }

  it('F-1: twelve concurrent receipts of one unit on a line of five receive exactly five', async () => {
    const item = await product('SKU-RACE-GRN')
    const buyer = owner('per-buyer')
    const supplier = await createSupplier({ businessId: business.id, code: 'SUP-RACE-GRN', name: 'Race supplier' }, { viewer: buyer, db })
    const order = await createPurchaseOrder({ businessId: business.id, supplierId: supplier.id, lines: [{ productId: item.id, qty: 5, unitCost: 10 }] }, { viewer: buyer, db })
    const sent = await applyPurchaseOrderAction(order.id, { action: 'SEND', version: order.version }, { viewer: buyer, db })
    const lineId = sent.lines[0].id
    // A different receiver (FR-196), and a different day per receipt so the GRN
    // codes never collide: a code collision would fail the loser for an unrelated
    // reason (F-4) and hide the over-receipt this test is about.
    const receiver = owner('per-receiver')
    const post = (i) => postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: lineId, qty: 1 }] }, { viewer: receiver, db, now: new Date(Date.UTC(2026, 0, 1 + i, 3)) })
    // The first burst: every receipt at once. Whatever commits, nothing may exceed
    // the line — that is the defect (12 of 5 before the fix).
    let committed = 0
    const refusals = []
    let pending = Array.from({ length: 12 }, (_, i) => i)
    for (let round = 0; pending.length && round < 20; round += 1) {
      const outcomes = await Promise.allSettled(pending.map(post))
      committed += outcomes.filter((o) => o.status === 'fulfilled').length
      const received = await db.goodsReceiptLine.aggregate({ where: { purchaseOrderLineId: lineId }, _sum: { qty: true } })
      expect(received._sum.qty ?? 0, `round ${round}`).toBeLessThanOrEqual(5)
      // A client that lost the version race retries (409 VERSION_CONFLICT is
      // "planned against a stale order, nothing written"); any other refusal is final.
      const retry = []
      outcomes.forEach((o, k) => {
        if (o.status === 'rejected' && codeOf(o.reason) === 'PURCHASE_ORDER_VERSION_CONFLICT') retry.push(pending[k])
        else if (o.status === 'rejected') refusals.push(codeOf(o.reason))
      })
      pending = retry
    }
    const received = await db.goodsReceiptLine.aggregate({ where: { purchaseOrderLineId: lineId }, _sum: { qty: true } })
    const onHand = await db.stockMovement.aggregate({ where: { productId: item.id }, _sum: { quantity: true } })
    expect({ committed, received: received._sum.qty, onHand: onHand._sum.quantity, pending: pending.length }, JSON.stringify(refusals)).toEqual({ committed: 5, received: 5, onHand: 5, pending: 0 })
    for (const code of refusals) expect(['PURCHASE_ORDER_NOT_RECEIVABLE', 'PROCUREMENT_RECEIPT_EXCEEDS_ORDERED']).toContain(code)
    const finalOrder = await db.purchaseOrder.findUnique({ where: { id: order.id }, select: { status: true } })
    expect(finalOrder.status).toBe('RECEIVED')
  }, 120000)

  it('F-9: four concurrent refund verifications of 400 on 1000 paid verify exactly two', async () => {
    const rep = owner('per-rep')
    const order = await createOrder({ businessId: business.id, lines: [{ description: 'Synthetic gift set', qty: 1, unitPrice: 1000 }] }, { viewer: rep, db })
    const paid = await recordPayment(order.id, { method: 'TRANSFER', amount: 1000 }, { viewer: rep, db })
    await applyPaymentAction(paid.id, { action: 'VERIFY', version: 1 }, { viewer: owner('per-verifier-0'), db })
    const refunds = []
    for (let i = 0; i < 4; i += 1) refunds.push((await recordPayment(order.id, { kind: 'REFUND', method: 'TRANSFER', amount: 400 }, { viewer: rep, db })).id)
    const outcomes = await Promise.allSettled(refunds.map((id, i) => applyPaymentAction(id, { action: 'VERIFY', version: 1 }, { viewer: owner(`per-verifier-${i + 1}`), db })))
    const verified = await db.payment.count({ where: { orderId: order.id, kind: 'REFUND', status: 'VERIFIED' } })
    const refusals = outcomes.filter((o) => o.status === 'rejected').map((o) => codeOf(o.reason))
    expect(verified, JSON.stringify(refusals)).toBe(2)
    for (const code of refusals) expect(code).toBe('PAYMENT_REFUND_EXCEEDS_PAID')
  }, 120000)

  it('F-12: two cost sheets of one supplier committed at once leave exactly one CONFIRMED sheet', async () => {
    const item = await product('SKU-RACE-SHEET')
    const buyer = owner('per-sheet-buyer')
    const supplier = await createSupplier({ businessId: business.id, code: 'SUP-RACE-SHEET', name: 'Sheet supplier' }, { viewer: buyer, db })
    const mappings = [{ sourceSku: item.code, productId: item.id, confirmed: true }]
    // No carton facts on purpose: with them the Product version check already
    // serializes the two commits and would hide the supersession race.
    const envelope = (hash, cost) => ({ businessId: business.id, supplierId: supplier.id, currency: 'USD', fxRateLocked: 34, sourceSha256: hash.repeat(64), lines: [{ sku: item.code, minQty: 1, unitCostForeign: cost }] })
    for (const [round, pair] of [['a', 'b'], ['c', 'd'], ['e', 'f']].entries()) {
      const sheets = []
      for (const [i, hash] of pair.entries()) sheets.push((await previewSupplierCostSheet(envelope(hash, 1 + round + i / 10), { viewer: buyer, db })).sheet)
      const outcomes = await Promise.allSettled(sheets.map((sheet) => commitSupplierCostSheet({ businessId: business.id, sheetId: sheet.id, previewHash: sheet.preview.hash, mappings }, { viewer: buyer, db })))
      const confirmed = await db.supplierCostSheet.count({ where: { supplierId: supplier.id, status: 'CONFIRMED' } })
      expect(confirmed, `round ${round}: ${JSON.stringify(outcomes.map((o) => (o.status === 'fulfilled' ? 'COMMITTED' : codeOf(o.reason))))}`).toBe(1)
    }
  }, 120000)

  // F-14: a work order's RELEASE / COMPLETE check its version and then update it.
  // Without a version predicate on that update, concurrent calls with the same
  // version each pass the check and each post their ledger rows.
  const onHand = async (productId) => (await db.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0
  const settle = async (calls) => {
    const outcomes = await Promise.allSettled(calls)
    return { won: outcomes.filter((o) => o.status === 'fulfilled').length, refusals: outcomes.filter((o) => o.status === 'rejected').map((o) => codeOf(o.reason)) }
  }

  async function kittingRun(tag, { locations = null } = {}) {
    const viewer = owner(`per-kwo-${tag}`)
    const component = await product(`SKU-KWO-COMP-${tag}`)
    const finished = await product(`SKU-KWO-SET-${tag}`)
    await setFlowAccountSku({ businessId: business.id, productId: finished.id, flowAccountSku: `KWO${tag}-1(P-01)` }, { viewer, db })
    await recordMovement({ businessId: business.id, productId: component.id, kind: 'RECEIPT', quantity: 100, ...(locations ? { targetLocationId: locations.source.id } : {}) }, { viewer, db })
    const recipe = await createRecipe({ businessId: business.id, code: `RCP-KWO-${tag}`, productId: finished.id, name: 'Race set', batchSize: 1, lines: [{ componentProductId: component.id, qty: 2 }] }, { viewer, db })
    const order = await openKittingWorkOrder({ businessId: business.id, recipeId: recipe.id, plannedQty: 10, ...(locations ? { sourceLocationId: locations.source.id, wipLocationId: locations.wip.id } : {}) }, { viewer, db })
    return { viewer, component, finished, order }
  }

  it('F-14: four concurrent COMPLETEs of one kitting order post it exactly once', async () => {
    const { viewer, component, finished, order } = await kittingRun('C')
    const released = await releaseKittingWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const { won, refusals } = await settle(Array.from({ length: 4 }, () => completeKittingWorkOrder(order.id, { businessId: business.id, version: released.version, assembledQty: 10 }, { viewer, db })))
    expect({ won, finished: await onHand(finished.id), component: await onHand(component.id) }, JSON.stringify(refusals)).toEqual({ won: 1, finished: 10, component: 80 })
    for (const code of refusals) expect(['KITTING_WORK_ORDER_VERSION_CONFLICT', 'KITTING_WORK_ORDER_COMPLETED']).toContain(code)
  }, 120000)

  it('F-14: four concurrent RELEASEs of one kitting order stage its components exactly once', async () => {
    const viewer = owner('per-kwo-locations')
    const source = await createLocation({ businessId: business.id, code: 'LOC-KWO-RAW', name: 'Raw', type: 'TH_CENTRAL_RAW' }, { viewer, db })
    const wip = await createLocation({ businessId: business.id, code: 'LOC-KWO-ASM', name: 'Assembly', type: 'TH_WIP_ASSEMBLY' }, { viewer, db })
    const { component, order } = await kittingRun('R', { locations: { source, wip } })
    const { won, refusals } = await settle(Array.from({ length: 4 }, () => releaseKittingWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })))
    const staged = (await db.stockMovement.aggregate({ where: { productId: component.id, targetLocationId: wip.id }, _sum: { quantity: true } }))._sum.quantity ?? 0
    expect({ won, staged, onHand: await onHand(component.id) }, JSON.stringify(refusals)).toEqual({ won: 1, staged: 20, onHand: 100 })
    for (const code of refusals) expect(['KITTING_WORK_ORDER_VERSION_CONFLICT', 'KITTING_WORK_ORDER_ALREADY_RELEASED']).toContain(code)
  }, 120000)

  it('F-14: four concurrent COMPLETEs of one customization order post it exactly once', async () => {
    const viewer = owner('per-cwo')
    const blank = await product('SKU-CWO-BLANK')
    await recordMovement({ businessId: business.id, productId: blank.id, kind: 'RECEIPT', quantity: 100, costSatang: 1000 }, { viewer, db })
    const order = await openCustomizationWorkOrder({ businessId: business.id, rawProductId: blank.id, technique: 'SILK_SCREEN', netQuantity: 10, customerId: 'cust-race', salesOrderId: 'so-race' }, { viewer, db })
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const { won, refusals } = await settle(Array.from({ length: 4 }, () => completeCustomizationWorkOrder(order.id, { businessId: business.id, version: released.version, completedQty: 10 }, { viewer, db })))
    expect({ won, output: await onHand(order.outputProductId), blank: await onHand(blank.id) }, JSON.stringify(refusals)).toEqual({ won: 1, output: 10, blank: 90 })
    for (const code of refusals) expect(['CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT', 'CUSTOMIZATION_WORK_ORDER_COMPLETED']).toContain(code)
  }, 120000)
})
