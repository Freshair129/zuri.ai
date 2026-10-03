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
// F-14 (customization and kitting work orders): concurrent RELEASE / COMPLETE /
//   CANCEL of one work order must post it once. The order update is a
//   compare-and-swap on its version, so a call that passed the version check with
//   a stale version is refused 409 *_WORK_ORDER_VERSION_CONFLICT and its ledger
//   rows roll back.
// F-16 (stock reservations): concurrent holds on one product must never promise
//   more than is on hand. A hold takes the per-Business ledger fence before it
//   reads on-hand and the live holds, so holds serialize with each other and
//   with stock movements; the loser reads the winner's hold and is refused 409
//   STOCK_RESERVATION_INSUFFICIENT_ATP.
// F-17 (stock reservations): concurrent CONVERTs of one quote hold must commit
//   exactly one ORDER hold. The hold update is a compare-and-swap on its version
//   and ACTIVE status, so a call that passed the version check with a stale
//   version is refused 409 STOCK_RESERVATION_VERSION_CONFLICT and its ORDER hold
//   rolls back.
// F-18 (supplier cost sheets): two concurrent commits of the SAME draft sheet
//   must confirm it once and answer the loser with the replay, exactly as a
//   commit that arrives after the first one does. The sheet status is decided
//   after the supplier row lock, on a re-read of the sheet, so the loser sees
//   the winner's CONFIRMED sheet instead of acting on its stale DRAFT read and
//   answering 409.
//   The F-14, F-17 and F-18 races are made deterministic with an in-test barrier
//   that holds each transaction after its first read of the row under test until
//   both have read it. (F-14, F-16, F-17 and F-18 are stated without requirement
//   annotations so these hotfixes leave the generated domain-state test counts,
//   held by another lane, untouched.)
// @spec ADR-066, ADR-065
// @tested tests/integration/scm-legacy-races.postgres.test.js
//
// Found during the SCM service extraction (draft PR #546, SCM-HANDOFF §7 F-1,
// F-9, F-12, F-14, F-16, F-17, F-18), where the same guards are proven necessary on
// PostgreSQL.
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
import { cancelKittingWorkOrder, completeKittingWorkOrder, openKittingWorkOrder, releaseKittingWorkOrder } from '@/modules/inventory/application/kitting-work-order-service'
import { cancelCustomizationWorkOrder, completeCustomizationWorkOrder, openCustomizationWorkOrder, releaseCustomizationWorkOrder } from '@/modules/inventory/application/customization-work-order-service'
import { applyReservationAction, createReservation } from '@/modules/inventory/application/inventory-atp-service'
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

  // F-14: a work order's RELEASE / COMPLETE / CANCEL check its version and then
  // update it. Each race below is DETERMINISTIC: both calls run through a client
  // whose transaction pauses right after its first read of the order until BOTH
  // transactions have read it — so both hold the same version before either
  // writes. Then exactly one may commit; the other must be refused with the
  // version conflict (never the post-commit status code, which would mean it read
  // after the winner) and must leave no ledger row and no audit row behind.
  const onHand = async (productId) => (await db.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0
  const atLocation = async (productId, locationId) => {
    const into = (await db.stockMovement.aggregate({ where: { productId, targetLocationId: locationId }, _sum: { quantity: true } }))._sum.quantity ?? 0
    const out = (await db.stockMovement.aggregate({ where: { productId, sourceLocationId: locationId }, _sum: { quantity: true } }))._sum.quantity ?? 0
    return into + out
  }
  const audits = (entityId, action) => db.auditEvent.count({ where: { entityId, action } })

  function barrier(parties, timeoutMs = 15000) {
    let arrived = 0
    let open
    const opened = new Promise((resolve) => { open = resolve })
    return {
      get arrived() { return arrived },
      async arrive() {
        arrived += 1
        if (arrived === parties) open()
        let timer
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`BARRIER_TIMEOUT: ${arrived}/${parties} read the order`)), timeoutMs) })
        try { await Promise.race([opened, timeout]) } finally { clearTimeout(timer) }
      },
    }
  }

  /** A client whose interactive transactions pause after their FIRST read of `model` until every racer has read it. */
  function gatedClient(model, gate) {
    const gatedTx = (tx) => {
      let paused = false
      const delegate = new Proxy(tx[model], {
        get(target, prop) {
          const value = target[prop]
          if (prop !== 'findUnique') return typeof value === 'function' ? value.bind(target) : value
          return async (...args) => {
            const row = await value.apply(target, args)
            if (!paused) { paused = true; await gate.arrive() }
            return row
          }
        },
      })
      return new Proxy(tx, { get: (target, prop) => (prop === model ? delegate : (typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop])) })
    }
    return { $transaction: (fn, options) => db.$transaction((tx) => fn(gatedTx(tx)), options) }
  }

  /** Two calls that both read the order at the same version before either writes. */
  async function race(model, call) {
    const gate = barrier(2)
    const client = gatedClient(model, gate)
    const outcomes = await Promise.allSettled([call(client, 0), call(client, 1)])
    return { reached: gate.arrived, won: outcomes.filter((o) => o.status === 'fulfilled').length, refusals: outcomes.filter((o) => o.status === 'rejected').map((o) => codeOf(o.reason)) }
  }

  async function locations(tag) {
    const viewer = owner(`per-loc-${tag}`)
    const source = await createLocation({ businessId: business.id, code: `LOC-${tag}-RAW`, name: 'Raw', type: 'TH_CENTRAL_RAW' }, { viewer, db })
    const wip = await createLocation({ businessId: business.id, code: `LOC-${tag}-WIP`, name: 'Workshop', type: 'TH_WIP_ASSEMBLY' }, { viewer, db })
    return { source, wip }
  }

  async function kittingRun(tag, { locations: at = null } = {}) {
    const viewer = owner(`per-kwo-${tag}`)
    const component = await product(`SKU-KWO-COMP-${tag}`)
    const finished = await product(`SKU-KWO-SET-${tag}`)
    await setFlowAccountSku({ businessId: business.id, productId: finished.id, flowAccountSku: `KWO${tag}-1(P-01)` }, { viewer, db })
    await recordMovement({ businessId: business.id, productId: component.id, kind: 'RECEIPT', quantity: 100, ...(at ? { targetLocationId: at.source.id } : {}) }, { viewer, db })
    const recipe = await createRecipe({ businessId: business.id, code: `RCP-KWO-${tag}`, productId: finished.id, name: 'Race set', batchSize: 1, lines: [{ componentProductId: component.id, qty: 2 }] }, { viewer, db })
    const order = await openKittingWorkOrder({ businessId: business.id, recipeId: recipe.id, plannedQty: 10, ...(at ? { sourceLocationId: at.source.id, wipLocationId: at.wip.id } : {}) }, { viewer, db })
    return { viewer, component, finished, order }
  }

  async function customizationRun(tag, { locations: at = null } = {}) {
    const viewer = owner(`per-cwo-${tag}`)
    const blank = await product(`SKU-CWO-BLANK-${tag}`)
    await recordMovement({ businessId: business.id, productId: blank.id, kind: 'RECEIPT', quantity: 100, costSatang: 1000, ...(at ? { targetLocationId: at.source.id } : {}) }, { viewer, db })
    const order = await openCustomizationWorkOrder({ businessId: business.id, rawProductId: blank.id, technique: 'SILK_SCREEN', netQuantity: 10, customerId: 'cust-race', salesOrderId: `so-race-${tag}`, ...(at ? { sourceLocationId: at.source.id, wipLocationId: at.wip.id } : {}) }, { viewer, db })
    return { viewer, blank, order }
  }

  it('F-14: two kitting COMPLETEs that read the same version post the order exactly once', async () => {
    const { viewer, component, finished, order } = await kittingRun('KC')
    const released = await releaseKittingWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const result = await race('kittingWorkOrder', (client) => completeKittingWorkOrder(order.id, { businessId: business.id, version: released.version, assembledQty: 10 }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['KITTING_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ finished: await onHand(finished.id), component: await onHand(component.id), completed: await audits(order.id, 'KITTING_WORK_ORDER_COMPLETED') }).toEqual({ finished: 10, component: 80, completed: 1 })
    expect(await db.stockMovement.count({ where: { workOrderId: order.id } })).toBe(2)
  }, 120000)

  it('F-14: two kitting RELEASEs that read the same version stage the components exactly once', async () => {
    const at = await locations('KR')
    const { viewer, component, order } = await kittingRun('KR', { locations: at })
    const result = await race('kittingWorkOrder', (client) => releaseKittingWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['KITTING_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ staged: await atLocation(component.id, at.wip.id), onHand: await onHand(component.id), released: await audits(order.id, 'KITTING_WORK_ORDER_RELEASED') }).toEqual({ staged: 20, onHand: 100, released: 1 })
  }, 120000)

  it('F-14: two kitting CANCELs that read the same version return the staged components exactly once', async () => {
    const at = await locations('KX')
    const { viewer, component, order } = await kittingRun('KX', { locations: at })
    const released = await releaseKittingWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const result = await race('kittingWorkOrder', (client) => cancelKittingWorkOrder(order.id, { businessId: business.id, version: released.version }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['KITTING_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ wip: await atLocation(component.id, at.wip.id), source: await atLocation(component.id, at.source.id), cancelled: await audits(order.id, 'KITTING_WORK_ORDER_CANCELLED') }).toEqual({ wip: 0, source: 100, cancelled: 1 })
  }, 120000)

  it('F-14: two customization RELEASEs that read the same version move the gross issue exactly once', async () => {
    const at = await locations('CR')
    const { viewer, blank, order } = await customizationRun('CR', { locations: at })
    const result = await race('customizationWorkOrder', (client) => releaseCustomizationWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ workshop: await atLocation(blank.id, at.wip.id), onHand: await onHand(blank.id), released: await audits(order.id, 'CUSTOMIZATION_WORK_ORDER_RELEASED') }).toEqual({ workshop: 11, onHand: 100, released: 1 })
  }, 120000)

  it('F-14: two customization COMPLETEs that read the same version post the order exactly once', async () => {
    const { viewer, blank, order } = await customizationRun('CC')
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const result = await race('customizationWorkOrder', (client) => completeCustomizationWorkOrder(order.id, { businessId: business.id, version: released.version, completedQty: 10 }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ output: await onHand(order.outputProductId), blank: await onHand(blank.id), completed: await audits(order.id, 'CUSTOMIZATION_WORK_ORDER_COMPLETED') }).toEqual({ output: 10, blank: 90, completed: 1 })
    expect(await db.stockMovement.count({ where: { workOrderId: order.id } })).toBe(2)
  }, 120000)

  it('F-14: two customization CANCELs that read the same version return the unworked blanks exactly once', async () => {
    const at = await locations('CX')
    const { viewer, blank, order } = await customizationRun('CX', { locations: at })
    const released = await releaseCustomizationWorkOrder(order.id, { businessId: business.id, version: order.version }, { viewer, db })
    const result = await race('customizationWorkOrder', (client) => cancelCustomizationWorkOrder(order.id, { businessId: business.id, version: released.version }, { viewer, db: client }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT'] })
    expect({ workshop: await atLocation(blank.id, at.wip.id), source: await atLocation(blank.id, at.source.id), cancelled: await audits(order.id, 'CUSTOMIZATION_WORK_ORDER_CANCELLED') }).toEqual({ workshop: 0, source: 100, cancelled: 1 })
  }, 120000)

  // F-16: a hold reads on-hand and the live holds, then inserts. Both holds pause
  // after their product read — before the per-Business ledger fence — until both
  // have read it; with the fence the second then waits for the first to commit
  // and reads its hold. Each racer uses its own day so the day-keyed RSV codes
  // never collide (a collision would refuse the loser for an unrelated reason),
  // and a 30-day hold keeps both live.
  it('F-16: two holds of six on ten on hand that race past the product read promise at most ten', async () => {
    const viewer = owner('per-rsv-hold')
    const item = await product('SKU-RSV-HOLD')
    await recordMovement({ businessId: business.id, productId: item.id, kind: 'RECEIPT', quantity: 10 }, { viewer, db })
    const result = await race('product', (client, i) => createReservation({ businessId: business.id, productId: item.id, quantity: 6, purpose: 'QUOTE', holdDays: 30, quoteReference: `Q-RACE-${i}` }, { viewer, db: client, now: new Date(Date.UTC(2026, 1, 1 + i, 3)) }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['STOCK_RESERVATION_INSUFFICIENT_ATP'] })
    const held = (await db.stockReservation.aggregate({ where: { productId: item.id, status: 'ACTIVE' }, _sum: { quantity: true } }))._sum.quantity ?? 0
    const holds = await db.stockReservation.findMany({ where: { productId: item.id }, select: { id: true } })
    // The loser left no hold and no audit record: exactly one CREATED audit, and it names the one hold that exists.
    const created = await db.auditEvent.findMany({ where: { action: 'STOCK_RESERVATION_CREATED', payloadJson: { contains: item.id } }, select: { entityId: true } })
    expect({ held, holds: holds.map((h) => h.id), created: created.map((a) => a.entityId) }).toEqual({ held: 6, holds: [holds[0].id], created: [holds[0].id] })
  }, 120000)

  // F-17: RELEASE / CONVERT check the hold's version and then update it. Both
  // CONVERTs pause after their first read of the hold until both have read it,
  // so both hold the same version; exactly one may commit its ORDER hold, and the
  // other must be refused with the version conflict and leave no hold or audit.
  it('F-17: two CONVERTs that read the same version commit exactly one ORDER hold', async () => {
    const viewer = owner('per-rsv-convert')
    const item = await product('SKU-RSV-CONVERT')
    await recordMovement({ businessId: business.id, productId: item.id, kind: 'RECEIPT', quantity: 10 }, { viewer, db })
    const quote = await createReservation({ businessId: business.id, productId: item.id, quantity: 4, purpose: 'QUOTE' }, { viewer, db })
    const result = await race('stockReservation', (client, i) => applyReservationAction(quote.id, { businessId: business.id, action: 'CONVERT', version: quote.version, salesOrderId: 'so-rsv-race' }, { viewer, db: client, now: new Date(Date.UTC(2026, 2, 1 + i, 3)) }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['STOCK_RESERVATION_VERSION_CONFLICT'] })
    const orders = await db.stockReservation.count({ where: { productId: item.id, purpose: 'ORDER', salesOrderId: 'so-rsv-race' } })
    const quoteAfter = await db.stockReservation.findUnique({ where: { id: quote.id }, select: { status: true, version: true } })
    expect({ orders, quoteAfter, converted: await audits(quote.id, 'STOCK_RESERVATION_CONVERTED') }).toEqual({ orders: 1, quoteAfter: { status: 'CONVERTED', version: quote.version + 1 }, converted: 1 })
  }, 120000)

  // F-17, same day: the two CONVERTs share one clock day, so they would draw the
  // same day-keyed ORDER code. The compare-and-swap runs before the code is
  // allocated, so the loser must still be refused with the version conflict —
  // never with a unique-code collision — and allocate nothing.
  it('F-17: two same-day CONVERTs that read the same version are decided by the version check, not a code collision', async () => {
    const viewer = owner('per-rsv-convert-day')
    const item = await product('SKU-RSV-CONVERT-DAY')
    await recordMovement({ businessId: business.id, productId: item.id, kind: 'RECEIPT', quantity: 10 }, { viewer, db })
    const quote = await createReservation({ businessId: business.id, productId: item.id, quantity: 4, purpose: 'QUOTE' }, { viewer, db })
    const day = new Date(Date.UTC(2026, 3, 1, 3))
    const result = await race('stockReservation', (client) => applyReservationAction(quote.id, { businessId: business.id, action: 'CONVERT', version: quote.version, salesOrderId: 'so-rsv-day' }, { viewer, db: client, now: day }))
    expect(result).toEqual({ reached: 2, won: 1, refusals: ['STOCK_RESERVATION_VERSION_CONFLICT'] })
    const orders = await db.stockReservation.count({ where: { productId: item.id, purpose: 'ORDER', salesOrderId: 'so-rsv-day' } })
    expect({ orders, converted: await audits(quote.id, 'STOCK_RESERVATION_CONVERTED') }).toEqual({ orders: 1, converted: 1 })
  }, 120000)

  // F-18: a commit reads the sheet, decides replay / refusal from its status, and
  // only then takes the supplier row lock. Both commits of ONE draft sheet pause
  // after their read of the sheet until both have read DRAFT; the loser then waits
  // on the supplier lock. It must answer the replay once the winner has confirmed
  // — never 409 (a Product carton version conflict or a sheet version conflict,
  // which would mean it acted on its stale DRAFT read) — and write nothing. The
  // line carries carton facts so the Product carton compare-and-swap is on the
  // path. The commit names the sheet by its source hash, the read the gate holds.
  it('F-18: two commits of one draft sheet that both read DRAFT confirm it once and replay the loser', async () => {
    const item = await product('SKU-RACE-SAME-SHEET')
    const buyer = owner('per-same-sheet-buyer')
    const supplier = await createSupplier({ businessId: business.id, code: 'SUP-RACE-SAME-SHEET', name: 'Same-sheet supplier' }, { viewer: buyer, db })
    const mappings = [{ sourceSku: item.code, productId: item.id, confirmed: true }]
    const sourceSha256 = '9'.repeat(64)
    const carton = { unitsPerCarton: 24, cartonCbm: 0.018, cartonKg: 4.2, freightGoodsType: 'GENERAL', leadTimeDays: 14 }
    const { sheet } = await previewSupplierCostSheet({ businessId: business.id, supplierId: supplier.id, currency: 'USD', fxRateLocked: 34, sourceSha256, lines: [{ sku: item.code, minQty: 1, unitCostForeign: 1.25, ...carton }] }, { viewer: buyer, db })
    const before = await db.product.findUnique({ where: { id: item.id }, select: { version: true } })
    const gate = barrier(2)
    const client = gatedClient('supplierCostSheet', gate)
    const outcomes = await Promise.allSettled([0, 1].map(() => commitSupplierCostSheet({ businessId: business.id, sourceSha256, previewHash: sheet.preview.hash, mappings }, { viewer: buyer, db: client })))
    const answers = outcomes.map((o) => (o.status === 'fulfilled' ? (o.value.replayed ? 'REPLAYED' : 'COMMITTED') : codeOf(o.reason))).sort()
    expect({ reached: gate.arrived, answers }).toEqual({ reached: 2, answers: ['COMMITTED', 'REPLAYED'] })
    for (const o of outcomes) expect(o.value.sheet).toMatchObject({ id: sheet.id, status: 'CONFIRMED' })
    const confirmed = await db.supplierCostSheet.findMany({ where: { supplierId: supplier.id, status: 'CONFIRMED' }, select: { id: true } })
    const lines = await db.supplierCostLine.count({ where: { sheetId: sheet.id } })
    const after = await db.product.findUnique({ where: { id: item.id }, select: { version: true, unitsPerCarton: true, cartonKg: true } })
    expect({
      confirmed: confirmed.map((s) => s.id),
      lines,
      committed: await audits(sheet.id, 'SUPPLIER_COST_SHEET_COMMITTED'),
      cartonSet: await audits(item.id, 'PRODUCT_CARTON_ATTRIBUTES_SET'),
      productVersion: after.version - before.version,
      carton: { unitsPerCarton: after.unitsPerCarton, cartonKg: after.cartonKg },
    }).toEqual({ confirmed: [sheet.id], lines: 1, committed: 1, cartonSet: 1, productVersion: 1, carton: { unitsPerCarton: 24, cartonKg: 4.2 } })
  }, 120000)
})
