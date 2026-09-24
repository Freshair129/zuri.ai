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
// @spec ADR-066, ADR-065
// @tested tests/integration/scm-legacy-races.postgres.test.js
//
// Found during the SCM service extraction (draft PR #546, SCM-HANDOFF §7 F-1,
// F-9, F-12), where the same three guards are proven necessary on PostgreSQL.
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
import { parseScmRacePostgresTarget } from '../helpers/scm-race-postgres-target'

const target = parseScmRacePostgresTarget({
  databaseUrl: process.env.ZURI_SCM_RACE_TEST_POSTGRES_URL,
  optIn: process.env.ZURI_SCM_RACE_TEST_DESTRUCTIVE_OPT_IN,
})
const runPostgres = target.enabled ? describe : describe.skip
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
})
