// @req FR-165 — goods receipts against a real database: posted only against a
//   SENT order, line by line and never beyond what is outstanding; a counted
//   SKU's line lands in the Inventory ledger with the PO/GRN reference (lots
//   with expiry, serial units) and needs Inventory's authority on top of the
//   buyer's; an uncounted or free-text line touches no ledger; the order's
//   received / outstanding quantities and receipt state follow on read; the
//   receipt that completes every line makes the order RECEIVED; audit.
// @spec ADR-066; ADR-054 D3/D4; BR-002; SEC-001; FR-072; FR-155
// @tested tests/integration/fr165-goods-receipt.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ROLE_GOODS_RECEIVER, ROLE_INVENTORY_MANAGER, ROLE_PROCUREMENT_BUYER } from '@/modules/identity/rbac'
import { createCategory, createProduct, createProductMaster } from '@/modules/inventory/application/inventory-catalog-service'
import { listLots, listSerialUnits, stockSummary } from '@/modules/inventory/application/inventory-stock-service'
import { createSupplier } from '@/modules/procurement/application/supplier-service'
import { applyPurchaseOrderAction, createPurchaseOrder, getPurchaseOrder } from '@/modules/procurement/application/purchase-order-service'
import { listGoodsReceipts, postGoodsReceipt, listAllGoodsReceipts, getGoodsReceiptDetail } from '@/modules/procurement/application/goods-receipt-service'

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

  const sentOrder = async (lines, viewer = owner) => {
    const order = await createPurchaseOrder({ businessId: b(), supplierId: supplier.id, lines }, { viewer, now: NOW })
    return applyPurchaseOrderAction(order.id, { action: 'SEND', version: 1 }, { viewer, now: NOW })
  }
  const lineOf = (order, description) => order.lines.find((l) => l.description === description)

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
    expect(posted.posted).toEqual([{ purchaseOrderLineId: boxLine.id, productId: box.id, code: 'BOX-GRN', quantity: 3, lotId: null, onHandAfter: 3 }])
    expect(posted.order).toMatchObject({ status: 'SENT', receiptState: 'PARTIAL', receiptCount: 2, receivedValue: 220, outstandingValue: 40 })
    expect(posted.order.lines.map((l) => [l.description, l.receivedQty, l.outstandingQty])).toEqual([['Gift box', 3, 2], ['Printing', 2, 0], ['ค่าขนส่ง', 1, 0]])
    expect(await onHand('BOX-GRN')).toBe(3)
    const movements = await prisma.stockMovement.findMany({ where: { reference: `PO:${order.code}/GRN:GRN-20260906-002` } })
    expect(movements.map((m) => [m.kind, m.quantity, m.reason, m.actorId])).toEqual([['RECEIPT', 3, 'GOODS_RECEIPT', 'per-recv']])
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
    // A second receipt into the same lot keeps the expiry it already has.
    await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: teaLine.id, qty: 6, lotCode: 'TEA-2026-09', expiresAt: '2030-01-01T00:00:00Z' }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    lots = await listLots({ businessId: b(), productId: lotted.id, viewer: owner })
    expect(lots.map((l) => [l.code, l.receivedQty, l.expiresAt])).toEqual([['TEA-2026-09', 10, new Date('2027-09-01T00:00:00Z')]])

    await expect(postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: gadgetLine.id, qty: 2, serialNos: ['SN-1'] }], selfVerifyAttested: true }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'INVENTORY_SERIAL_COUNT_MISMATCH' })
    const done = await postGoodsReceipt(order.id, { lines: [{ purchaseOrderLineId: gadgetLine.id, qty: 2, serialNos: ['SN-1', 'SN-2'] }], selfVerifyAttested: true }, { viewer: owner, now: NOW })
    expect(done.order).toMatchObject({ status: 'RECEIVED', receiptState: 'COMPLETE' })
    expect(done.receipt.lines[0].serialNos).toEqual(['SN-1', 'SN-2'])
    const units = await listSerialUnits({ businessId: b(), productId: serial.id, viewer: owner })
    expect(units.map((u) => [u.serialNo, u.status]).sort()).toEqual([['SN-1', 'IN_STOCK'], ['SN-2', 'IN_STOCK']])
    expect(await onHand('GADGET-GRN')).toBe(2)
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
})
