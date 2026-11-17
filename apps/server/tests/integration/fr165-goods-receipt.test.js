// @req FR-165, FR-175 — goods receipts against a real database: posted only against a
//   SENT order, line by line and never beyond what is outstanding; a counted
//   SKU's line lands in the Inventory ledger with the PO/GRN reference (lots
//   with expiry, serial units) and needs Inventory's authority on top of the
//   buyer's; an uncounted or free-text line touches no ledger; the order's
//   received / outstanding quantities and receipt state follow on read; the
//   receipt that completes every line makes the order RECEIVED; audit.
// @spec ADR-066; ADR-054 D3/D4; BR-002; SEC-001; FR-072; FR-155
// @tested tests/integration/fr165-goods-receipt.test.js
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import * as inventory from '@/modules/inventory'
import * as procurementDomain from '@/modules/procurement/domain/procurement'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_GOODS_RECEIVER, ROLE_INVENTORY_MANAGER, ROLE_PROCUREMENT_BUYER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster, getProduct } from '@/modules/inventory/application/inventory-catalog-service'
import { createLot, listLots, listSerialUnits, recordMovement, stockSummary } from '@/modules/inventory/application/inventory-stock-service'
import { createSupplier } from '@/modules/procurement/application/supplier-service'
import { applyPurchaseOrderAction, createPurchaseOrder, getPurchaseOrder } from '@/modules/procurement/application/purchase-order-service'
import { listGoodsReceipts, postGoodsReceipt, listAllGoodsReceipts, getGoodsReceiptDetail } from '@/modules/procurement/application/goods-receipt-service'
import { commitSupplierCostSheet, previewSupplierCostSheet } from '@/modules/procurement/application/supplier-cost-sheet-service'
import { zPostReceipt } from '@/modules/procurement/domain/procurement'

const NOW = new Date('2026-09-06T03:00:00Z')
const DOMAINS = ['projects', 'platform', 'procurement', 'inventory']
// @req FR-196/ADR-079 — PROCUREMENT_BUYER and GOODS_RECEIVER are split and
// declared conflicting (three-way match): `buyer` writes purchase orders and
// holds no receipt-post permission at all any more; `receiverOnly` posts
// receipts but touches no ledger without Inventory's own authority; `receiver`
// holds both GOODS_RECEIVER and ROLE_INVENTORY_MANAGER for the stocked lines.
let business, owner, buyer, receiverOnly, receiver, member, noDomain, supplier, box, lotted, serial, service

const b = () => business.id
const onHand = async (code) => (await stockSummary({ businessId: b(), viewer: owner })).products.find((p) => p.code === code).onHand

describe('FR-165 GoodsReceipt', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'GRN Group', code: 'PF-GRN' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'GRN Tenant', code: 'TNT-GRN' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านรับของ', code: 'BUS-GRN' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS, principal: { id: 'per-owner', code: 'PER-OWNER', displayName: 'Owner' } })
    buyer = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_PROCUREMENT_BUYER] }, principal: { id: 'per-buyer', code: 'PER-BUYER', displayName: 'Buyer' } })
    receiverOnly = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_GOODS_RECEIVER] }, principal: { id: 'per-recv-only', code: 'PER-RECV-ONLY', displayName: 'Receiver only' } })
    receiver = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS, rolesByBusinessId: { [b()]: [ROLE_GOODS_RECEIVER, ROLE_INVENTORY_MANAGER] }, principal: { id: 'per-recv', code: 'PER-RECV', displayName: 'Receiver' } })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })
    noDomain = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: ['projects'] })
    const category = await createCategory({ businessId: b(), code: 'packaging', nameTh: 'บรรจุภัณฑ์', nameEn: 'Packaging' }, { viewer: owner })
    const master = await createProductMaster({ businessId: b(), code: 'PM-GRN', categoryId: category.id, nameTh: 'กล่อง', nameEn: 'Box' }, { viewer: owner })
    box = await createProduct({ businessId: b(), code: 'BOX-GRN', productMasterId: master.id, name: 'Gift box' }, { viewer: owner })
    lotted = await createProduct({ businessId: b(), code: 'TEA-GRN', productMasterId: master.id, name: 'Tea', trackingMode: 'LOT' }, { viewer: owner })
    serial = await createProduct({ businessId: b(), code: 'GADGET-GRN', productMasterId: master.id, name: 'Gadget', trackingMode: 'SERIAL' }, { viewer: owner })
    service = await createProduct({ businessId: b(), code: 'PRINT-GRN', productMasterId: master.id, name: 'Printing', stockPolicy: 'UNTRACKED' }, { viewer: owner })
    supplier = await createSupplier({ businessId: b(), code: 'SUP-GRN', name: 'ผู้ขายกล่อง' }, { viewer: owner })
  })

  const sentOrder = async (lines, viewer = owner, currency = 'THB') => {
    const order = await createPurchaseOrder({ businessId: b(), supplierId: supplier.id, currency, lines }, { viewer, now: NOW })
    return applyPurchaseOrderAction(order.id, { action: 'SEND', version: 1 }, { viewer, now: NOW })
  }
  const lineOf = (order, description) => order.lines.find((l) => l.description === description)
  let sheetSequence = 0
  const nextSheetHash = () => (++sheetSequence).toString(16).padStart(64, '0')
  const makeCostSheet = async ({
    businessId = b(), supplierId = supplier.id, currency = 'USD', fxRateLocked = 34,
    sourceSku = box.code, productId = box.id, viewer = owner, confirm = false,
  } = {}) => {
    const preview = await previewSupplierCostSheet({
      businessId, supplierId, currency, fxRateLocked, sourceSha256: nextSheetHash(),
      lines: [{ sku: sourceSku, minQty: 1, unitCostForeign: 1.25 }],
    }, { viewer })
    if (!confirm) return preview.sheet
    const committed = await commitSupplierCostSheet({
      businessId, sheetId: preview.sheet.id, previewHash: preview.sheet.preview.hash,
      mappings: [{ sourceSku, productId, confirmed: true }],
    }, { viewer })
    return committed.sheet
  }
  const createOtherScope = async (suffix) => {
    const portfolio = await createPortfolio({ name: `Receipt Group ${suffix}`, code: `PF-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Receipt Tenant ${suffix}`, code: `TNT-${suffix}` })
    const otherBusiness = await createBusiness({ tenantId: tenant.id, name: `Receipt Business ${suffix}`, code: `BUS-${suffix}` })
    const otherOwner = makeViewer({ visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id], visibleDomains: DOMAINS, principal: { id: `per-${suffix}-owner`, code: `PER-${suffix}-OWNER`, displayName: 'Owner' } })
    const category = await createCategory({ businessId: otherBusiness.id, code: `CAT-${suffix}`, nameTh: 'ของใช้', nameEn: 'Goods' }, { viewer: otherOwner })
    const master = await createProductMaster({ businessId: otherBusiness.id, code: `PM-${suffix}`, categoryId: category.id, nameTh: 'สินค้า', nameEn: 'Goods' }, { viewer: otherOwner })
    const product = await createProduct({ businessId: otherBusiness.id, code: `SKU-${suffix}`, productMasterId: master.id, name: 'Other business stock', trackingMode: 'LOT' }, { viewer: otherOwner })
    const otherSupplier = await createSupplier({ businessId: otherBusiness.id, code: `SUP-${suffix}`, name: 'Other business supplier' }, { viewer: otherOwner })
    return { business: otherBusiness, owner: otherOwner, product, supplier: otherSupplier }
  }

  it('AC-165.1 — a receipt posts counted lines into the Inventory ledger with the PO/GRN reference, and needs Inventory authority for that half', async () => {
    const order = await sentOrder([{ productId: box.id, qty: 5, unitCost: 20 }, { productId: service.id, qty: 2, unitCost: 30 }, { description: 'ค่าขนส่ง', qty: 1, unitCost: 100 }])
    const boxLine = lineOf(order, 'Gift box')
    // @req FR-196/ADR-079 — the buyer who wrote this order holds no
    // `procurement.receipt.post` at all any more: the split refuses before the
    // stocked/uncounted question is even asked.
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 3 }] }, { viewer: buyer, now: NOW })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 3 }] }, { viewer: receiverOnly, now: NOW })).rejects.toMatchObject({ status: 403, message: 'PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY' })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0)

    // A receiver without Inventory authority may still post the lines that touch no ledger.
    const freight = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: lineOf(order, 'ค่าขนส่ง').id, qty: 1 }], supplierReference: 'DN-001' }, { viewer: receiverOnly, now: NOW })
    expect(freight.receipt).toMatchObject({ code: 'GRN-20260906-001', supplierReference: 'DN-001', postedByPersonId: 'per-recv-only' })
    expect(freight.order).toMatchObject({ status: 'SENT', receiptState: 'PARTIAL', receiptCount: 1, receivedValue: 100, outstandingValue: 160 })
    expect(freight.posted).toEqual([])

    const posted = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 3 }, { purchaseOrderLineId: lineOf(order, 'Printing').id, qty: 2 }] }, { viewer: receiver, now: NOW })
    expect(posted.receipt.code).toBe('GRN-20260906-002')
    expect(posted.posted).toEqual([{ purchaseOrderLineId: boxLine.id, productId: box.id, code: 'BOX-GRN', quantity: 3, lotId: null, onHandAfter: 3, costSatang: 2000 }])
    expect(posted.order).toMatchObject({ status: 'SENT', receiptState: 'PARTIAL', receiptCount: 2, receivedValue: 220, outstandingValue: 40 })
    expect(posted.order.lines.map((l) => [l.description, l.receivedQty, l.outstandingQty])).toEqual([['Gift box', 3, 2], ['Printing', 2, 0], ['ค่าขนส่ง', 1, 0]])
    expect(await onHand('BOX-GRN')).toBe(3)
    const movements = await prisma.stockMovement.findMany({ where: { reference: `PO:${order.code}/GRN:GRN-20260906-002` } })
    expect(movements.map((m) => [m.kind, m.quantity, m.costSatang, m.reason, m.actorId])).toEqual([['RECEIPT', 3, 2000, 'GOODS_RECEIPT', 'per-recv']])
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'GOODS_RECEIPT', entityId: posted.receipt.id } })
    expect(audit.action).toBe('GOODS_RECEIPT_POSTED')
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ code: 'GRN-20260906-002', purchaseOrderCode: order.code, lines: 2, completesOrder: false, posted: [{ code: 'BOX-GRN', quantity: 3 }] })
    // The order's version moved with the receipt, so a stale caller conflicts.
    await expect(applyPurchaseOrderAction(order.id, { action: 'CLOSE', version: 2 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_VERSION_CONFLICT' })
    await expect(applyPurchaseOrderAction(order.id, { action: 'CANCEL', version: 4 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_HAS_RECEIPTS' })
  })

  it('AC-165.2 — the refusals: not SENT, unknown line, over-receipt with the per-line list, lot data on an uncounted line, the ladder', async () => {
    const draft = await createPurchaseOrder({ businessId: b(), supplierId: supplier.id, lines: [{ productId: box.id, qty: 1, unitCost: 1 }] }, { viewer: owner, now: NOW })
    await expect(postGoodsReceipt(draft.id, { lines: [{ purchaseOrderLineId: draft.lines[0].id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_NOT_RECEIVABLE' })

    // @req FR-196 — every subsequent call here attests self-verify: `owner`
    // both wrote this order (via `sentOrder`'s default viewer) and posts
    // against it, and this test is proving the OTHER refusals in the ladder,
    // not the self-post one (that has its own dedicated test below).
    const order = await sentOrder([{ productId: box.id, qty: 4, unitCost: 20 }, { productId: service.id, qty: 1, unitCost: 30 }])
    const boxLine = lineOf(order, 'Gift box')
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: 'no-such-line', qty: 1 }], selfVerifyAttested: true }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_LINE_NOT_FOUND' })
    await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 3 }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    const error = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 2 }], selfVerifyAttested: true }, { viewer: owner, now: NOW }).catch((e) => e)
    expect(error).toMatchObject({ status: 409, message: 'PROCUREMENT_RECEIPT_EXCEEDS_ORDERED' })
    expect(error.details).toEqual([{ purchaseOrderLineId: boxLine.id, description: 'Gift box', ordered: 4, received: 3, outstanding: 1, requested: 2 }])
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: lineOf(order, 'Printing').id, qty: 1, lotCode: 'LOT-X' }], selfVerifyAttested: true }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_LINE_NOT_COUNTED' })
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 1 }, { purchaseOrderLineId: boxLine.id, qty: 1 }], selfVerifyAttested: true }, { viewer: owner })).rejects.toThrow(/once per receipt/)
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 1 }] }, { viewer: member })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: boxLine.id, qty: 1 }] }, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    await expect(postGoodsReceipt('no-such-order', { lines: [{ purchaseOrderLineId: boxLine.id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 404 })
    expect((await getPurchaseOrder(order.id, { viewer: member })).receiptState).toBe('PARTIAL')
  })

  it('AC-165.3 — the receipt that completes every line makes the order RECEIVED in the same transaction, and nothing more can be received', async () => {
    const order = await sentOrder([{ productId: box.id, qty: 2, unitCost: 20 }, { description: 'ค่าขนส่ง', qty: 1, unitCost: 50 }])
    const before = await onHand('BOX-GRN')
    const result = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: lineOf(order, 'Gift box').id, qty: 2 }, { purchaseOrderLineId: lineOf(order, 'ค่าขนส่ง').id, qty: 1 }], receivedAt: '2026-09-06T08:00:00Z' }, { viewer: receiver, now: NOW })
    expect(result.order).toMatchObject({ status: 'RECEIVED', receiptState: 'COMPLETE', outstandingValue: 0, receivedValue: 90, version: 3 })
    expect(result.order.receivedAt).toEqual(new Date('2026-09-06T08:00:00Z'))
    expect(await onHand('BOX-GRN')).toBe(before + 2)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PURCHASE_ORDER', entityId: order.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER_SENT', 'PURCHASE_ORDER_RECEIVED'])
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: lineOf(order, 'Gift box').id, qty: 1 }] }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_NOT_RECEIVABLE' })
    await expect(applyPurchaseOrderAction(order.id, { action: 'CLOSE', version: 3 }, { viewer: owner })).rejects.toMatchObject({ status: 409, message: 'PURCHASE_ORDER_STATUS_INVALID' })
  })

  it('AC-165.4 — a LOT-tracked line needs its lot and may carry the expiry; a SERIAL-tracked line names one serial per unit', async () => {
    // @req FR-196 — `owner` both writes and receives here; every call attests
    // self-verify since this test is about lot/serial validation, not SoD.
    const order = await sentOrder([{ productId: lotted.id, qty: 10, unitCost: 5 }, { productId: serial.id, qty: 2, unitCost: 900 }])
    const teaLine = lineOf(order, 'Tea')
    const gadgetLine = lineOf(order, 'Gadget')
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: teaLine.id, qty: 4 }], selfVerifyAttested: true }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_LOT_REQUIRED' })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0)
    const first = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: teaLine.id, qty: 4, lotCode: 'TEA-2026-09', expiresAt: '2027-09-01T00:00:00Z' }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    expect(first.posted[0]).toMatchObject({ code: 'TEA-GRN', quantity: 4, onHandAfter: 4 })
    expect(first.posted[0].lotId).toBeTruthy()
    expect(first.receipt.lines[0]).toMatchObject({ qty: 4, lotCode: 'TEA-2026-09', serialNos: [] })
    let lots = await listLots({ businessId: b(), productId: lotted.id, viewer: owner })
    expect(lots.map((l) => [l.code, l.receivedQty, l.expiresAt])).toEqual([['TEA-2026-09', 4, new Date('2027-09-01T00:00:00Z')]])
    expect(lots[0].version).toBe(3) // create + received quantity + first expiry
    const expiryAudit = await prisma.auditEvent.findFirst({ where: { entityType: 'PRODUCT_LOT', entityId: first.posted[0].lotId, action: 'PRODUCT_LOT_EXPIRY_SET' } })
    expect(JSON.parse(expiryAudit.payloadJson)).toMatchObject({ businessId: b(), lotCode: 'TEA-2026-09', productId: lotted.id, previous: null, version: 3 })
    // A second receipt into the same lot keeps the expiry it already has.
    await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: teaLine.id, qty: 6, lotCode: 'TEA-2026-09', expiresAt: '2030-01-01T00:00:00Z' }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    lots = await listLots({ businessId: b(), productId: lotted.id, viewer: owner })
    expect(lots.map((l) => [l.code, l.receivedQty, l.expiresAt])).toEqual([['TEA-2026-09', 10, new Date('2027-09-01T00:00:00Z')]])
    expect(lots[0].version).toBe(4) // receipt bump only; an already-set expiry is a no-op
    expect(await prisma.auditEvent.count({ where: { entityType: 'PRODUCT_LOT', entityId: first.posted[0].lotId, action: 'PRODUCT_LOT_EXPIRY_SET' } })).toBe(1)

    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: gadgetLine.id, qty: 2, serialNos: ['SN-1'] }], selfVerifyAttested: true }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_SERIAL_COUNT_MISMATCH' })
    const done = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: gadgetLine.id, qty: 2, serialNos: ['SN-1', 'SN-2'] }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    expect(done.order).toMatchObject({ status: 'RECEIVED', receiptState: 'COMPLETE' })
    expect(done.receipt.lines[0].serialNos).toEqual(['SN-1', 'SN-2'])
    const units = await listSerialUnits({ businessId: b(), productId: serial.id, viewer: owner })
    expect(units.map((u) => [u.serialNo, u.status]).sort()).toEqual([['SN-1', 'IN_STOCK'], ['SN-2', 'IN_STOCK']])
    expect(await onHand('GADGET-GRN')).toBe(2)
  })

  it('C8 — Inventory expiry contract versions and audits its one-time write', async () => {
    const lot = await createLot({ businessId: b(), productId: lotted.id, code: 'LOT-EXPIRY-CONTRACT' }, { viewer: owner })
    const expiresAt = new Date('2028-02-03T00:00:00Z')
    const applied = await prisma.$transaction((tx) => inventory.setLotExpiryIfUnset(tx, { businessId: b(), lotId: lot.id, expiresAt }, { viewer: owner }))
    expect(applied).toEqual({ applied: true, version: lot.version + 1 })

    const repeated = await prisma.$transaction((tx) => inventory.setLotExpiryIfUnset(tx, { businessId: b(), lotId: lot.id, expiresAt: new Date('2030-01-01T00:00:00Z') }, { viewer: owner }))
    expect(repeated).toEqual({ applied: false, reason: 'ALREADY_SET', version: lot.version + 1 })
    const stored = await prisma.productLot.findUnique({ where: { id: lot.id }, select: { expiresAt: true, version: true } })
    expect(stored).toEqual({ expiresAt, version: lot.version + 1 })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PRODUCT_LOT', entityId: lot.id, action: 'PRODUCT_LOT_EXPIRY_SET' } })
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0].payloadJson)).toMatchObject({ businessId: b(), lotCode: lot.code, productId: lotted.id, expiresAt: expiresAt.toISOString(), previous: null, version: lot.version + 1 })
  })

  it('C8 — stale and racing expiry writers conflict without leaving a write', async () => {
    const staleLot = await createLot({ businessId: b(), productId: lotted.id, code: 'LOT-EXPIRY-STALE' }, { viewer: owner })
    await expect(prisma.$transaction((tx) => inventory.setLotExpiryIfUnset(tx, {
      businessId: b(), lotId: staleLot.id, expiresAt: new Date('2028-02-03T00:00:00Z'), expectedVersion: staleLot.version - 1,
    }, { viewer: owner }))).rejects.toMatchObject({ status: 409, message: 'PRODUCT_LOT_VERSION_CONFLICT' })
    expect(await prisma.productLot.findUnique({ where: { id: staleLot.id }, select: { expiresAt: true, version: true } })).toEqual({ expiresAt: null, version: staleLot.version })

    const racedLot = await createLot({ businessId: b(), productId: lotted.id, code: 'LOT-EXPIRY-RACE' }, { viewer: owner })
    await expect(prisma.$transaction(async (tx) => {
      const updateMany = tx.productLot.updateMany.bind(tx.productLot)
      vi.spyOn(tx.productLot, 'updateMany').mockImplementation(async (args) => {
        await tx.productLot.update({ where: { id: racedLot.id }, data: { version: { increment: 1 } } })
        return updateMany(args)
      })
      return inventory.setLotExpiryIfUnset(tx, { businessId: b(), lotId: racedLot.id, expiresAt: new Date('2028-02-03T00:00:00Z') }, { viewer: owner })
    })).rejects.toMatchObject({ status: 409, message: 'PRODUCT_LOT_VERSION_CONFLICT' })
    expect(await prisma.productLot.findUnique({ where: { id: racedLot.id }, select: { expiresAt: true, version: true } })).toEqual({ expiresAt: null, version: racedLot.version })
  })

  it('C8 — expiry before manufacture and a lot from another Business are refused', async () => {
    const lot = await createLot({ businessId: b(), productId: lotted.id, code: 'LOT-EXPIRY-MFG', manufacturedAt: new Date('2027-05-01T00:00:00Z') }, { viewer: owner })
    await expect(prisma.$transaction((tx) => inventory.setLotExpiryIfUnset(tx, {
      businessId: b(), lotId: lot.id, expiresAt: new Date('2027-05-01T00:00:00Z'),
    }, { viewer: owner }))).rejects.toMatchObject({ status: 422, message: 'PRODUCT_LOT_EXPIRY_BEFORE_MANUFACTURE' })

    const other = await createOtherScope('LOT-FOREIGN')
    const foreignLot = await createLot({ businessId: other.business.id, productId: other.product.id, code: 'LOT-FOREIGN' }, { viewer: other.owner })
    await expect(prisma.$transaction((tx) => inventory.setLotExpiryIfUnset(tx, {
      businessId: b(), lotId: foreignLot.id, expiresAt: new Date('2028-02-03T00:00:00Z'),
    }, { viewer: owner }))).rejects.toMatchObject({ status: 422, message: 'PRODUCT_LOT_NOT_FOUND' })
  })

  it('C14 — strict receipt contract validates recorded cost inputs and rejects typed costs', () => {
    const line = { purchaseOrderLineId: 'line', qty: 1 }
    expect(zPostReceipt.safeParse({ lines: [line], landedCosts: [{ component: 'SEA_FREIGHT', amountSatang: 1 }] }).success).toBe(true)
    expect(zPostReceipt.safeParse({ lines: [line], batchCostSatang: 1, landedCosts: [{ component: 'IMPORT_DUTY', amountSatang: 1 }] }).success).toBe(false)
    expect(zPostReceipt.safeParse({ lines: [line], landedCosts: [{ component: 'OTHER', amountSatang: 1 }] }).success).toBe(false)
    expect(zPostReceipt.safeParse({ lines: [line], landedCosts: [{ component: 'SEA_FREIGHT', amountSatang: 1 }, { component: 'SEA_FREIGHT', amountSatang: 2 }] }).success).toBe(false)
    expect(zPostReceipt.safeParse({ lines: [line], landedCosts: [{ component: 'STORAGE', amountSatang: 1 }] }).success).toBe(false)
    expect(zPostReceipt.safeParse({ lines: [line], costSatang: 100 }).success).toBe(false)
    expect(zPostReceipt.safeParse({ lines: [{ ...line, costSatang: 100 }] }).success).toBe(false)
  })

  it('C14 — landed cost components are amortised over all counted receipt quantity and persisted with movement cost', async () => {
    const costed = await createProduct({ businessId: b(), code: 'LANDED-COST-GRN', productMasterId: box.productMasterId, name: 'Landed cost test product' }, { viewer: owner })
    const order = await sentOrder([{ productId: costed.id, qty: 3, unitCost: 20 }, { productId: box.id, qty: 2, unitCost: 30 }])
    const landedCosts = [
      { component: 'SEA_FREIGHT', amountSatang: 10, reference: 'FRT-001' },
      { component: 'IMPORT_DUTY', amountSatang: 8, reference: 'DUTY-001' },
      { component: 'INBOUND_TRUCK', amountSatang: 4, reference: 'TRUCK-001' },
    ]
    const posted = await postGoodsReceipt(order.id, {
      lines: order.lines.map((line) => ({ purchaseOrderLineId: line.id, qty: line.qty })), landedCosts, selfVerifyAttested: true,
    }, { viewer: owner, now: NOW })
    expect(posted.receipt).toMatchObject({ fxCostSheetId: null, fxRateLocked: null, landedCosts })
    expect(posted.receipt.lines.map((line) => [line.unitCostSatang, line.unitCostBaht]).sort((a, c) => a[0] - c[0])).toEqual([[2005, 20.05], [3005, 30.05]])
    const movements = await prisma.stockMovement.findMany({ where: { reference: `PO:${order.code}/GRN:${posted.receipt.code}` }, orderBy: { productId: 'asc' } })
    expect(movements.map((movement) => movement.costSatang).sort((a, c) => a - c)).toEqual([2005, 3005])
    expect(posted.posted.map((line) => line.costSatang).sort((a, c) => a - c)).toEqual([2005, 3005])
    const stored = await prisma.goodsReceipt.findUnique({ where: { id: posted.receipt.id }, select: { landedCostsJson: true, lines: { select: { unitCostSatang: true } } } })
    expect(JSON.parse(stored.landedCostsJson)).toEqual(landedCosts)
    expect(stored.lines.map((line) => line.unitCostSatang).sort((a, c) => a - c)).toEqual([2005, 3005])
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'GOODS_RECEIPT', entityId: posted.receipt.id, action: 'GOODS_RECEIPT_POSTED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ landedCosts, fxCostSheetId: null, fxRateLocked: null, posted: expect.arrayContaining([
      expect.objectContaining({ agreedUnitCostSatang: 2000, factoryUnitCostSatang: 2000, componentUnitCostSatang: { SEA_FREIGHT: 2, IMPORT_DUTY: 2, INBOUND_TRUCK: 1 }, unitCostSatang: 2005 }),
      expect.objectContaining({ agreedUnitCostSatang: 3000, factoryUnitCostSatang: 3000, componentUnitCostSatang: { SEA_FREIGHT: 2, IMPORT_DUTY: 2, INBOUND_TRUCK: 1 }, unitCostSatang: 3005 }),
    ]) })
  })

  it('C14 — refuses a derived Int32 overflow before creating the receipt or stock movement', async () => {
    const costed = await createProduct({ businessId: b(), code: 'COST-OVERFLOW-GRN', productMasterId: box.productMasterId, name: 'Int32 overflow test product' }, { viewer: owner })
    const order = await sentOrder([{ productId: costed.id, qty: 1, unitCost: 0.01 }])
    expect((await prisma.purchaseOrderLine.findUnique({ where: { id: order.lines[0].id }, select: { unitCostSatang: true } })).unitCostSatang).toBe(1)
    const beforeMovements = await prisma.stockMovement.count({ where: { productId: costed.id } })

    await expect(postGoodsReceipt(order.id, {
      lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }],
      landedCosts: [{ component: 'OTHER', amountSatang: 2147483647, note: 'maximum Int32 component' }],
      selfVerifyAttested: true,
    }, { viewer: owner, now: NOW })).rejects.toMatchObject({
      status: 422,
      message: 'PROCUREMENT_RECEIPT_COST_OUT_OF_RANGE',
      details: { purchaseOrderLineId: order.lines[0].id },
    })

    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0)
    expect(await prisma.stockMovement.count({ where: { productId: costed.id } })).toBe(beforeMovements)
  })

  it('C14 — foreign receipts require a matching confirmed cost sheet, but uncounted receipts do not', async () => {
    const thbOrder = await sentOrder([{ productId: box.id, qty: 1, unitCost: 1 }])
    await expect(postGoodsReceipt(thbOrder.id, { fxCostSheetId: 'sheet-id', lines: [{ purchaseOrderLineId: thbOrder.lines[0].id, qty: 1 }] }, { viewer: receiver, now: NOW }))
      .rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_NOT_APPLICABLE' })

    const foreignOrder = await sentOrder([{ productId: box.id, qty: 2, unitCost: 1.25 }], owner, 'USD')
    const receive = (fxCostSheetId) => postGoodsReceipt(foreignOrder.id, {
      lines: [{ purchaseOrderLineId: foreignOrder.lines[0].id, qty: 2 }], ...(fxCostSheetId ? { fxCostSheetId } : {}),
    }, { viewer: receiver, now: NOW })
    await expect(receive()).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_RATE_REQUIRED', details: { currency: 'USD' } })

    const jpyOrder = await sentOrder([{ productId: box.id, qty: 1, unitCost: 1 }], owner, 'JPY')
    const beforeJpyMovements = await prisma.stockMovement.count({ where: { productId: box.id } })
    await expect(postGoodsReceipt(jpyOrder.id, {
      lines: [{ purchaseOrderLineId: jpyOrder.lines[0].id, qty: 1 }],
    }, { viewer: receiver, now: NOW })).rejects.toMatchObject({
      status: 422, message: 'PROCUREMENT_RECEIPT_FX_CURRENCY_UNSUPPORTED', details: { currency: 'JPY' },
    })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: jpyOrder.id } })).toBe(0)
    expect(await prisma.stockMovement.count({ where: { productId: box.id } })).toBe(beforeJpyMovements)

    const xdrOrder = await sentOrder([{ productId: box.id, qty: 1, unitCost: 1 }], owner, 'XDR')
    const beforeXdrMovements = await prisma.stockMovement.count({ where: { productId: box.id } })
    await expect(postGoodsReceipt(xdrOrder.id, {
      lines: [{ purchaseOrderLineId: xdrOrder.lines[0].id, qty: 1 }],
    }, { viewer: receiver, now: NOW })).rejects.toMatchObject({
      status: 422, message: 'PROCUREMENT_RECEIPT_FX_CURRENCY_UNSUPPORTED', details: { currency: 'XDR' },
    })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: xdrOrder.id } })).toBe(0)
    expect(await prisma.stockMovement.count({ where: { productId: box.id } })).toBe(beforeXdrMovements)

    const draft = await makeCostSheet()
    await expect(receive(draft.id)).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_SHEET_INVALID' })
    const otherSupplier = await createSupplier({ businessId: b(), code: 'SUP-GRN-OTHER', name: 'Other supplier' }, { viewer: owner })
    const supplierSheet = await makeCostSheet({ supplierId: otherSupplier.id })
    await expect(receive(supplierSheet.id)).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_SHEET_INVALID' })
    const currencySheet = await makeCostSheet({ currency: 'EUR' })
    await expect(receive(currencySheet.id)).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_SHEET_INVALID' })
    const other = await createOtherScope('FX-FOREIGN')
    const foreignSheet = await makeCostSheet({ businessId: other.business.id, supplierId: other.supplier.id, sourceSku: other.product.code, productId: other.product.id, viewer: other.owner })
    await expect(receive(foreignSheet.id)).rejects.toMatchObject({ status: 422, message: 'PROCUREMENT_RECEIPT_FX_SHEET_INVALID' })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: foreignOrder.id } })).toBe(0)

    const uncountedOrder = await sentOrder([{ description: 'Imported service', qty: 1, unitCost: 20 }], owner, 'JPY')
    const uncounted = await postGoodsReceipt(uncountedOrder.id, { lines: [{ purchaseOrderLineId: uncountedOrder.lines[0].id, qty: 1 }] }, { viewer: receiverOnly, now: NOW })
    expect(uncounted.receipt).toMatchObject({ fxCostSheetId: null, fxRateLocked: null, landedCosts: [] })
    expect(uncounted.posted).toEqual([])
  })

  it('C14 — confirmed and superseded sheet rates reproduce stored receipt cost and feed moving average', async () => {
    const sheet = await makeCostSheet({ confirm: true, fxRateLocked: 34 })
    const foreignOrder = await sentOrder([{ productId: box.id, qty: 2, unitCost: 1.25 }], owner, 'usd')
    const receipt = await postGoodsReceipt(foreignOrder.id, {
      lines: [{ purchaseOrderLineId: foreignOrder.lines[0].id, qty: 2 }],
      landedCosts: [{ component: 'SEA_FREIGHT', amountSatang: 5 }], fxCostSheetId: sheet.id,
    }, { viewer: receiver, now: NOW })
    expect(receipt.receipt).toMatchObject({ fxCostSheetId: sheet.id, fxRateLocked: 34, landedCosts: [{ component: 'SEA_FREIGHT', amountSatang: 5 }] })
    expect(receipt.receipt.lines[0]).toMatchObject({ unitCostSatang: 4253, unitCostBaht: 42.53 })

    await prisma.supplierCostSheet.update({ where: { id: sheet.id }, data: { fxRateLocked: 99 } })
    const storedReceipt = await prisma.goodsReceipt.findUnique({
      where: { id: receipt.receipt.id },
      select: { id: true, fxCostSheetId: true, fxRateLocked: true, landedCostsJson: true, lines: { select: { id: true, purchaseOrderLineId: true, qty: true, unitCostSatang: true } } },
    })
    const storedOrder = await prisma.purchaseOrder.findUnique({ where: { id: foreignOrder.id }, select: { currency: true } })
    const storedOrderLine = await prisma.purchaseOrderLine.findUnique({ where: { id: foreignOrder.lines[0].id }, select: { id: true, unitCostSatang: true } })
    const storedReceiptLines = await prisma.goodsReceiptLine.findMany({ where: { receiptId: storedReceipt.id }, select: { id: true, purchaseOrderLineId: true, qty: true, unitCostSatang: true } })
    const components = JSON.parse(storedReceipt.landedCostsJson)
    const countedQty = storedReceiptLines.reduce((sum, line) => sum + line.qty, 0)
    const reproduced = procurementDomain.deriveReceiptLineCost({
      currency: storedOrder.currency, agreedUnitCostSatang: storedOrderLine.unitCostSatang,
      fxRateLocked: storedReceipt.fxRateLocked, countedQty, components,
    })
    expect(storedReceipt.fxRateLocked).toBe(34)
    expect(reproduced.unitCostSatang).toBe(storedReceiptLines[0].unitCostSatang)
    const movement = await prisma.stockMovement.findFirst({ where: { reference: `PO:${foreignOrder.code}/GRN:${receipt.receipt.code}` }, select: { costSatang: true } })
    expect(movement.costSatang).toBe(storedReceiptLines[0].unitCostSatang)

    const supersedingSheet = await makeCostSheet({ confirm: true, fxRateLocked: 35 })
    expect((await prisma.supplierCostSheet.findUnique({ where: { id: sheet.id }, select: { status: true } })).status).toBe('SUPERSEDED')
    const supersededOrder = await sentOrder([{ productId: box.id, qty: 1, unitCost: 1.25 }], owner, 'USD')
    const supersededReceipt = await postGoodsReceipt(supersededOrder.id, {
      lines: [{ purchaseOrderLineId: supersededOrder.lines[0].id, qty: 1 }], fxCostSheetId: sheet.id,
    }, { viewer: receiver, now: new Date(NOW.getTime() + 1000) })
    expect(supersededReceipt.receipt).toMatchObject({ fxCostSheetId: sheet.id, fxRateLocked: 99 })
    expect(supersededReceipt.receipt.lines[0].unitCostSatang).toBe(12375)
    expect(supersedingSheet.status).toBe('CONFIRMED')

    const weighted = await createProduct({ businessId: b(), code: 'WAVG-RECEIPT-GRN', productMasterId: box.productMasterId, name: 'Weighted average receipt product' }, { viewer: owner })
    const firstOrder = await sentOrder([{ productId: weighted.id, qty: 2, unitCost: 10 }])
    const firstReceipt = await postGoodsReceipt(firstOrder.id, { lines: [{ purchaseOrderLineId: firstOrder.lines[0].id, qty: 2 }], selfVerifyAttested: true }, { viewer: owner, now: new Date(NOW.getTime() + 2000) })
    const secondOrder = await sentOrder([{ productId: weighted.id, qty: 3, unitCost: 20 }])
    await postGoodsReceipt(secondOrder.id, { lines: [{ purchaseOrderLineId: secondOrder.lines[0].id, qty: 3 }], selfVerifyAttested: true }, { viewer: owner, now: new Date(NOW.getTime() + 3000) })
    expect(firstReceipt.receipt.lines[0].unitCostSatang).toBe(1000)
    const valuation = await inventory.readInventoryValuation(weighted.id, { businessId: b() })
    expect(valuation).toMatchObject({ unitCostSatang: 1600, onHandQty: 5, partial: false })
  })

  it('Inventory public recordMovement reserves GOODS_RECEIPT but keeps other receipt reasons available', async () => {
    const before = await prisma.stockMovement.count({ where: { productId: box.id } })
    await expect(recordMovement({ businessId: b(), productId: box.id, kind: 'RECEIPT', quantity: 1, costSatang: 1234, reason: 'GOODS_RECEIPT' }, { viewer: owner }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_RECEIPT_REASON_RESERVED' })
    expect(await prisma.stockMovement.count({ where: { productId: box.id } })).toBe(before)
    const movement = await recordMovement({ businessId: b(), productId: box.id, kind: 'RECEIPT', quantity: 1, costSatang: 1234, reason: 'MANUAL_RECEIPT' }, { viewer: owner })
    expect(movement.movements[0]).toMatchObject({ reason: 'MANUAL_RECEIPT', costSatang: 1234 })
  })

  it('AC-165.5 — the receipts of an order are listed with their lines; the ladder applies to reading them too', async () => {
    const order = await sentOrder([{ description: 'ค่าออกแบบ', qty: 3, unitCost: 10 }])
    await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 1 }], notes: 'งวดแรก' }, { viewer: receiverOnly, now: NOW })
    await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: order.lines[0].id, qty: 2 }] }, { viewer: receiverOnly, now: NOW })
    const listed = await listGoodsReceipts(order.id, { viewer: member })
    expect(listed.purchaseOrderCode).toBe(order.code)
    expect(listed.receipts.map((r) => [r.notes, r.lines[0].qty])).toEqual([['งวดแรก', 1], [null, 2]])
    await expect(listGoodsReceipts(order.id, { viewer: noDomain })).rejects.toMatchObject({ status: 404 })
    await expect(listGoodsReceipts('no-such', { viewer: owner })).rejects.toMatchObject({ status: 404 })
    expect((await getPurchaseOrder(order.id, { viewer: member })).status).toBe('RECEIVED')
  })

  it('registry and printable detail preserve actual PO/line data, enforce scope, and validate pagination', async () => {
    const order = await sentOrder([{ productId: box.id, qty: 2, unitCost: 20 }, { description: 'uncounted packing', qty: 1, unitCost: 5 }])
    const result = await postGoodsReceipt(order.id, { lines: order.lines.map(line => ({ purchaseOrderLineId: line.id, qty: line.qty })), selfVerifyAttested: true }, { viewer: owner })
    const detail = await getGoodsReceiptDetail(result.receipt.id, { viewer: member })
    expect(detail).toMatchObject({ businessId: b(), purchaseOrder: { id: order.id, code: order.code, supplier: { name: supplier.name } } })
    expect(detail.lines.find(line => line.purchaseOrderLineId === order.lines[0].id)).toMatchObject({ qty: 2, purchaseOrderLine: { description: 'Gift box', product: { code: box.code, stockPolicy: 'TRACKED' } }, serialNos: [] })
    expect(detail.lines.find(line => line.purchaseOrderLineId === order.lines[1].id).purchaseOrderLine.product).toBeNull()
    const first = await listAllGoodsReceipts(b(), { viewer: member, limit: '1', offset: '0' })
    const second = await listAllGoodsReceipts(b(), { viewer: member, limit: 1, offset: 1 })
    expect(first).toMatchObject({ limit: 1, offset: 0, hasMore: true })
    expect(first.receipts).toHaveLength(1)
    expect(second.receipts[0].id).not.toBe(first.receipts[0].id)
    const outsider = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [], visibleDomains: DOMAINS })
    for (const viewer of [outsider, noDomain]) {
      await expect(getGoodsReceiptDetail(detail.id, { viewer })).rejects.toMatchObject({ status: 404 })
      await expect(listAllGoodsReceipts(b(), { viewer })).rejects.toMatchObject({ status: 404 })
    }
    for (const limit of ['10junk', '1.5', '', '0', '-1', 201, Infinity]) {
      await expect(listAllGoodsReceipts(b(), { viewer: member, limit })).rejects.toThrow()
    }
    await expect(listAllGoodsReceipts(b(), { viewer: member, offset: -1 })).rejects.toThrow()
    await expect(getGoodsReceiptDetail('missing', { viewer: owner })).rejects.toMatchObject({ status: 404 })
  })

  it('TASK-ZAI-054 / FR-175 — goods receipts post landed unit cost with amortised batch costs, and SKU page reflects cost metrics', async () => {
    const costed = await createProduct({ businessId: b(), code: 'COST-GRN', productMasterId: box.productMasterId, name: 'Costed Mug' }, { viewer: owner })

    // 1. Order 1: 3 items at 20 THB (2000 satang)
    const order1 = await sentOrder([{ productId: costed.id, qty: 3, unitCost: 20 }])
    const receipt1 = await postGoodsReceipt(order1.id, {
      lines: [{ purchaseOrderLineId: order1.lines[0].id, qty: 3 }],
      selfVerifyAttested: true,
    }, { viewer: owner, now: new Date('2026-09-06T03:00:00Z') })

    expect(receipt1.posted[0].costSatang).toBe(2000)

    // 2. Order 2: 2 items at 50 THB (5000 satang) with batchCostSatang: 1000 (amortised 500 satang/unit) -> 5500 satang
    const order2 = await sentOrder([{ productId: costed.id, qty: 2, unitCost: 50 }])
    const receipt2 = await postGoodsReceipt(order2.id, {
      lines: [{ purchaseOrderLineId: order2.lines[0].id, qty: 2 }],
      batchCostSatang: 1000,
      selfVerifyAttested: true,
    }, { viewer: owner, now: new Date('2026-09-06T04:00:00Z') })

    expect(receipt2.posted[0].costSatang).toBe(5500)
    const movement2 = await prisma.stockMovement.findFirst({
      where: { reference: `PO:${order2.code}/GRN:${receipt2.receipt.code}` },
    })
    expect(movement2.costSatang).toBe(5500)

    // 3. Check SKU page costing data via getProduct
    const productDetail = await getProduct(costed.id, { viewer: owner })
    expect(productDetail.costing).toBeDefined()
    expect(productDetail.costing.lastReceiptCostSatang).toBe(5500)
    // Weighted average: (3 * 2000 + 2 * 5500) / 5 = 17000 / 5 = 3400 satang
    expect(productDetail.costing.weightedAverageLandedCostSatang).toBe(3400)
    expect(productDetail.costing.valuation).toMatchObject({ method: 'MOVING_WEIGHTED_AVERAGE', scope: 'PRODUCT', unitCostSatang: 3400, onHandQty: 5, partial: false, partialReasons: [], uncostedQty: 0 })
    expect(productDetail.costing.allTimeReceiptAverageSatang).toBe(3400)
    expect(productDetail.costing.costHistory).toHaveLength(2)
    expect(productDetail.costing.costHistory[0].costSatang).toBe(5500)
    expect(productDetail.costing.costHistory[1].costSatang).toBe(2000)

    const depletedAt = new Date('2026-09-07T00:00:00.000Z')
    await recordMovement({ businessId: b(), productId: costed.id, kind: 'ISSUE', quantity: 5, occurredAt: depletedAt, reference: 'ISSUE:DEPLETION' }, { viewer: owner, now: depletedAt })
    const order3 = await sentOrder([{ productId: costed.id, qty: 4, unitCost: 90 }])
    await postGoodsReceipt(order3.id, {
      lines: [{ purchaseOrderLineId: order3.lines[0].id, qty: 4 }],
      selfVerifyAttested: true,
    }, { viewer: owner, now: new Date('2026-09-07T01:00:00.000Z') })
    const restarted = await getProduct(costed.id, { viewer: owner })
    expect(restarted.costing.valuation).toMatchObject({ unitCostSatang: 9000, onHandQty: 4, partial: false, partialReasons: [], uncostedQty: 0 })
    expect(restarted.costing.weightedAverageLandedCostSatang).toBe(9000)
    expect(restarted.costing.allTimeReceiptAverageSatang).toBe(5889)
  })

  // @req FR-196 — the person who wrote the order cannot also sign for its goods,
  // an OWNER included (the capability gate lets an OWNER through; this is the
  // refusal it does not answer). `selfVerifyAttested: true` is the auditable
  // exemption for a genuinely one-person Business. Had no test before
  // (SCM-HANDOFF F-2).
  it('FR-196 — the order author cannot post its receipt unless attested, and the attested post is audited as selfVerified', async () => {
    const order = await sentOrder([{ productId: box.id, qty: 2, unitCost: 20 }])
    expect(order.createdByPersonId).toBe('per-owner')
    const line = order.lines[0].id
    const before = await onHand('BOX-GRN')
    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: line, qty: 2 }] }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 409, message: 'GOODS_RECEIPT_SELF_POST_FORBIDDEN' })
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0)
    expect(await onHand('BOX-GRN')).toBe(before)

    const attested = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: line, qty: 2 }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    expect(attested.receipt.postedByPersonId).toBe('per-owner')
    expect(await onHand('BOX-GRN')).toBe(before + 2)
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'GOODS_RECEIPT', entityId: attested.receipt.id, action: 'GOODS_RECEIPT_POSTED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ selfVerified: true })

    // Someone else receiving is not a self-post, and is audited as such.
    const other = await sentOrder([{ productId: box.id, qty: 1, unitCost: 20 }])
    const byReceiver = await postGoodsReceipt(other.id, { lines: [{ purchaseOrderLineId: other.lines[0].id, qty: 1 }] }, { viewer: receiver, now: NOW })
    const audit2 = await prisma.auditEvent.findFirst({ where: { entityType: 'GOODS_RECEIPT', entityId: byReceiver.receipt.id, action: 'GOODS_RECEIPT_POSTED' } })
    expect(JSON.parse(audit2.payloadJson)).toMatchObject({ selfVerified: false })
  })
})

